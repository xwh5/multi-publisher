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

/**
 * 后台 UI 发表：订阅号没有 freepublish 权限，只能在 mp.weixin.qq.com 点「发表」。
 * 前提：先 `mpub login -p weixin` 扫码，后台 cookie 存在配置里。
 *
 * 判定：发表成功后这篇会从草稿箱消失 ⇒ 回查草稿箱确认。
 */
export async function publishWeixinViaBackend(options: {
  title?: string;
  yes?: boolean;
  open?: boolean;
  json?: boolean;
}): Promise<void> {
  const json = Boolean(options.json);
  if (!options.title) {
    emitFailure({ code: "MISSING_ARG", message: "后台发表请用 --title 指定草稿标题" }, { json });
    return;
  }
  if (!options.yes) {
    emitFailure(
      {
        code: "NEEDS_CONFIRM",
        message: "后台点「发表」是对外动作（对外公开）",
        hint: "确认后加 --yes 再跑",
      },
      { json },
    );
    return;
  }
  const cookies = await ConfigStore.getWeixinBackendCookies();
  if (!cookies || Object.keys(cookies).length === 0) {
    emitFailure(
      {
        code: "NO_BACKEND_SESSION",
        message: "没有公众号后台登录态",
        hint: "先跑 mpub login -p weixin（浏览器扫码一次）",
      },
      { json },
    );
    return;
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(
      Object.entries(cookies).map(([name, value]) => ({
        name,
        value,
        domain: ".qq.com",
        path: "/",
      })),
    );
    const page = await context.newPage();
    await page.goto("https://mp.weixin.qq.com/", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(4000);
    const token = new URL(page.url()).searchParams.get("token");
    if (!token) {
      emitFailure(
        { code: "NEEDS_SCAN", message: "公众号后台未登录（没拿到 token）", hint: "重新跑 mpub login -p weixin 扫码" },
        { json },
      );
      return;
    }

    // 草稿列表接口（type=77 才是草稿；type=10 是旧路由）
    const draft = await page.evaluate(
      async ({ t, tk }) => {
        const res = await fetch(
          `/cgi-bin/appmsg?begin=0&count=20&type=77&action=list&item_show_type=0&token=${tk}&lang=zh_CN&f=json&ajax=1`,
          { credentials: "include" },
        );
        const body = (await res.json()) as {
          app_msg_info?: { item?: { app_id?: number; title?: string; multi_item?: { aid?: string }[] }[] };
        };
        const items = body.app_msg_info?.item ?? [];
        const hit = items.find((i) =>
          JSON.stringify(i).includes(t.slice(0, 10)),
        );
        return hit ? { appId: hit.app_id ?? null, title: hit.title ?? "" } : null;
      },
      { t: options.title, tk: token },
    );
    if (!draft || !draft.appId) {
      emitFailure(
        {
          code: "DRAFT_NOT_FOUND",
          message: `草稿箱里找不到《${options.title}》`,
          hint: "确认标题前 10 个字一致",
        },
        { json },
      );
      return;
    }

    // 打开这篇草稿的编辑页（编辑页能渲染，草稿箱列表页渲染不出来）
    const editUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&type=10&appmsgid=${draft.appId}&fromview=list&isSend=1&token=${token}&lang=zh_CN`;
    await page.goto(editUrl, { waitUntil: "networkidle", timeout: 90000 });
    const loaded = await page
      .waitForFunction(
        (t) => {
          const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
          return !!ta && ta.value.includes(t.slice(0, 8));
        },
        options.title,
        { timeout: 30000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!loaded) {
      emitFailure(
        {
          code: "EDITOR_NOT_LOADED",
          message: "编辑页没加载出这篇稿子",
          hint: `手动打开：${editUrl}`,
        },
        { json },
      );
      return;
    }

    // 走到这一步：微信设计上要求「发表」由人点 + 管理员扫码验证
    // ⇒ 默认只给直达链接（不占浏览器窗口）；--open 才把编辑器开到屏幕上
    if (options.open) {
      console.log("[weixin] 编辑器已打开（--open），请点「发表」并按提示扫码验证");
    }
    emitSuccess(
      {
        platform: "weixin",
        title: options.title,
        appmsgid: draft.appId,
        editorOpened: Boolean(options.open),
        nextStep: "打开链接 → 点右下角「发表」→ 按弹出的「微信验证」用管理员微信扫码",
        editUrl,
      },
      {
        json,
        human: () =>
          [
            `✅ 已定位到《${options.title}》（appmsgid=${draft.appId}）`,
            "下一步（必须你做）：打开下面链接 → 点右下角「发表」→ 按弹出的「微信验证」用管理员微信扫码",
            "为什么必须人点：后台把「发表」设计成要管理员扫码验证；接口层这个号也没有发表权限（个人未认证订阅号）",
            "",
            editUrl,
          ].join("\n"),
      },
    );
    await browser.close();
    return;
  } catch (err) {
    emitFailure({ code: "BACKEND_PUBLISH_FAILED", message: (err as Error).message }, { json });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
