/**
 * publish-draft 命令 —— 发表**已有草稿**（按标题定位）。
 *
 * 与 `mpub publish` 的区别：
 *   publish        渲染新稿 → 进草稿箱（--publish-now 则顺带发表）
 *   publish-draft  不重渲染，直接把草稿箱里那篇真发表（草稿会从箱里消失）
 */
import { createNodeRuntime } from "../runtime/node-runtime.js";
import { initAdapterRegistry, getAdapter } from "../adapters/index.js";
import { emitSuccess, emitFailure } from "./output.js";
import { acquireWriteLease, writeLeaseKey } from "../tools/write-lease.js";

export async function runPublishDraft(options: {
  title?: string;
  platform?: string;
  json?: boolean;
}): Promise<void> {
  const title = options.title;
  if (!title) {
    emitFailure(
      { code: "MISSING_ARG", message: "请用 --title 指定草稿标题", hint: "mpub list drafts -p toutiao 看现有草稿" },
      { json: options.json },
    );
    return;
  }
  const platformId = options.platform || "toutiao";
  const runtime = createNodeRuntime();
  await initAdapterRegistry(runtime);
  const adapter = getAdapter(platformId);
  if (!adapter) {
    emitFailure({ code: "UNKNOWN_PLATFORM", message: `不支持的平台: ${platformId}` }, { json: options.json });
    return;
  }
  if (!adapter.publishDraftByTitle) {
    emitFailure(
      {
        code: "UNSUPPORTED",
        message: `${platformId} 不支持按标题发表草稿`,
        hint: "已支持：toutiao",
      },
      { json: options.json },
    );
    return;
  }
  const lease = await acquireWriteLease(writeLeaseKey(platformId), `publish-draft ${title}`);
  if (!lease.ok) {
    emitFailure(
      { code: "SESSION_BUSY", message: `${platformId} 正在被另一个发布任务占用`, hint: lease.holder },
      { json: options.json },
    );
    return;
  }
  process.once("exit", () => lease.releaseSync?.());
  const res = await adapter.publishDraftByTitle(title);
  await lease.release?.();
  if (!res.success) {
    emitFailure(
      { code: "PUBLISH_DRAFT_FAILED", message: res.error ?? "未知错误" },
      { json: options.json },
    );
    return;
  }
  emitSuccess(
    { platform: platformId, title, postId: res.postId, postUrl: res.postUrl },
    {
      json: options.json,
      human: () =>
        [
          `✅ 已发表：${title}`,
          res.postUrl ? `🔗 ${res.postUrl}` : "",
          "（回查：草稿箱里这篇已不在）",
        ]
          .filter(Boolean)
          .join("\n"),
    },
  );
}
