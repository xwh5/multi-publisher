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
): Promise<"written" | "duplicate" | "failed"> {
  if (!file) return "failed";
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
      // 用日期+平台做去重，避免标题里含特殊字符时 contains 误判
      const sig = `${row.date},${row.platform}`;
      if (cur.includes(sig)) return "duplicate"; // 今日已回填过，不重复
      await fs.writeFile(p, cur.replace(/\n*$/, "\n") + line + "\n", "utf-8");
    }
    return "written";
  } catch {
    return "failed";
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


/** 读 metrics.csv，算最近 N 天的私信线索总数（商业化/信任度的先行指标） */
async function readDmLeads(file: string | undefined, days: number): Promise<{ total: number; rows: number }> {
  if (!file) return { total: -1, rows: 0 };
  try {
    const raw = await fs.readFile(path.resolve(file), "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const head = lines[0].split(",");
    const iDate = head.indexOf("date");
    const iDm = head.indexOf("dm_leads");
    if (iDate < 0 || iDm < 0) return { total: -1, rows: 0 };
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    let total = 0;
    let rows = 0;
    for (const line of lines.slice(1)) {
      const c = line.split(",");
      if (!c[iDate] || c[iDate] < cutoff) continue;
      rows++;
      total += Number(c[iDm] || 0) || 0;
    }
    return { total, rows };
  } catch {
    return { total: -1, rows: 0 };
  }
}

export async function runDaily(options: {
  plan?: string;
  metrics?: string;
  date?: string;
  judge?: boolean;
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
    if (plan && plan.date < today) problems.push(`排期文件已过期（${plan.date} < ${today}），请更新`);

    // 回填今天的头条数字（只写一行快照，不动历史行）
    let writeStatus: "written" | "duplicate" | "failed" | "skipped" = "skipped";
    if (options.metrics && toutiao.status === "ok") {
      writeStatus = await appendMetrics(options.metrics, {
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

    // 止损线判定：能自动取到的数据（头条作品阅读数）自动判，取不到的不猜
    const verdicts: { rule: string; hit: boolean; evidence: string; action: string }[] = [];
    if (options.judge !== false) {
      try {
        const { listToutiaoWorksForJudge } = await import("./list.js");
        const works = await listToutiaoWorksForJudge(12);
        // 只统计「发布满 24 小时」的篇：刚发的必然 0 阅读，计进去＝必然假触发
        const now = Date.now();
        const ageHours = (t: unknown): number => {
          const m = String(t ?? "").match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
          if (!m) return 0;
          const d = new Date(`${new Date(now).getFullYear()}-${m[1]}-${m[2]}T${m[3]}:${m[4]}:00+08:00`);
          return (now - d.getTime()) / 3600000;
        };
        const mature = works.filter((w) => ageHours(w.time) >= 24);
        const recent = mature.slice(0, 5);
        const lowReads = recent.filter((w) => Number(w.reads) < 500).length;
        const fresh = works.filter((w) => ageHours(w.time) < 24);
        verdicts.push({
          rule: "头条连续 5 篇阅读 <500 ⇒ 换标题公式",
          hit: recent.length >= 5 && lowReads === recent.length,
          evidence: `满 24h 的最近 ${recent.length} 篇阅读：${recent.map((w) => String(w.reads)).join("/")}（${lowReads} 篇 <500）；未满 24h 的 ${fresh.length} 篇展现：${fresh.map((w) => String(w.impressions)).join("/")}`,
          action: "标题按历史高展现形态重写：数字 + 具体物 + 事件感 + 圈层黑话（见 references/信任指标.md）",
        });
      } catch (err) {
        verdicts.push({
          rule: "头条止损线",
          hit: false,
          evidence: `作品数据读取失败：${(err as Error).message}`,
          action: "手动核对 mpub list works -p toutiao",
        });
      }
      const dm = await readDmLeads(options.metrics, 14);
      verdicts.push({
        rule: "三平台 2 周 0 私信 ⇒ 加交付过程类内容",
        hit: dm.total === 0,
        evidence: dm.total < 0 ? "metrics.csv 未提供或无 dm_leads 列" : `近 14 天私信线索 ${dm.total} 条（回填 ${dm.rows} 行）`,
        action: "加一节'我交付过什么'（可带走物从'判断'升级为'交付样例'）",
      });
    }

    const data = {
      date: today,
      plan: plan ? { date: plan.date, items: todays } : null,
      metrics: { toutiao, xiaohongshu },
      wrote: writeStatus === "written",
      writeStatus,
      problems,
      verdicts,
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
          writeStatus === "written"
            ? "已回填 metrics.csv"
            : writeStatus === "duplicate"
              ? "今日快照已存在，不重复写"
              : !options.metrics
                ? "未回填（无 --metrics）"
                : "未回填（数据异常，见 problems）",
          problems.length ? `⚠️ ${problems.join("；")}` : "无异常",
          ...(verdicts.length
            ? ["", "止损线判定：", ...verdicts.map((v) => `  ${v.hit ? "🔴 触发" : "🟢 未触发"}｜${v.rule}\n     证据：${v.evidence}\n     动作：${v.action}`)]
            : []),
        ].join("\n"),
    });
  } catch (err) {
    emitFailure({ code: "DAILY_FAILED", message: (err as Error).message }, { json });
  }
}
