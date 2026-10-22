/**
 * xhs 命令 —— 直接把小红书 MCP 的工具暴露成 CLI（mpub 当 MCP 客户端）。
 *
 * 读工具直接跑；写工具（发布/评论/点赞/收藏/删 cookie）必须显式 --yes，
 * 因为小红书的写操作多数**不可撤销**（笔记发出去不能删）。
 */
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
