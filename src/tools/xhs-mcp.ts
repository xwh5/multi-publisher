/**
 * 小红书 MCP 客户端（MCP Streamable HTTP / JSON-RPC 薄客户端）。
 *
 * 为什么是 MCP 而不是 Playwright 直驱（2026-10-22 实测）：
 *  - 小红书 creator 端的登录态**一半在浏览器内存的 localStorage**，cookies.json 只有 16 条 cookie
 *  - 用同一份 cookie 起 Playwright（headless 与 headed 都试过）⇒ 一律被重定向到 /login
 *  - MCP 服务也没开 CDP 端口（只有 :18060），没法 attach 它的浏览器
 *  - 且官方明确：**同一账号不允许在多个网页端登录**，两边各自登录会互踢
 * ⇒ 结论：小红书这条通道**由 MCP 服务独占浏览器**，mpub 当客户端调它的工具；
 *   mpub 自己保留渲染/文案/配图/闸门/回查/记账的掌控权。
 */

export interface XhsToolInfo {
  name: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export interface XhsToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: unknown;
}

const DEFAULT_URL = process.env.XHS_MCP_URL || "http://127.0.0.1:18060/mcp";
const HEALTH_URL = process.env.XHS_MCP_URL
  ? process.env.XHS_MCP_URL.replace(/\/mcp$/, "") + "/health"
  : "http://127.0.0.1:18060/health";

export class XhsMcpClient {
  constructor(
    private readonly url: string = DEFAULT_URL,
    private readonly token?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /** 健康检查（服务在不在、是不是本地那套） */
  async health(): Promise<{ ok: boolean; detail: string; data?: unknown }> {
    try {
      const res = await fetch(HEALTH_URL);
      const body = (await res.json()) as { success?: boolean; data?: unknown };
      return { ok: Boolean(body.success), detail: body.success ? "服务在线" : "服务回 success=false", data: body.data };
    } catch (err) {
      return { ok: false, detail: `服务不在（${HEALTH_URL}）：${(err as Error).message}` };
    }
  }

  private async rpc<T>(method: string, params: unknown, id: number): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
    });
    if (!res.ok) {
      throw new Error(`MCP ${method} HTTP ${res.status}：${(await res.text()).slice(0, 200)}`);
    }
    const body = (await res.json()) as {
      result?: T;
      error?: { code?: number; message?: string };
    };
    if (body.error) {
      throw new Error(`MCP ${method} 报错 ${body.error.code ?? "?"}：${body.error.message ?? ""}`);
    }
    return body.result as T;
  }

  async listTools(): Promise<XhsToolInfo[]> {
    const res = await this.rpc<{ tools?: XhsToolInfo[] }>("tools/list", {}, 1);
    return res.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<XhsToolResult> {
    return this.rpc<XhsToolResult>("tools/call", { name, arguments: args }, 2);
  }
}

/** 工具返回值统一解包：优先 structuredContent，其次 content[0].text（能 JSON 就解析） */
export function unwrapToolResult(res: XhsToolResult): unknown {
  if (res.structuredContent !== undefined && res.structuredContent !== null) {
    return res.structuredContent;
  }
  const text = res.content?.find((c) => c.type === "text")?.text;
  if (text === undefined) return res;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 写操作判定（OpenCLI 的 access: read|write 纪律） */
const WRITE_TOOL_PATTERNS = [
  /^publish/,
  /^post_/,
  /^reply_/,
  /^like_/,
  /^favorite_/,
  /^delete_/,
  /^unfavorite/,
  /^unlike/,
];

export function isWriteTool(name: string, info?: XhsToolInfo): boolean {
  if (info?.annotations?.readOnlyHint === true) return false;
  if (info?.annotations?.destructiveHint === true) return true;
  return WRITE_TOOL_PATTERNS.some((p) => p.test(name));
}
