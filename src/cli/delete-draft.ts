/**
 * delete-draft 命令 —— 删草稿。
 *   公众号：draft/delete（media_id）
 *   头条号：creator_center/delete_draft（按标题定位 gid）
 *   小红书：**没有删除接口**（笔记发出去就不能删，MCP 也没有）⇒ 如实说明
 */
import { ConfigStore } from "../config.js";
import { emitSuccess, emitFailure } from "./output.js";

const TOUT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

async function deleteWeixinDraft(mediaId: string): Promise<{ ok: boolean; detail: string }> {
  const cfg = await ConfigStore.getWeixin();
  if (!cfg.appId || !cfg.appSecret) throw new Error("未配置公众号 AppID/AppSecret");
  const tok = (await (
    await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg.appId}&secret=${cfg.appSecret}`,
    )
  ).json()) as { access_token?: string; errcode?: number; errmsg?: string };
  if (!tok.access_token) throw new Error(`取 token 失败：${tok.errcode} ${tok.errmsg}`);
  const res = (await (
    await fetch(`https://api.weixin.qq.com/cgi-bin/draft/delete?access_token=${tok.access_token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: mediaId }),
    })
  ).json()) as { errcode?: number; errmsg?: string };
  if (res.errcode) return { ok: false, detail: `${res.errcode} ${res.errmsg ?? ""}`.trim() };
  return { ok: true, detail: `已删除草稿 ${mediaId}` };
}

async function deleteToutiaoDraft(title: string): Promise<{ ok: boolean; detail: string }> {
  const cookies = await ConfigStore.getToutiaoCookies();
  if (!cookies || Object.keys(cookies).length === 0) throw new Error("未配置头条 cookie");
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers = {
    cookie,
    referer: "https://mp.toutiao.com/profile_v4/manage/draft?enter_from=left_menu",
    "user-agent": TOUT_UA,
    accept: "application/json",
  };
  const listRes = await fetch(
    "https://mp.toutiao.com/mp/agw/creator_center/draft_list?type=0&count=50&app_id=1231",
    { headers },
  );
  const body = (await listRes.json()) as { code?: number; message?: string };
  if (body.code !== 0) throw new Error(`草稿列表读取失败 code=${body.code} ${body.message ?? ""}`);
  const items: { title: string; gid: string; draft_type: number }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.title === "string" && obj.gid) {
      items.push({ title: obj.title, gid: String(obj.gid), draft_type: Number(obj.draft_type ?? 2) });
    }
    Object.values(obj).forEach(walk);
  };
  walk(body);
  const hit = items.find((i) => i.title === title) ?? items.find((i) => i.title.includes(title.slice(0, 10)));
  if (!hit) throw new Error(`草稿箱里找不到《${title}》（先跑 mpub list drafts -p toutiao）`);
  const delRes = await fetch(
    "https://mp.toutiao.com/mp/agw/creator_center/delete_draft?app_id=1231",
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ drafts: [{ draft_type: hit.draft_type, gid: hit.gid }] }),
    },
  );
  const del = (await delRes.json()) as { code?: number; message?: string };
  if (del.code !== 0) return { ok: false, detail: `code=${del.code} ${del.message ?? ""}`.trim() };
  return { ok: true, detail: `已删除草稿《${hit.title}》（gid=${hit.gid}）` };
}

export async function runDeleteDraft(options: {
  mediaId?: string;
  title?: string;
  platform?: string;
  json?: boolean;
}): Promise<void> {
  const json = Boolean(options.json);
  const platform = options.platform || "weixin";
  try {
    let res: { ok: boolean; detail: string };
    if (platform === "weixin") {
      if (!options.mediaId) {
        emitFailure({ code: "MISSING_ARG", message: "公众号删草稿需要 --media-id" }, { json });
        return;
      }
      res = await deleteWeixinDraft(options.mediaId);
    } else if (platform === "toutiao") {
      if (!options.title) {
        emitFailure({ code: "MISSING_ARG", message: "头条删草稿需要 --title（按标题定位）" }, { json });
        return;
      }
      res = await deleteToutiaoDraft(options.title);
    } else if (platform === "xiaohongshu") {
      emitFailure(
        {
          code: "NOT_SUPPORTED",
          message: "小红书没有删除笔记的接口（笔记发出即不可删，MCP 也没有）",
          hint: "能做的只有删登录态（get_login_qrcode 重新登录），别在草稿箱里留重稿",
        },
        { json },
      );
      return;
    } else {
      emitFailure({ code: "UNSUPPORTED", message: `暂不支持 ${platform} 删草稿`, hint: "已支持：weixin / toutiao" }, { json });
      return;
    }
    if (!res.ok) {
      emitFailure({ code: "DELETE_FAILED", message: res.detail }, { json });
      return;
    }
    emitSuccess({ platform, detail: res.detail }, { json, human: () => `✅ ${res.detail}` });
  } catch (err) {
    emitFailure({ code: "DELETE_FAILED", message: (err as Error).message }, { json });
  }
}
