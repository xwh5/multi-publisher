/**
 * metrics 命令 —— 一次拉齐三平台的运营数字（只读）。
 *
 * 为什么要它：回盘以前要开三个后台手点；
 * 现在一条命令拿到 {头条: 粉丝/草稿, 公众号: 草稿数, 小红书: 粉丝/笔记}，
 * 再由回盘流程写进 metrics.csv。
 */
import { XhsMcpClient, unwrapToolResult } from "../tools/xhs-mcp.js";
import { ConfigStore } from "../config.js";
import { emitSuccess, emitFailure, formatTable } from "./output.js";

const TOUT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

async function toutiaoMetrics(): Promise<Record<string, unknown>> {
  const cookies = await ConfigStore.getToutiaoCookies();
  if (!cookies || Object.keys(cookies).length === 0) {
    return { status: "unconfigured", detail: "未配置头条 cookie" };
  }
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const headers = {
    cookie,
    referer: "https://mp.toutiao.com/profile_v4/manage/content/all?enter_from=left_menu",
    "user-agent": TOUT_UA,
    accept: "application/json",
  };
  const fansRes = await fetch("https://mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat?app_id=1231", { headers });
  const fans = (await fansRes.json()) as {
    code?: number;
    date?: string;
    fans_stat?: { total_fans_count?: number; increase_count?: number; decrease_count?: number; active_fans_count?: number; active_fans_rate?: number };
  };
  const draftRes = await fetch(
    "https://mp.toutiao.com/mp/agw/creator_center/draft_list?type=0&count=50&app_id=1231",
    { headers },
  );
  const drafts = (await draftRes.json()) as { code?: number };
  const draftCount = (JSON.stringify(drafts).match(/"title":/g) ?? []).length;
  const s = fans.fans_stat;
  return {
    status: fans.code === 0 ? "ok" : "invalid",
    statDate: fans.date,
    totalFans: s?.total_fans_count,
    increase: s?.increase_count,
    decrease: s?.decrease_count,
    activeFans: s?.active_fans_count,
    activeRate: s?.active_fans_rate !== undefined ? Number((s.active_fans_rate * 100).toFixed(2)) : undefined,
    drafts: draftCount,
  };
}

async function weixinMetrics(): Promise<Record<string, unknown>> {
  // 优先走后台：API 的 user/info 对个人未认证订阅号是 48001
  const backendCookies = await ConfigStore.getWeixinBackendCookies();
  if (backendCookies && Object.keys(backendCookies).length > 0) {
    try {
      const { listWeixinFansBackend } = await import("./list.js");
      const b = await listWeixinFansBackend();
      // 草稿数走 API（draft/count 对这个号是通的）
      let drafts: number | undefined;
      try {
        const cfg = await ConfigStore.getWeixin();
        const tok = (await (
          await fetch(
            `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg.appId}&secret=${cfg.appSecret}`,
          )
        ).json()) as { access_token?: string };
        if (tok.access_token) {
          const cnt = (await (
            await fetch(`https://api.weixin.qq.com/cgi-bin/draft/count?access_token=${tok.access_token}`)
          ).json()) as { total_count?: number };
          drafts = cnt.total_count;
        }
      } catch {
        /* 草稿数拿不到就不填 */
      }
      return {
        status: "ok",
        source: "backend",
        fans: b.totalFans ?? "?",
        newFansYesterday: b.newFansYesterday ?? "?",
        readsYesterday: b.readsYesterday ?? "?",
        sharesYesterday: b.sharesYesterday ?? "?",
        drafts,
      };
    } catch (err) {
      // 后台读不到就退回 API（草稿数仍可用）
      const api = await weixinMetricsApi();
      return { ...api, backendError: (err as Error).message };
    }
  }
  return weixinMetricsApi();
}

async function weixinMetricsApi(): Promise<Record<string, unknown>> {
  const cfg = await ConfigStore.getWeixin();
  if (!cfg.appId || !cfg.appSecret) return { status: "unconfigured", detail: "未配置公众号凭据" };
  const tok = (await (
    await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg.appId}&secret=${cfg.appSecret}`,
    )
  ).json()) as { access_token?: string };
  if (!tok.access_token) return { status: "invalid", detail: "取 token 失败" };
  const cnt = (await (
    await fetch(`https://api.weixin.qq.com/cgi-bin/draft/count?access_token=${tok.access_token}`)
  ).json()) as { total_count?: number };
  return {
    status: typeof cnt.total_count === "number" ? "ok" : "invalid",
    drafts: cnt.total_count,
    fans: "不可用（订阅号 user/info 报 48001，只能从后台读）",
  };
}

async function xiaohongshuMetrics(): Promise<Record<string, unknown>> {
  const client = new XhsMcpClient();
  const health = await client.health();
  if (!health.ok) return { status: "down", detail: health.detail };
  const res = await client.callTool("get_my_profile", { tab: "note" });
  const data = unwrapToolResult(res) as {
    userBasicInfo?: { nickname?: string; redId?: string };
    interactions?: { type: string; name: string; count: string }[];
    feeds?: unknown[];
  };
  const pick = (t: string) => data?.interactions?.find((i) => i.type === t)?.count;
  return {
    status: "ok",
    nickname: data?.userBasicInfo?.nickname,
    redId: data?.userBasicInfo?.redId,
    fans: pick("fans"),
    follows: pick("follows"),
    interactions: pick("interaction"),
    notes: data?.feeds?.length ?? 0,
  };
}

export async function runMetrics(options: { json?: boolean }): Promise<void> {
  const json = Boolean(options.json);
  try {
    const [toutiao, weixin, xiaohongshu] = await Promise.all([
      toutiaoMetrics().catch((e): Record<string, unknown> => ({ status: "error", detail: (e as Error).message })),
      weixinMetrics().catch((e): Record<string, unknown> => ({ status: "error", detail: (e as Error).message })),
      xiaohongshuMetrics().catch((e): Record<string, unknown> => ({ status: "error", detail: (e as Error).message })),
    ]);
    const data = {
      collectedAt: new Date().toISOString(),
      toutiao,
      weixin,
      xiaohongshu,
    };
    emitSuccess(data, {
      json,
      human: () =>
        [
          formatTable([
            {
              平台: "头条号",
              粉丝: String(toutiao.totalFans ?? "-"),
              昨日涨掉: toutiao.increase !== undefined ? `+${toutiao.increase}/-${toutiao.decrease}` : "-",
              活跃粉: toutiao.activeFans !== undefined ? `${toutiao.activeFans}（${toutiao.activeRate}%）` : "-",
              草稿: String(toutiao.drafts ?? "-"),
              状态: String(toutiao.status ?? "-"),
            },
            {
              平台: "微信公众号",
              粉丝: String(weixin.fans ?? "不可用"),
              昨日涨掉: "-",
              活跃粉: "-",
              草稿: String(weixin.drafts ?? "-"),
              状态: String(weixin.status ?? "-"),
            },
            {
              平台: "小红书",
              粉丝: String(xiaohongshu.fans ?? "-"),
              昨日涨掉: "-",
              活跃粉: String(xiaohongshu.interactions ?? "-"),
              草稿: String(xiaohongshu.notes ?? "-"),
              状态: String(xiaohongshu.status ?? "-"),
            },
          ]),
          "",
          `采集时间：${data.collectedAt}`,
        ].join("\n"),
    });
  } catch (err) {
    emitFailure({ code: "METRICS_FAILED", message: (err as Error).message }, { json });
  }
}
