/**
 * 头条号 (Toutiao) 适配器
 * 使用 Playwright 直接操作页面发布
 */
import { chromium } from "playwright";
import type { Page } from "playwright";
import type {
  Article,
  AuthResult,
  PlatformMeta,
  SyncResult,
} from "./interface.js";
import { ConfigStore } from "../config.js";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "os";
import { downloadCoverUrl } from "../tools/cover-fetcher.js";
import { processMermaid } from "../core/renderer.js";

export class ToutiaoAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: "toutiao",
    name: "头条号",
    icon: "https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/bytedoctor/1.0.14/favicon.ico",
    homepage: "https://mp.toutiao.com/",
    capabilities: ["article", "draft", "image_upload"],
  };

  private cookieData: Record<string, string> | null = null;

  async init(): Promise<void> {
    this.cookieData = await ConfigStore.getToutiaoCookies();
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: "未配置头条号 Cookie" };
    }
    const hasSession =
      this.cookieData["sessionid"] || this.cookieData["sid_tt"];
    if (!hasSession) {
      return { isAuthenticated: false, error: "登录已过期" };
    }
    return { isAuthenticated: true };
  }

  async processMermaid(
    html: string,
  ): Promise<{ html: string; tempFiles: string[] }> {
    const { html: processed, tempFiles } = await processMermaid(
      html,
      os.tmpdir(),
    );

    // 注意：本地图片（含 mermaid 产物）不在转换期上传，
    // 统一由 uploadImagesToToutiao 在浏览器上下文上传到头条自家图床（img.toutiaoimg.com），
    // 外部图床（catbox 等）会被头条编辑器过滤导致正文图片不显示
    return { html: processed, tempFiles };
  }

  /**
   * 把正文中的本地图片上传到头条自家图床（spice/image API），
   * 返回替换了 img src 的 HTML。外部图床 URL 会被头条编辑器过滤。
   */
  async uploadImagesToToutiao(
    page: import("playwright").Page,
    html: string,
    baseDir?: string,
  ): Promise<string> {
    const imgPattern = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
    const localSrcs: string[] = [];
    for (const match of html.matchAll(imgPattern)) {
      const src = match[1];
      if (!src.startsWith("http://") && !src.startsWith("https://")) {
        localSrcs.push(src);
      }
    }
    if (localSrcs.length === 0) return html;

    // 创建隐藏 file input 用于注入本地文件
    await page
      .evaluate(() => {
        if (!document.getElementById("__mpub_upload")) {
          const i = document.createElement("input");
          i.type = "file";
          i.id = "__mpub_upload";
          i.style.display = "none";
          document.body.appendChild(i);
        }
      })
      .catch(() => {});
    const input = page.locator("#__mpub_upload");

    let result = html;
    for (const src of localSrcs) {
      const abs = path.isAbsolute(src)
        ? src
        : path.resolve(baseDir || ".", src);
      if (!existsSync(abs)) {
        console.warn(`[toutiao] 正文图片不存在，跳过: ${abs}`);
        continue;
      }
      try {
        await input.setInputFiles(abs);
        const url = await page
          .evaluate(async () => {
            const el = document.getElementById(
              "__mpub_upload",
            ) as HTMLInputElement;
            const file = el?.files?.[0];
            if (!file) return null;
            const fd = new FormData();
            fd.append("image", file);
            const res = await fetch(
              "https://mp.toutiao.com/spice/image?upload_source=20020003&aid=1231&device_platform=web",
              { method: "POST", body: fd },
            );
            const data = (await res.json()) as {
              code?: number;
              data?: { image_url?: string };
            };
            return data?.code === 0 ? (data.data?.image_url ?? null) : null;
          })
          .catch(() => null);
        if (url) {
          result = result.replace(src, url);
          console.log(`[toutiao] 正文图片已上传头条: ${url.slice(0, 90)}...`);
        } else {
          console.warn(`[toutiao] 正文图片上传头条失败: ${src}`);
        }
      } catch (err) {
        console.warn(
          `[toutiao] 正文图片处理异常 ${src}: ${(err as Error).message}`,
        );
      }
    }
    return result;
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now();
    if (!this.cookieData) {
      return {
        platform: this.meta.id,
        success: false,
        error: "未配置头条号 Cookie",
        timestamp: Date.now() - start,
      };
    }

    // 处理 Mermaid 代码块（转换为图片并上传到公开 URL）
    let processedArticle = article;
    if (this.processMermaid && article.html) {
      const { html: mermaidHtml, tempFiles } = await this.processMermaid(
        article.html,
      );
      processedArticle = { ...article, html: mermaidHtml };
      await Promise.all(tempFiles.map((f) => fs.unlink(f).catch(() => {})));
    }

    const browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-devtools-shm-usage",
        "--no-sandbox",
      ],
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        // 正文用剪贴板粘贴注入，需要剪贴板权限
        permissions: ["clipboard-read", "clipboard-write"],
        // 不覆写 UA：覆写成旧版本 Chrome 会让 UA 与 sec-ch-ua 打架，
        // 被头条风控判为异常请求，服务端返回 7050「保存失败」（2026-10-22 实测）
      });
      const page = await context.newPage();

      // 记录头条的写接口回执：只有服务端明确返回 code=0，才算草稿投递成功。
      // 教训（2026-10-22）：HTTP 200 不代表成功，头条会在 200 的 body 里回
      // {"code":7050,"message":"保存失败"}；也曾把「封面图片信息查询」误当成保存成功。
      const saveResponses: { url: string; status: number; body: string }[] = [];
      page.on("response", (res) => {
        const url = res.url();
        if (
          res.request().method() !== "GET" &&
          /draft|save|publish|article/i.test(url)
        ) {
          saveResponses.push({ url, status: res.status(), body: "" });
          res
            .text()
            .then((t) => {
              const rec = saveResponses[saveResponses.length - 1];
              if (rec) rec.body = t.slice(0, 300);
            })
            .catch(() => undefined);
        }
      });

      // 使用 CDP 隐藏自动化特征
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
          window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
        `,
      });

      // 设置 cookies
      const pageCookies = Object.entries(this.cookieData).map(
        ([name, value]) => ({
          name,
          value,
          domain: ".toutiao.com",
          path: "/",
        }),
      );
      await context.addCookies(pageCookies);

      console.log("[toutiao] 正在打开头条号编辑器...");

      await page.goto("https://mp.toutiao.com/profile_v4/graphic/publish", {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForTimeout(3000);

      if (page.url().includes("login")) {
        return {
          platform: this.meta.id,
          success: false,
          error: "未登录或登录已过期，请重新登录",
          timestamp: Date.now() - start,
        };
      }

      // 关闭弹窗
      try {
        const mask = page.locator(".byte-drawer-mask").first();
        if (await mask.isVisible({ timeout: 1000 })) {
          await mask.click({ force: true });
          await page.waitForTimeout(500);
        }
      } catch (e) {
        console.warn("[toutiao] 关闭提示遮罩失败，继续:", (e as Error).message);
      }

      // 填写标题：必须逐字敲（fill() 不触发头条标题框的绑定，
      // 服务端会因标题为空返回 7050「保存失败」——2026-10-22 实测）
      const titleTextarea = page.locator("textarea").first();
      await titleTextarea.click({ force: true });
      await page.keyboard.type(processedArticle.title, { delay: 8 });
      await page.waitForTimeout(500);
      const typedTitle = await titleTextarea.inputValue().catch(() => "");
      if (typedTitle.trim() !== processedArticle.title.trim()) {
        await titleTextarea.fill(processedArticle.title);
      }
      console.log("[toutiao] 已填写标题");

      // 填写内容
      const contentEl = page.locator('div[contenteditable="true"]').first();
      if (await contentEl.isVisible({ timeout: 2000 }).catch(() => false)) {
        await contentEl.click();
        await page.keyboard.press("Control+a");
        await page.waitForTimeout(200);
        const htmlContent =
          processedArticle.html || processedArticle.markdown || "";
        // 正文本地图片上传到头条自家图床（外部图床会被头条编辑器过滤）
        const finalHtml = await this.uploadImagesToToutiao(
          page,
          htmlContent,
          (processedArticle as { baseDir?: string }).baseDir,
        );
        // 注入富文本：头条编辑器只认自己的 paste 解析，
        // 直接 innerHTML 注入进不了数据模型（服务端返回 7050「保存失败」）
        const fillMode = await this.fillRichText(page, finalHtml);
        console.log("[toutiao] 已填写内容，注入方式:", fillMode);
        await page.waitForTimeout(1000);
      }

      // 如果有封面图片，先下载 URL 封面到本地，再上传
      if (processedArticle.cover) {
        let localCover = processedArticle.cover;

        // 如果是 URL 封面，先下载到本地
        if (!existsSync(processedArticle.cover)) {
          console.log("[toutiao] 封面是 URL，正在下载到本地...");
          const downloadResult = await downloadCoverUrl(processedArticle.cover);
          if (!downloadResult.success || !downloadResult.localPath) {
            console.warn(
              `[toutiao] 封面下载失败: ${downloadResult.error}，跳过封面上传`,
            );
          } else {
            localCover = downloadResult.localPath;
            console.log(`[toutiao] 封面下载成功: ${localCover}`);
          }
        }

        if (existsSync(localCover)) {
          console.log("[toutiao] 检测到封面图片，准备上传...");
          const absolutePath = path.resolve(localCover);
          console.log("[toutiao] 封面文件路径:", absolutePath);

          // 头条新版封面交互（编辑器页面底部封面区）：
          // 1) 编辑器内各种遮罩/抽屉会拦截点击，全部移除
          await page
            .evaluate(() => {
              document
                .querySelectorAll(
                  '.byte-drawer-mask, [class*="ai-assistant"], [class*="byte-drawer"]',
                )
                .forEach((el) => el.remove());
            })
            .catch(() => {});
          await page.waitForTimeout(500);

          // 2) 必须先选"单图"，封面区才会出现上传界面（必须点 label，text= 选择器可能点到非交互元素）
          const radioGroup = page.locator(".article-cover-radio-group");
          const radioLabels = radioGroup.locator("label, .byte-radio");
          const radioCount = await radioLabels.count().catch(() => 0);
          let radioSelected = false;
          for (let i = 0; i < radioCount; i++) {
            const t =
              (await radioLabels
                .nth(i)
                .textContent()
                .catch(() => "")) || "";
            if (t.includes("单图")) {
              await radioLabels.nth(i).click();
              radioSelected = true;
              console.log("[toutiao] 已选择单图封面");
              await page.waitForTimeout(800);
              break;
            }
          }
          if (!radioSelected) {
            console.log("[toutiao] 未找到单图选项，直接尝试封面区");
          }

          // 3) 滚动封面添加区到视口中央（否则点击会被视口边缘截断）
          await page
            .evaluate(() => {
              const el = document.querySelector(".article-cover-add");
              if (el) el.scrollIntoView({ block: "center" });
            })
            .catch(() => {});
          await page.waitForTimeout(800);

          // 4) 点击封面添加区：滚动→命中检测→真实点击，布局抖动时重试
          let clicked = false;
          for (let i = 0; i < 3 && !clicked; i++) {
            await page
              .evaluate(() => {
                const el = document.querySelector(".article-cover-add");
                if (el) el.scrollIntoView({ block: "center" });
              })
              .catch(() => {});
            await page.waitForTimeout(600);
            const box = await page
              .locator(".article-cover-add")
              .boundingBox()
              .catch(() => null);
            if (!box) break;
            const hit = await page
              .evaluate(
                ({ x, y }) => {
                  const el = document.elementFromPoint(x, y);
                  const add = document.querySelector(".article-cover-add");
                  return !!el && !!add && (el === add || add.contains(el));
                },
                { x: box.x + box.width / 2, y: box.y + box.height / 2 },
              )
              .catch(() => false);
            if (hit) {
              await page.mouse.click(
                box.x + box.width / 2,
                box.y + box.height / 2,
              );
              clicked = true;
              console.log("[toutiao] 已点击封面添加区（命中验证通过）");
            } else {
              console.log(
                `[toutiao] 封面区被遮挡（第 ${i + 1} 次），重新定位...`,
              );
              await page
                .evaluate(() => {
                  document
                    .querySelectorAll(
                      '.byte-drawer-mask, [class*="ai-assistant"], [class*="byte-drawer"]',
                    )
                    .forEach((el) => el.remove());
                })
                .catch(() => {});
            }
          }
          await page.waitForTimeout(5000);

          // 5) 等上传弹层出现后设置文件（弹层加载慢时重试点击封面区）
          let fileSet = false;
          for (let attempt = 0; attempt < 3 && !fileSet; attempt++) {
            await page
              .locator('input[type="file"]')
              .first()
              .waitFor({ state: "attached", timeout: 8000 })
              .catch(() => {});
            const inputCount = await page
              .locator('input[type="file"]')
              .count()
              .catch(() => 0);
            console.log(`[toutiao] 上传弹层 file input 数: ${inputCount}`);
            if (inputCount > 0) {
              await page
                .locator('input[type="file"]')
                .first()
                .setInputFiles(absolutePath);
              fileSet = true;
              console.log("[toutiao] 已设置封面文件");
            } else if (attempt < 2) {
              console.log(
                `[toutiao] 弹层未出现（第 ${attempt + 1} 次），重试点击封面区...`,
              );
              const ca = page.locator(".article-cover-add");
              if (await ca.isVisible({ timeout: 2000 }).catch(() => false)) {
                const cbox = await ca.boundingBox();
                if (cbox) {
                  await page.mouse.click(
                    cbox.x + cbox.width / 2,
                    cbox.y + cbox.height / 2,
                  );
                }
              }
            }
          }

          if (fileSet) {
            // 等待封面上传
            console.log("[toutiao] 等待封面上传...");
            await page.waitForTimeout(5000);

            // 检测封面是否上传成功
            const coverFound = await page.evaluate(() => {
              const imgs = document.querySelectorAll("img");
              for (const img of imgs) {
                const htmlImg = img as HTMLImageElement;
                if (htmlImg.src && htmlImg.naturalWidth > 0) {
                  const parent = htmlImg.closest(
                    '[class*="cover"], [class*="preview"]',
                  );
                  if (parent) return true;
                }
              }
              return false;
            });

            if (coverFound) {
              console.log("[toutiao] 封面上传成功");
            } else {
              console.log("[toutiao] 未检测到明确的上传成功标志");
            }
          } else {
            console.log("[toutiao] 未能设置封面文件");
          }

          // 点击"确定"按钮（若存在）
          const confirmBtn = page
            .locator('button:has-text("确定")')
            .filter({ visible: true });
          try {
            if (
              await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)
            ) {
              const disabled = await confirmBtn
                .first()
                .isDisabled()
                .catch(() => true);
              if (!disabled) {
                await confirmBtn.first().click();
                console.log("[toutiao] 点击确定按钮，封面上传完成");
              }
            }
          } catch (e) {
            console.log("[toutiao] 确定按钮点击失败:", (e as Error).message);
          }

          // 等待封面上传保存（头条号会自动保存）
          await page.waitForTimeout(5000);
        }
      }

      // 注意：不要在这里关闭「预览」弹窗。
      // 2026-10-22 实测：点掉预览弹窗会触发一次异常重存，服务端返回 7050「保存失败」；
      // 保持弹窗打开，等保存回执即可（弹窗关闭由浏览器生命周期处理）。
      await page.waitForTimeout(2000);

      // 点击「预览并发布」触发保存，随后关闭预览面板（面板内才会真正落库）
      console.log("[toutiao] 查找发布按钮...");
      try {
        // 尝试多种发布按钮选择器
        const publishSelectors = [
          'button:has-text("预览并发布")',
          'button:has-text("发布")',
        ];
        for (const selector of publishSelectors) {
          const btn = page.locator(selector);
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click({ force: true });
            console.log("[toutiao] 点击了:", selector);
            break;
          }
        }
        await page.waitForTimeout(3000);
      } catch (e) {
        console.log("[toutiao] 发布按钮点击失败:", (e as Error).message);
      }

      // 等保存真正完成再关浏览器（保存未完成就关 ⇒ 稿子丢失）
      const saved = await this.waitForDraftSaved(page, saveResponses);

      const finalUrl = page.url();
      const idMatch = finalUrl.match(/[?&]id=(\d+)/);

      if (idMatch) {
        console.log("[toutiao] 保存成功，文章 ID:", idMatch[1]);
        return {
          platform: this.meta.id,
          success: true,
          postId: idMatch[1],
          postUrl: `https://mp.toutiao.com/profile_v4/graphic/edit?id=${idMatch[1]}`,
          draftOnly: true,
          timestamp: Date.now() - start,
        };
      }

      if (!saved.ok) {
        const state = await page
          .evaluate(() => {
            const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
            const el = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
            const wc = document.body.innerText.match(/共\s*(\d+)\s*字/);
            return `标题="${ta?.value?.slice(0, 30) ?? ""}" 字数=${wc?.[1] ?? "?"} 正文首段="${(el?.innerText || "").slice(0, 40)}"`;
          })
          .catch(() => "（状态读取失败）");
        return {
          platform: this.meta.id,
          success: false,
          error: `草稿保存未确认（${saved.evidence}）；编辑器状态：${state}。浏览器已关闭，请到草稿箱核对`,
          timestamp: Date.now() - start,
        };
      }

      console.log("[toutiao] 草稿已保存:", saved.evidence);

      // --publish-now：草稿已落库（可回退）后再真发表
      if (processedArticle.publishNow) {
        const published = await this.publishDraftNow(page, processedArticle.title);
        if (!published.ok) {
          return {
            platform: this.meta.id,
            success: false,
            error: `草稿已保存，但发表未确认（${published.detail}）。草稿仍在草稿箱，可人工点发表`,
            timestamp: Date.now() - start,
          };
        }
        console.log("[toutiao] 已发表:", published.detail);
        return {
          platform: this.meta.id,
          success: true,
          postUrl: published.detail,
          draftOnly: false,
          timestamp: Date.now() - start,
        };
      }

      return {
        platform: this.meta.id,
        success: true,
        postUrl: finalUrl,
        draftOnly: true,
        timestamp: Date.now() - start,
      };
    } catch (err) {
      console.error("[toutiao] 错误:", err);
      return {
        platform: this.meta.id,
        success: false,
        error: (err as Error).message,
        timestamp: Date.now() - start,
      };
    } finally {
      await browser.close();
    }
  }


  /**
   * 发表已有草稿（按标题定位）：不重新渲染、不重复入库。
   *
   * 流程：草稿列表接口取 gid → 打开该草稿的编辑器 → 点「确认发布」
   *      → 回查草稿列表确认这篇消失了（发表后草稿会从箱里移除）。
   */
  async publishDraftByTitle(title: string): Promise<SyncResult> {
    const start = Date.now();
    if (!this.cookieData) {
      return {
        platform: this.meta.id,
        success: false,
        error: "未配置头条号 Cookie",
        timestamp: Date.now() - start,
      };
    }
    const browser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"],
    });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addCookies(
        Object.entries(this.cookieData).map(([name, value]) => ({
          name,
          value,
          domain: ".toutiao.com",
          path: "/",
        })),
      );
      const page = await context.newPage();
      await page.goto("https://mp.toutiao.com/profile_v4/manage/draft?enter_from=left_menu", {
        waitUntil: "networkidle",
        timeout: 90000,
      });
      await page.waitForTimeout(5000);

      const gid = await page.evaluate(async (t) => {
        const res = await fetch(
          "/mp/agw/creator_center/draft_list?type=0&count=50&app_id=1231",
          { credentials: "include" },
        );
        const body = (await res.json()) as { code?: number };
        if (body.code !== 0) return null;
        const items: { title: string; gid: string }[] = [];
        const walk = (node: unknown): void => {
          if (!node || typeof node !== "object") return;
          if (Array.isArray(node)) {
            node.forEach(walk);
            return;
          }
          const obj = node as Record<string, unknown>;
          if (typeof obj.title === "string" && obj.gid) {
            items.push({ title: obj.title, gid: String(obj.gid) });
          }
          Object.values(obj).forEach(walk);
        };
        walk(body);
        const hit = items.find((i) => i.title === t) || items.find((i) => i.title.includes(t.slice(0, 10)));
        return hit?.gid ?? null;
      }, title);
      if (!gid) {
        return {
          platform: this.meta.id,
          success: false,
          error: `草稿箱里找不到《${title}》（先跑 mpub list drafts -p toutiao 看现有草稿）`,
          timestamp: Date.now() - start,
        };
      }
      console.log("[toutiao] 找到草稿 gid:", gid);

      await page.goto(`https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=${gid}`, {
        waitUntil: "networkidle",
        timeout: 90000,
      });
      // 等编辑器真的把草稿内容加载出来（标题框出现且有值），再找发表按钮
      await page
        .waitForFunction(
          () => {
            const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
            return !!ta && ta.value.trim().length > 0;
          },
          { timeout: 45000 },
        )
        .catch(() => undefined);
      await page.waitForTimeout(2000);

      // 草稿编辑器的按钮是「预览并发布」；真正的「确认发布」在预览面板里
      const direct = page.locator("button:visible").filter({ hasText: /^(确认发布|立即发布)$/ }).last();
      let publishClicked = false;
      if (await direct.isVisible({ timeout: 4000 }).catch(() => false)) {
        console.log("[toutiao] 点击:", (await direct.textContent())?.trim());
        await direct.click({ force: true });
        publishClicked = true;
      } else {
        const previewBtn = page.locator("button:visible").filter({ hasText: /^预览并发布$/ }).last();
        if (!(await previewBtn.isVisible({ timeout: 6000 }).catch(() => false))) {
          const buttons = await page
            .evaluate(() =>
              [...document.querySelectorAll("button")]
                .filter((b) => (b as HTMLElement).offsetParent !== null)
                .map((b) => (b.textContent || "").trim())
                .filter(Boolean),
            )
            .catch(() => [] as string[]);
          return {
            platform: this.meta.id,
            success: false,
            error: `编辑器里没找到发表入口（可见按钮=${buttons.join("/") || "无"}）`,
            timestamp: Date.now() - start,
          };
        }
        console.log("[toutiao] 点击: 预览并发布（打开预览面板）");
        await previewBtn.click({ force: true });
        await page.waitForTimeout(5000);
        const confirmBtn = page
          .locator("button:visible")
          .filter({ hasText: /^(确认发布|立即发布|发布)$/ })
          .last();
        if (await confirmBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
          console.log("[toutiao] 点击:", (await confirmBtn.textContent())?.trim());
          await confirmBtn.click({ force: true });
          publishClicked = true;
        }
      }
      if (!publishClicked) {
        return {
          platform: this.meta.id,
          success: false,
          error: "预览面板里没找到『确认发布』按钮",
          timestamp: Date.now() - start,
        };
      }
      await page.waitForTimeout(4000);
      const confirm = page.locator("button:visible").filter({ hasText: /^(确定|确认)$/ }).last();
      if (await confirm.isVisible({ timeout: 2500 }).catch(() => false)) {
        await confirm.click({ force: true });
      }

      // 回查：草稿箱里这篇应该消失了
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(3000);
        const state = await page
          .evaluate(async (t) => {
            try {
              const res = await fetch(
                "/mp/agw/creator_center/draft_list?type=0&count=50&app_id=1231",
                { credentials: "include" },
              );
              const body = (await res.json()) as { code?: number };
              if (body.code !== 0) return "unknown";
              return JSON.stringify(body).includes(t.slice(0, 10)) ? "yes" : "no";
            } catch {
              return "unknown";
            }
          }, title)
          .catch(() => "unknown");
        if (state === "no") {
          return {
            platform: this.meta.id,
            success: true,
            postId: gid,
            postUrl: `https://www.toutiao.com/item/${gid}/`,
            draftOnly: false,
            timestamp: Date.now() - start,
          };
        }
      }
      return {
        platform: this.meta.id,
        success: false,
        error: "点了发表但草稿仍在箱里，未确认（可人工到后台核对）",
        timestamp: Date.now() - start,
      };
    } catch (err) {
      return {
        platform: this.meta.id,
        success: false,
        error: (err as Error).message,
        timestamp: Date.now() - start,
      };
    } finally {
      await browser.close();
    }
  }

  /**
   * 把 HTML 富文本填进头条编辑器。
   *
   * 头条编辑器（ProseMirror 系）只认自己的 paste 解析：
   *  - innerHTML + 伪造 InputEvent ⇒ 进了 DOM 视图但没进数据模型
   *    ⇒ 服务端返回 code 7050「保存失败」（2026-10-22 实测）
   *  - 剪贴板只有 text/plain ⇒ 会把 HTML 源码当纯文本贴进去（能存，但排版全丢）
   *
   * 因此按四档递进，并用「编辑器可见文本里有没有残留标签」做校验：
   *  1. 剪贴板写 text/html + text/plain，再 Ctrl+V（最像真人粘贴）
   *  2. 合成 paste 事件带 text/html
   *  3. document.execCommand('insertHTML')
   *  4. 兜底：只贴纯文本（至少不显示源码）
   */
  private async fillRichText(page: Page, html: string): Promise<string> {
    const editor = page.locator('div[contenteditable="true"]').first();
    const looksRaw = async (): Promise<boolean> =>
      page
        .evaluate(() => {
          const el = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
          const text = el?.innerText || "";
          return /<(p|li|section|strong|em)\s|<br/i.test(text);
        })
        .catch(() => false);

    const prepare = async (): Promise<void> => {
      await editor.click({ force: true });
      await page.keyboard.press("Control+a");
      await page.waitForTimeout(200);
    };

    // 1) 剪贴板 text/html + Ctrl+V
    try {
      await prepare();
      await page.evaluate(async (h) => {
        const plain = h
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const item = new ClipboardItem({
          "text/html": new Blob([h], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      }, html);
      await page.keyboard.press("Control+V");
      await page.waitForTimeout(1500);
      if (!(await looksRaw())) return "剪贴板 text/html 粘贴";
    } catch {
      /* 落到下一档 */
    }

    // 2) 合成 paste 事件
    try {
      await prepare();
      await page.evaluate((h) => {
        const el = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
        if (!el) return;
        el.focus();
        const dt = new DataTransfer();
        dt.setData("text/html", h);
        dt.setData(
          "text/plain",
          h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "),
        );
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, html);
      await page.waitForTimeout(1500);
      if (!(await looksRaw())) return "合成 paste 事件";
    } catch {
      /* 落到下一档 */
    }

    // 3) execCommand insertHTML
    try {
      await prepare();
      await page.evaluate((h) => {
        const el = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
        if (!el) return;
        el.focus();
        document.execCommand("insertHTML", false, h);
      }, html);
      await page.waitForTimeout(1500);
      if (!(await looksRaw())) return "execCommand insertHTML";
    } catch {
      /* 落到下一档 */
    }

    // 4) 兜底：纯文本（至少不会显示 HTML 源码）
    await prepare();
    await page.evaluate(async (h) => {
      const plain = h
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|li|section|h[1-6]|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      await navigator.clipboard.writeText(plain);
    }, html);
    await page.keyboard.press("Control+V");
    await page.waitForTimeout(1200);
    return "纯文本兜底（富文本未生效）";
  }


  /**
   * 把已保存的草稿真发表（--publish-now）。
   *
   * 判定依据（不是"我点了按钮"）：发表后这篇会从草稿箱消失
   * ⇒ 用草稿列表接口回查标题是否还在。
   */
  private async publishDraftNow(
    page: Page,
    title: string,
    timeoutMs = 60000,
  ): Promise<{ ok: boolean; detail: string }> {
    const btn = page
      .locator("button:visible")
      .filter({ hasText: /^(确认发布|立即发布|发布|确定发布)$/ })
      .last();
    if (await btn.isVisible({ timeout: 8000 }).catch(() => false)) {
      console.log("[toutiao] 点击发表按钮:", (await btn.textContent())?.trim());
      await btn.click({ force: true });
      await page.waitForTimeout(3000);
      // 可能还有二次确认
      const confirm = page
        .locator("button:visible")
        .filter({ hasText: /^(确定|确认|确认发布)$/ })
        .last();
      if (await confirm.isVisible({ timeout: 2500 }).catch(() => false)) {
        await confirm.click({ force: true });
      }
    } else {
      return { ok: false, detail: "页面上没找到『确认发布』按钮" };
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      const stillDraft = await page
        .evaluate(async (t) => {
          try {
            const res = await fetch(
              "/mp/agw/creator_center/draft_list?type=0&count=50&app_id=1231",
              { credentials: "include" },
            );
            const body = (await res.json()) as { code?: number };
            if (body.code !== 0) return "unknown";
            return JSON.stringify(body).includes(t.slice(0, 10)) ? "yes" : "no";
          } catch {
            return "unknown";
          }
        }, title)
        .catch(() => "unknown");
      if (stillDraft === "no") {
        return { ok: true, detail: `已发表（草稿箱里已无此篇）https://mp.toutiao.com/profile_v4/manage/content/all` };
      }
    }
    return { ok: false, detail: "点完发表后草稿仍在草稿箱，未确认发表" };
  }

  /**
   * 等待头条草稿真正保存完成。
   *
   * 判定依据（任一成立即算已保存）：
   *  1. 写接口返回 2xx（服务端已落库）
   *  2. 编辑器保存状态从「保存中」变为「已保存 / 保存成功 / 保存于 xx:xx」
   *
   * 超时未确认 ⇒ 返回 ok:false，调用方必须报错，不允许假成功。
   * 背景：2026-10-22 实测，编辑器显示「草稿保存中…」时关浏览器，草稿箱里什么都没有。
   */
  private async waitForDraftSaved(
    page: Page,
    saveResponses: { url: string; status: number; body: string }[],
    timeoutMs = 90000,
  ): Promise<{ ok: boolean; evidence: string }> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "";
    let logged = 0;
    while (Date.now() < deadline) {
      const status = await page
        .evaluate(() => {
          const text = document.body.innerText || "";
          const m = text.match(
            /保存中|保存成功|已保存|保存于[^\n，。]{0,12}/,
          );
          return m ? m[0].trim() : "";
        })
        .catch(() => "");
      if (status && status !== lastStatus) {
        lastStatus = status;
        console.log("[toutiao] 保存状态:", status);
      }
      // 打印新到的写接口回执（头条常在 HTTP 200 里塞失败码）
      while (logged < saveResponses.length) {
        const r = saveResponses[logged++];
        if (/article\/publish|draft/i.test(r.url)) {
          console.log(`[toutiao] 回执 ${r.status} ${r.url.split("?")[0]} ${r.body}`);
        }
      }

      // 只有「文章保存/发布」这个接口 code=0 才算保存成功
      const apiOk = saveResponses.filter(
        (r) =>
          r.status >= 200 &&
          r.status < 300 &&
          /article\/publish|article\/save|draft/i.test(r.url) &&
          /"code"\s*:\s*0|"success"\s*:\s*true/.test(r.body),
      );
      const textSaved =
        /保存成功|已保存|保存于/.test(status) && !/保存中/.test(status);
      if (textSaved || apiOk.length > 0) {
        return {
          ok: true,
          evidence: textSaved
            ? status
            : `写接口 ${apiOk.length} 个返回成功（${apiOk[0].url.slice(0, 80)}）`,
        };
      }
      await page.waitForTimeout(1000);
    }
    return { ok: false, evidence: lastStatus || "无保存状态信号" };
  }
}

import type { IPlatformAdapter } from "./interface.js";
