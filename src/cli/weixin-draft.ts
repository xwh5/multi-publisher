/**
 * 公众号草稿运营命令：删草稿 / 改草稿 / 发表草稿。
 *
 * 平台限制（2026-10-22 实测，订阅号）：
 *   draft/add、draft/get、draft/count、draft/update、draft/delete ⇒ 可用
 *   freepublish/submit（发表）⇒ errcode 48001 api unauthorized ⇒ 只能人在后台点「发表」
 *   user/info（粉丝数）      ⇒ errcode 48001 ⇒ 粉丝数只能从后台读
 * 所以命令在无权限时**如实报错并给出人工路径**，不假装成功。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConfigStore } from "../config.js";
import { renderMarkdown } from "../core/renderer.js";
import { emitSuccess, emitFailure } from "./output.js";

async function weixinToken(): Promise<string> {
  const cfg = await ConfigStore.getWeixin();
  if (!cfg.appId || !cfg.appSecret) {
    throw new Error("未配置公众号 AppID/AppSecret（mpub credential --app-id ... --app-secret ...）");
  }
  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg.appId}&secret=${cfg.appSecret}`,
  );
  const tok = (await res.json()) as { access_token?: string; errcode?: number; errmsg?: string };
  if (!tok.access_token) {
    throw new Error(`取 access_token 失败：${tok.errcode ?? "?"} ${tok.errmsg ?? ""}`.trim());
  }
  return tok.access_token;
}

async function weixinGet<T>(token: string, pathAndQuery: string): Promise<T> {
  const res = await fetch(
    `https://api.weixin.qq.com${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}access_token=${token}`,
  );
  return (await res.json()) as T;
}

async function weixinPost<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.weixin.qq.com${path}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

interface WeixinErr {
  errcode?: number;
  errmsg?: string;
}

/** 删草稿 */
export async function runDeleteDraft(options: {
  mediaId?: string;
  platform?: string;
  json?: boolean;
}): Promise<void> {
  const json = Boolean(options.json);
  if (options.platform && options.platform !== "weixin") {
    emitFailure({ code: "UNSUPPORTED", message: `删草稿目前只支持 weixin（收到 ${options.platform}）` }, { json });
    return;
  }
  if (!options.mediaId) {
    emitFailure({ code: "MISSING_ARG", message: "请用 --media-id 指定草稿 media_id" }, { json });
    return;
  }
  try {
    const token = await weixinToken();
    const res = await weixinPost<WeixinErr>(token, "/cgi-bin/draft/delete", {
      media_id: options.mediaId,
    });
    if (res.errcode) {
      emitFailure(
        {
          code: `WECHAT_${res.errcode}`,
          message: res.errmsg ?? "删除失败",
          hint: "media_id 不对或已失效；先用 mpub publish 输出里的 media_id",
        },
        { json },
      );
      return;
    }
    emitSuccess({ deleted: options.mediaId }, { json, human: () => `✅ 已删除草稿 ${options.mediaId}` });
  } catch (err) {
    emitFailure({ code: "DELETE_FAILED", message: (err as Error).message }, { json });
  }
}

/** 改草稿（渲染 Markdown → draft/update；草稿改完仍在箱里，发表仍需人工） */
export async function runUpdateDraft(options: {
  mediaId?: string;
  file?: string;
  json?: boolean;
}): Promise<void> {
  const json = Boolean(options.json);
  if (!options.mediaId || !options.file) {
    emitFailure(
      { code: "MISSING_ARG", message: "请用 --media-id 指定草稿、-f 指定新的 Markdown" },
      { json },
    );
    return;
  }
  try {
    const token = await weixinToken();
    // 先取旧稿：thumb_media_id 必填（更新时不能丢），正文/标题按新稿替换
    // 注意：draft/get 只能 POST（GET 会回 43002 require POST method）
    const old = await weixinPost<WeixinErr & {
      news_item?: { title?: string; content?: string; thumb_media_id?: string; author?: string; digest?: string }[];
    }>(token, "/cgi-bin/draft/get", { media_id: options.mediaId });
    if (old.errcode || !old.news_item?.[0]) {
      emitFailure(
        { code: `WECHAT_${old.errcode ?? "?"}`, message: old.errmsg ?? "取不到原草稿" },
        { json },
      );
      return;
    }
    const prev = old.news_item[0];
    const source = await readFile(options.file, "utf-8");
    const rendered = await renderMarkdown(source, { theme: "wechat", macStyle: true });
    if (!rendered.title) {
      emitFailure({ code: "NO_TITLE", message: "新稿 front-matter 缺 title" }, { json });
      return;
    }
    const res = await weixinPost<WeixinErr>(token, "/cgi-bin/draft/update", {
      media_id: options.mediaId,
      index: 0,
      articles: {
        title: rendered.title,
        author: rendered.author ?? prev.author ?? "",
        digest: rendered.summary ?? prev.digest ?? "",
        content: rendered.html,
        thumb_media_id: prev.thumb_media_id ?? "",
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    });
    if (res.errcode) {
      emitFailure(
        {
          code: `WECHAT_${res.errcode}`,
          message: res.errmsg ?? "更新失败",
          hint: "封面 thumb_media_id 取自旧稿；若旧稿没有封面，先给新稿加 cover 再发",
        },
        { json },
      );
      return;
    }
    emitSuccess(
      { mediaId: options.mediaId, title: rendered.title },
      { json, human: () => `✅ 已更新草稿 ${options.mediaId}（标题：${rendered.title}）\n   发表仍需在后台点「发表」（订阅号无发表 API 权限）` },
    );
  } catch (err) {
    emitFailure({ code: "UPDATE_FAILED", message: (err as Error).message }, { json });
  }
}

/** 发表草稿：订阅号通常无权限 → 如实说明人工路径 */
export async function runPublishWeixinDraft(options: {
  mediaId?: string;
  json?: boolean;
}): Promise<void> {
  const json = Boolean(options.json);
  if (!options.mediaId) {
    emitFailure({ code: "MISSING_ARG", message: "请用 --media-id 指定草稿" }, { json });
    return;
  }
  try {
    const token = await weixinToken();
    const res = await weixinPost<WeixinErr & { publish_id?: string }>(
      token,
      "/cgi-bin/freepublish/submit",
      { media_id: options.mediaId },
    );
    if (res.errcode) {
      const unauthorized = res.errcode === 48001;
      emitFailure(
        {
          code: `WECHAT_${res.errcode}`,
          message: res.errmsg ?? "发表失败",
          hint: unauthorized
            ? "该订阅号没有「发表」API 权限（errcode 48001）⇒ 请到公众号后台 → 草稿箱点「发表」；草稿已就绪，不会丢"
            : "检查 media_id 与接口权限",
        },
        { json },
      );
      return;
    }
    emitSuccess({ publishId: res.publish_id, mediaId: options.mediaId }, {
      json,
      human: () => `✅ 已发表（publish_id=${res.publish_id}）`,
    });
  } catch (err) {
    emitFailure({ code: "PUBLISH_FAILED", message: (err as Error).message }, { json });
  }
}
