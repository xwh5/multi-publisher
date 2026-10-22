/**
 * daily 命令 —— 每天的运营动作一条命令跑完：
 *   体检（凭据）→ 看今天该发什么 → 拉数 → 回填 → 出一句结论
 *
 * 设计原则（对标 OpenCLI 的 list/doctor 分工）：
 *   - 只做只读 + 本地文件回填，不做对外发布（发布仍要人点头）
 *   - 每一步都要有可核验输出，失败不吞
 *   - 排期来自一个 JSON 文件（--plan），数据回填到 CSV（--metrics）
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ConfigStore } from "../config.js";
import { XhsMcpClient, unwrapToolResult } from "../tools/xhs-mcp.js";
import { emitSuccess, emitFailure, formatTable } from "./output.js";

const TOUT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

export interface PlanItem {
  time?: string;
  platform: string;
  title: string;
  action?: string;
  note?: string;
  done?: boolean;
}
export interface PlanFile {
  date: string;
  items: PlanItem[];
}

async function readPlan(file?: string): Promise<PlanFile | null> {
  if (!file) return null;
  try {
    const raw = await fs.readFile(path.resolve(file), "utf-8");
    return JSON.parse(raw) as PlanFile;
  } catch {
    return null;
  }
}

/** 回填一行到 metrics.csv（存在才写；不改动已有行） */
async function appendMetrics(
  file: string | undefined,
  row: Record<string, string>,
): Promise<boolean> {
  if (!file) return false;
  try {
    const p = path.resolve(file);
    const exists = await fs.access(p).then(() => true).catch(() => false);
    const header =
      "date,platform,title,link,views,likes,collects,comments,shares,followers_gained,dm_leads,notes";
    const line = Object.values(row).join(",");
    if (!exists) {
      await fs.writeFile(p, `${header}\n${line}\n`, "utf-8");
    } else {
      const cur = await fs.readFile(p, "utf-8");
      if (cur.includes(row.title)) return false; // 已回填过，不重复
      await fs.writeFile(p, cur.replace(/\n*$/, "\n") + line + "\n", "utf-8");
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchToutiao(): Promise<Record<string, unknown>> {
  const cookies = await ConfigStore.getToutiaoCookies();
  if (!cookies || Object.keys(cookies).length === 0) return { status: "unconfigured" };
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const headers = {
    cookie,
    referer: "https://mp.toutiao.com/profile_v4/analysis/fans/overview",
    "user-agent": TOUT_UA,
    accept: "application/json",
  };
  const res = await fetch("https://mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat?app_id=1231", { headers });
  const body = (await res.json()) as {
    code?: number;
    date?: string;
    fans_stat?: { total_fans_count?: number; increase_count?: number; decrease_count?: number; active_fans_rate?: number };
  };
  const s = body.fans_stat;
  return {
    status: body.code === 0 ? "ok" : "invalid",
    statDate: body.date,
    totalFans: s?.total_fans_count,
    increase: s?.increase_count,
    decrease: s?.decrease_count,
  };
}

async function fetchXhs(): Promise<Record<string, unknown>> {
  const client = new XhsMcpClient();
  const health = await client.health();
  if (!health.ok) return { status: "down" };
  const res = await client.callTool("get_my_profile", { tab: "note" });
  const data = unwrapToolResult(res) as {
    interactions?: { type: string; count: string }[];
    feeds?: unknown[];
  };
  const pick = (t: string) => data?.interactions?.find((i) => i.type === t)?.count;
  return { status: "ok", fans: pick("fans"), follows: pick("follows"), notes: data?.feeds?.length ?? 0 };
}

export async function runDaily(options: {
  plan?: string;
  metrics?: string;
  date?: string;
  json?: boolean;
}): Promise<void> {
  const json = Boolean(options.json);
  const today = options.date || new Date().toISOString().slice(0, 10);
  try {
    const plan = await readPlan(options.plan);
    const [toutiao, xiaohongshu] = await Promise.all([
      fetchToutiao().catch((e): Record<string, unknown> => ({ status: "error", detail: (e as Error).message })),
      fetchXhs().catch((e): Record<string, unknown> => ({ status: "error", detail: (e as Error).message })),
    ]);

    const todays = (plan?.items ?? []).filter((i) => !i.done);
    const problems: string[] = [];
    if (toutiao.status !== "ok") problems.push(`头条凭据/接口异常（${toutiao.status}）`);
    if (xiaohongshu.status !== "ok") problems.push(`小红书通道异常（${xiaohongshu.status}）`);
    if (plan && plan.date !== today) problems.push(`排期文件是 ${plan.date}，不是今天 ${today}`);

    // 回填今天的头条数字（只写一行快照，不动历史行）
    let wrote = false;
    if (options.metrics && toutiao.status === "ok") {
      wrote = await appendMetrics(options.metrics, {
        date: today,
        platform: "头条号(账号快照)",
        title: `粉丝 ${toutiao.totalFans ?? "?"}／涨${toutiao.increase ?? "?"}／掉${toutiao.decrease ?? "?"}`,
        link: "",
        views: "", likes: "", collects: "", comments: "", shares: "",
        followers_gained: String(toutiao.increase ?? ""),
        dm_leads: "",
        notes: `活跃率 ${toutiao.activeRate ?? "-"}｜数据日 ${toutiao.statDate ?? "-"}｜自动回填`,
      });
    }

    const data = {
      date: today,
      plan: plan ? { date: plan.date, items: todays } : null,
      metrics: { toutiao, xiaohongshu },
      wrote,
      problems,
    };
    emitSuccess(data, {
      json,
      human: () =>
        [
          `【${today}】今日待发 ${todays.length} 条`,
          todays.length
            ? formatTable(
                todays.map((i) => ({
                  时间: i.time ?? "-",
                  平台: i.platform,
                  标题: i.title.slice(0, 40),
                  动作: i.action ?? "publish-draft",
                })),
              )
            : "(排期文件为空或没有 --plan)",
          "",
          `头条：粉丝 ${toutiao.totalFans ?? "-"}｜昨日 +${toutiao.increase ?? "-"}/-${toutiao.decrease ?? "-"}`,
          `小红书：粉丝 ${xiaohongshu.fans ?? "-"}｜笔记 ${xiaohongshu.notes ?? "-"}`,
          wrote ? "已回填 metrics.csv" : "未回填（无 --metrics 或数据异常）",
          problems.length ? `⚠️ ${problems.join("；")}` : "无异常",
        ].join("\n"),
    });
  } catch (err) {
    emitFailure({ code: "DAILY_FAILED", message: (err as Error).message }, { json });
  }
}
