/**
 * 头条号 (Toutiao) 适配器
 * 使用 Playwright 直接操作页面发布
 */
import { chromium } from "playwright";
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
    page: import('playwright').Page,
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
      const abs = path.isAbsolute(src) ? src : path.resolve(baseDir || ".", src);
      if (!existsSync(abs)) {
        console.warn(`[toutiao] 正文图片不存在，跳过: ${abs}`);
        continue;
      }
      try {
        await input.setInputFiles(abs);
        const url = await page
          .evaluate(async () => {
            const el = document.getElementById("__mpub_upload") as HTMLInputElement;
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
        console.warn(`[toutiao] 正文图片处理异常 ${src}: ${(err as Error).message}`);
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
        viewport: { width: 1280, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();

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

      // 填写标题
      const titleTextarea = page.locator("textarea").first();
      await titleTextarea.fill(processedArticle.title);
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
        // 富文本编辑器内容注入：HTML 由 mpub 渲染自用户自己的 Markdown（可信），
        // 必须用 innerHTML 才能保留排版；不能用 textContent（会丢失全部格式）
        await page.evaluate((el) => {
          const div = document.querySelector(
            '[contenteditable="true"]',
          ) as HTMLDivElement;
          if (div) {
            // eslint-disable-next-line no-unsafe-innerhtml -- 见上方注释：内容可信、功能必需
            Reflect.set(div, "innerHTML", el);
            div.dispatchEvent(new InputEvent("input", { bubbles: true }));
          }
        }, finalHtml);
        console.log("[toutiao] 已填写内容");
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

      // 关闭预览弹窗（如果还在的话）
      try {
        const continueBtn = page.locator('button:has-text("继续编辑")');
        if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await continueBtn.click({ force: true });
          await page.waitForTimeout(2000);
        } else {
          const closeIcon = page.locator(
            '[class*="close"], .ai-assistant-drawer-wrapper [class*="close"]',
          );
          if (await closeIcon.isVisible({ timeout: 1000 }).catch(() => false)) {
            await closeIcon.click({ force: true });
            await page.waitForTimeout(1000);
          }
        }
      } catch (e) {
        // 关闭弹窗失败，继续
      }

      // 等待编辑器稳定
      await page.waitForTimeout(2000);

      // 点击发布按钮
      console.log("[toutiao] 查找发布按钮...");
      try {
        // 尝试多种发布按钮选择器
        const publishSelectors = [
          'button:has-text("发布")',
          'button:has-text("预览并发布")',
        ];
        for (const selector of publishSelectors) {
          const btn = page.locator(selector);
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click({ force: true });
            console.log("[toutiao] 点击了:", selector);
            break;
          }
        }
        await page.waitForTimeout(10000);
      } catch (e) {
        console.log("[toutiao] 发布按钮点击失败:", (e as Error).message);
      }

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

      console.log("[toutiao] 草稿已保存");
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
}

import type { IPlatformAdapter } from "./interface.js";
