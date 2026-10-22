/**
 * xhs 命令 —— 直接把小红书 MCP 的工具暴露成 CLI（mpub 当 MCP 客户端）。
 *
 * 读工具直接跑；写工具（发布/评论/点赞/收藏/删 cookie）必须显式 --yes，
 * 因为小红书的写操作多数**不可撤销**（笔记发出去不能删）。
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { XhsMcpClient, unwrapToolResult, isWriteTool } from "../tools/xhs-mcp.js";
import { emitSuccess, emitFailure, formatTable } from "./output.js";
import { acquireWriteLease, writeLeaseKey } from "../tools/write-lease.js";

export async function runXhs(
  what: string,
  tool: string | undefined,
  options: { args?: string; yes?: boolean; json?: boolean } = {},
): Promise<void> {
  const json = Boolean(options.json);
  const client = new XhsMcpClient();

  try {
    if (what === "status") {
      const health = await client.health();
      if (!health.ok) {
        emitFailure(
          { code: "XHS_MCP_DOWN", message: health.detail, hint: "起服务：systemctl start xiaohongshu-mcp" },
          { json },
        );
        return;
      }
      const res = await client.callTool("check_login_status", {});
      const data = unwrapToolResult(res);
      emitSuccess({ health: health.data, login: data }, {
        json,
        human: () => `服务：在线\n登录：${typeof data === "string" ? data : JSON.stringify(data, null, 2)}`,
      });
      return;
    }

    if (what === "tools") {
      const tools = await client.listTools();
      emitSuccess({ count: tools.length, tools }, {
        json,
        human: () =>
          formatTable(
            tools.map((t) => ({
              工具: t.name,
              读写: isWriteTool(t.name, t) ? "写" : "读",
              说明: (t.description ?? "").slice(0, 46),
            })),
          ) + `\n\n共 ${tools.length} 个工具（写工具调用需 --yes）。`,
      });
      return;
    }

    if (what === "call") {
      const name = tool;
      if (!name) {
        emitFailure({ code: "MISSING_ARG", message: "请用 mpub xhs call <tool> --args '<json>'" }, { json });
        return;
      }
      const tools = await client.listTools();
      const info = tools.find((t) => t.name === name);
      if (!info) {
        emitFailure(
          { code: "UNKNOWN_TOOL", message: `MCP 里没有工具 ${name}`, hint: "mpub xhs tools 看清单" },
          { json },
        );
        return;
      }
      if (isWriteTool(name, info) && !options.yes) {
        emitFailure(
          {
            code: "NEEDS_CONFIRM",
            message: `${name} 是写操作（小红书多数不可撤销）`,
            hint: "确认无误后加 --yes 再跑",
          },
          { json },
        );
        return;
      }
      const args = options.args ? JSON.parse(options.args) : {};
      const lease = await acquireWriteLease(writeLeaseKey("xiaohongshu"), `xhs ${name}`);
      if (!lease.ok) {
        emitFailure(
          { code: "SESSION_BUSY", message: "小红书正在被另一个写操作占用", hint: lease.holder },
          { json },
        );
        return;
      }
      process.once("exit", () => lease.releaseSync?.());
      const res = await client.callTool(name, args);
      await lease.release?.();
      const data = unwrapToolResult(res);
      if (res.isError) {
        emitFailure({ code: "XHS_TOOL_ERROR", message: JSON.stringify(data) }, { json });
        return;
      }
      emitSuccess({ tool: name, data }, {
        json,
        human: () => (typeof data === "string" ? data : JSON.stringify(data, null, 2)),
      });
      return;
    }

    emitFailure(
      { code: "UNKNOWN_SUBCOMMAND", message: `未知子命令 ${what}`, hint: "可用：status / tools / call" },
      { json },
    );
  } catch (err) {
    emitFailure({ code: "XHS_MCP_FAILED", message: (err as Error).message }, { json });
  }
}

/**
 * mpub xhs publish —— 发一篇小红书图文，并**回查**（发完去我的主页看这篇在不在）。
 *
 * 为什么必须回查：小红书的 publish_content 返回成功不代表笔记真的发出去了
 * （上游 README 自己列了"显示发布成功但实际没发"的排查步骤）。
 * 而小红书笔记**不可删除** ⇒ 宁可报错，也不能假装成功。
 */
export async function runXhsPublish(options: {
  title?: string;
  bodyFile?: string;
  body?: string;
  images?: string[];
  tags?: string[];
  visibility?: string;
  isOriginal?: boolean;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  const json = Boolean(options.json);
  const title = options.title ?? "";
  const body = options.body ?? (options.bodyFile ? await readFile(path.resolve(options.bodyFile), "utf-8") : "");
  const images = options.images ?? [];
  if (!title) {
    emitFailure({ code: "MISSING_ARG", message: "请用 --title 指定标题" }, { json });
    return;
  }
  if ([...title].length > 20) {
    emitFailure(
      { code: "TITLE_TOO_LONG", message: `标题 ${[...title].length} 字 > 小红书上限 20`, hint: "标题是读者唯一看到的东西，压到 20 字内" },
      { json },
    );
    return;
  }
  if (!body) {
    emitFailure({ code: "MISSING_ARG", message: "请用 --body-file 或 --body 给正文" }, { json });
    return;
  }
  if ([...body].length > 1000) {
    emitFailure({ code: "BODY_TOO_LONG", message: `正文 ${[...body].length} 字 > 小红书上限 1000` }, { json });
    return;
  }
  if (images.length === 0) {
    emitFailure({ code: "MISSING_ARG", message: "至少给一张图（--image 可重复）" }, { json });
    return;
  }
  const missing = images.filter((f) => !existsSync(path.resolve(f)));
  if (missing.length) {
    emitFailure({ code: "IMAGE_NOT_FOUND", message: `图片不存在：${missing.join(", ")}` }, { json });
    return;
  }
  if (!options.yes) {
    emitFailure(
      {
        code: "NEEDS_CONFIRM",
        message: "小红书笔记发出后不可删除",
        hint: "确认内容与配图无误后加 --yes",
      },
      { json },
    );
    return;
  }

  const client = new XhsMcpClient();
  const lease = await acquireWriteLease(writeLeaseKey("xiaohongshu"), `xhs publish ${title}`);
  if (!lease.ok) {
    emitFailure({ code: "SESSION_BUSY", message: "小红书正在被另一个写操作占用", hint: lease.holder }, { json });
    return;
  }
  process.once("exit", () => lease.releaseSync?.());

  try {
    const args: Record<string, unknown> = {
      title,
      content: body,
      images: images.map((f) => path.resolve(f)),
    };
    if (options.tags?.length) args.tags = options.tags;
    if (options.visibility) args.visibility = options.visibility;
    if (options.isOriginal !== undefined) args.is_original = options.isOriginal;
    const res = await client.callTool("publish_content", args);
    await lease.release?.();
    const data = unwrapToolResult(res);
    if (res.isError) {
      emitFailure({ code: "XHS_PUBLISH_ERROR", message: JSON.stringify(data) }, { json });
      return;
    }
    // 回查：我的主页里应出现这篇
    let verified = false;
    let found: { title?: string; noteId?: string } | null = null;
    for (let i = 0; i < 6 && !verified; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const prof = await client.callTool("get_my_profile", { tab: "note" });
      const p = unwrapToolResult(prof) as { feeds?: { title?: string; noteId?: string; id?: string }[] };
      const hit = (p?.feeds ?? []).find((f) => (f.title || "").includes(title.slice(0, 8)));
      if (hit) {
        verified = true;
        found = { title: hit.title, noteId: hit.noteId ?? hit.id };
      }
    }
    if (!verified) {
      emitFailure(
        {
          code: "PUBLISH_UNCONFIRMED",
          message: `接口回了成功，但 30 秒内我的主页里没看到《${title}》`,
          hint: "先回查账号（可能是风控或重复内容被拦），**不要立刻重发**——笔记不可删",
        },
        { json },
      );
      return;
    }
    emitSuccess({ platform: "xiaohongshu", title, noteId: found?.noteId, verified: true, raw: data }, {
      json,
      human: () => `✅ 已发并回查通过：${found?.title ?? title}${found?.noteId ? `（note_id=${found.noteId}）` : ""}`,
    });
  } catch (err) {
    emitFailure({ code: "XHS_PUBLISH_FAILED", message: (err as Error).message }, { json });
  }
}

/**
 * mpub xhs trust —— 读某篇笔记的信任指标（赞/藏/转/评 + 三比率 + 留言样本）。
 *
 * 为什么要有：目标是"用收藏率/转发率/留言质量衡量信任度"，
 * 而这些数字必须能**一键读到**，否则回盘只能靠肉眼。
 */
export async function runXhsTrust(options: { title?: string; limit?: string; json?: boolean }): Promise<void> {
  const json = Boolean(options.json);
  const title = options.title ?? "";
  if (!title) {
    emitFailure({ code: "MISSING_ARG", message: "请用 --title 指定笔记标题（前 6 个字就够）" }, { json });
    return;
  }
  const client = new XhsMcpClient();
  const key = title.slice(0, 6);

  // 1) 搜索：结果自带标题 + 赞/藏/转/评（最省）
  let hit: {
    id: string;
    xsecToken: string;
    title: string;
    liked: number;
    collected: number;
    shared: number;
    commented: number;
  } | null = null;

  const num = (v: unknown): number => {
    const n = Number(String(v ?? 0).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  try {
    const s = await client.callTool("search_feeds", { keyword: key });
    const sd = unwrapToolResult(s) as {
      feeds?: {
        id?: string;
        xsecToken?: string;
        noteCard?: {
          displayTitle?: string;
          interactInfo?: Record<string, string | number>;
        };
      }[];
    };
    for (const f of sd?.feeds ?? []) {
      const t = f.noteCard?.displayTitle ?? "";
      if (!t.includes(key) || !f.id || !f.xsecToken) continue;
      const ii = f.noteCard?.interactInfo ?? {};
      hit = {
        id: f.id,
        xsecToken: f.xsecToken,
        title: t,
        liked: num(ii.likedCount),
        collected: num(ii.collectedCount),
        shared: num(ii.sharedCount),
        commented: num(ii.commentCount),
      };
      break;
    }
  } catch {
    /* 搜索失败就落到主页回退 */
  }

  // 2) 回退：我的主页（主页不带标题 ⇒ 逐条取详情比对）
  if (!hit) {
    const prof = await client.callTool("get_my_profile", { tab: "note" });
    const p = unwrapToolResult(prof) as {
      feeds?: {
        id?: string;
        xsecToken?: string;
        noteCard?: {
          displayTitle?: string;
          interactInfo?: Record<string, string | number>;
        };
      }[];
    };
    for (const f of (p?.feeds ?? []).slice(0, 12)) {
      if (!f.id || !f.xsecToken) continue;
      const t = f.noteCard?.displayTitle ?? "";
      if (!t.includes(key)) continue;
      const ii = f.noteCard?.interactInfo ?? {};
      hit = {
        id: f.id,
        xsecToken: f.xsecToken,
        title: t,
        liked: num(ii.likedCount),
        collected: num(ii.collectedCount),
        shared: num(ii.sharedCount),
        commented: num(ii.commentCount),
      };
      break;
    }
  }

  if (!hit) {
    emitFailure(
      { code: "NOTE_NOT_FOUND", message: `没找到《${title}》（搜索与主页都没命中）` },
      { json },
    );
    return;
  }

  // 3) 留言（判断"留言质量"要看到内容，不能只看条数）
  let list: { content?: string; user_info?: { nickname?: string } }[] = [];
  try {
    const res = await client.callTool("get_feed_detail", {
      feed_id: hit.id,
      xsec_token: hit.xsecToken,
      load_all_comments: true,
      limit: Number(options.limit ?? 20),
    });
    const d = unwrapToolResult(res) as {
      data?: {
        note?: { title?: string; interactInfo?: Record<string, string | number> };
        comments?: { list?: { content?: string; user_info?: { nickname?: string } }[] };
      };
      comments?: { list?: { content?: string; user_info?: { nickname?: string } }[] };
    };
    list = d?.data?.comments?.list ?? d?.comments?.list ?? [];
    const ni = d?.data?.note?.interactInfo ?? {};
    // 只补空缺：详情接口的分享/收藏字段可能是空串，不能覆盖搜索结果里的真值
    const fill = (cur: number, v: unknown): number => {
      const n = num(v);
      return cur > 0 ? cur : n;
    };
    hit.liked = fill(hit.liked, ni.likedCount);
    hit.collected = fill(hit.collected, ni.collectedCount);
    hit.shared = fill(hit.shared, ni.sharedCount);
    hit.commented = fill(hit.commented, ni.commentCount);
    if (d?.data?.note?.title) hit.title = d.data.note.title;
  } catch {
    /* 评论读不到不影响三个比率 */
  }

  // 4) 留言质量：含"具体处境/具体问题"的评论占比
  const specific = list.filter((c) =>
    /\d+\s*(年|岁|个月|人)|我在|我做的是|怎么接|哪家|收不收|能不能|适合|我的/.test(c.content ?? ""),
  );
  const data = {
    title: hit.title,
    noteId: hit.id,
    liked: hit.liked,
    collected: hit.collected,
    shared: hit.shared,
    commented: hit.commented,
    collectRatio: hit.liked ? +(hit.collected / hit.liked).toFixed(2) : null,
    shareRatio: hit.liked ? +(hit.shared / hit.liked).toFixed(2) : null,
    commentRatio: hit.liked ? +(hit.commented / hit.liked).toFixed(2) : null,
    specificCommentRatio: list.length ? +(specific.length / list.length).toFixed(2) : null,
    commentsFetched: list.length,
    commentSamples: list.slice(0, 8).map((c) => `${c.user_info?.nickname ?? "?"}: ${(c.content ?? "").slice(0, 50)}`),
  };
  emitSuccess(data, {
    json,
    human: () =>
      [
        `《${data.title}》`,
        `赞 ${hit.liked}｜藏 ${hit.collected}｜转 ${hit.shared}｜评 ${hit.commented}`,
        `收藏率 ${data.collectRatio ?? "?"}（清单/表类基准 ≥1.5）｜转发率 ${data.shareRatio ?? "?"}（避坑类基准 ≥1.0）`,
        `留言质量：具体处境型占比 ${data.specificCommentRatio ?? "?"}（基准 ≥0.5，取到 ${list.length} 条）`,
        "",
        "留言样本：",
        ...data.commentSamples.map((c) => "  " + c),
      ].join("\n"),
  });
}
