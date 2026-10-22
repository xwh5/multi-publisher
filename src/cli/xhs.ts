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
