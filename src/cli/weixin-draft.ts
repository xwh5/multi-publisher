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
        message: "后台点「发表」是对外动作（不可撤销地公开）",
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
    // 1) 首页会带 token 跳到后台
    await page.goto("https://mp.weixin.qq.com/", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(4000);
    const token = new URL(page.url()).searchParams.get("token");
    if (!token) {
      const stillLogin = await page.evaluate(() => document.body.innerText.includes("扫码登录"));
      emitFailure(
        {
          code: stillLogin ? "NEEDS_SCAN" : "NO_TOKEN",
          message: stillLogin
            ? "公众号后台未登录（页面在等扫码）"
            : `没拿到后台 token（当前 URL=${page.url()}）`,
          hint: "重新跑 mpub login -p weixin 扫码",
        },
        { json },
      );
      return;
    }
    console.log("[weixin] 后台 token 已拿到");

    // 2) 草稿箱
    const draftUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=10&action=list_card&token=${token}&lang=zh_CN`;
    await page.goto(draftUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(5000);
    const title = options.title;
    const before = await page.evaluate((t) => document.body.innerText.includes(t), title);
    if (!before) {
      emitFailure(
        { code: "DRAFT_NOT_FOUND", message: `草稿箱里找不到《${title}》`, hint: "确认标题完全一致（草稿箱按标题显示）" },
        { json },
      );
      return;
    }
    console.log("[weixin] 草稿已找到，点发表");

    // 3) 点该行的「发表」
    const clicked = await page.evaluate((t) => {
      const rows = [...document.querySelectorAll("a, span, em, div")].filter(
        (e) => e.children.length === 0 && (e.textContent || "").trim() === t,
      );
      const row = rows[0]?.closest("li, tr, .weui-desktop-card, div.weui-desktop-card__content") || rows[0]?.parentElement?.parentElement;
      const scope = row?.parentElement || row;
      const btn = scope?.querySelector?.("a, button") as HTMLElement | null;
      if (!btn) return false;
      btn.click();
      return true;
    }, title);
    if (!clicked) {
      emitFailure({ code: "PUBLISH_BTN_NOT_FOUND", message: "没找到这一行的「发表」按钮" }, { json });
      return;
    }
    await page.waitForTimeout(3000);
    // 4) 确认弹窗
    const confirm = page.locator("button:visible").filter({ hasText: /^(确定|发表|确认发表|发送)$/ }).last();
    if (await confirm.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log("[weixin] 二次确认:", (await confirm.textContent())?.trim());
      await confirm.click({ force: true });
    }
    await page.waitForTimeout(6000);
    await page.screenshot({ path: "/tmp/weixin-publish.png" });

    // 5) 回查：草稿箱里这篇应消失
    await page.goto(draftUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(5000);
    const stillThere = await page.evaluate((t) => document.body.innerText.includes(t), title);
    if (stillThere) {
      emitFailure(
        { code: "PUBLISH_UNCONFIRMED", message: "点了发表后草稿仍在箱里，未确认", hint: "可能弹窗没确认成功，看 /tmp/weixin-publish.png" },
        { json },
      );
      return;
    }
    emitSuccess({ platform: "weixin", title, published: true }, {
      json,
      human: () => `✅ 已发表：${title}（回查：草稿箱里这篇已不在）`,
    });
  } catch (err) {
    emitFailure({ code: "BACKEND_PUBLISH_FAILED", message: (err as Error).message }, { json });
  } finally {
    await browser.close();
  }
}
