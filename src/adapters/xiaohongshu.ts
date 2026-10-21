/**
 * 小红书 (Xiaohongshu) 适配器
 * 使用 Playwright 直接操作页面发布
 */
import { chromium } from 'playwright'
import type { Article, AuthResult, PlatformMeta, SyncResult } from './interface.js'
import { ConfigStore } from '../config.js'

export class XiaohongshuAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'xiaohongshu',
    name: '小红书',
    icon: 'https://www.xiaohongshu.com/favicon.ico',
    homepage: 'https://creator.xiaohongshu.com/',
    capabilities: ['image_post', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await ConfigStore.getXiaohongshuCookies()
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置小红书 Cookie' }
    }
    const hasSession = this.cookieData['web_session'] || this.cookieData['sessionid']
    if (!hasSession) {
      return { isAuthenticated: false, error: '未登录或登录已过期' }
    }
    return { isAuthenticated: true }
  }

  /**
   * 小红书不吃长文：只有图文包（--package）路径。
   * 保留这个方法只为给出明确报错，不做长文渲染。
   */
  async publish(article: Article): Promise<SyncResult> {
    return {
      platform: this.meta.id,
      success: false,
      error: '小红书只支持图文：先用 `mpub xhs-package` 出包，再 `mpub publish -p xiaohongshu --package <dir>`',
      timestamp: Date.now(),
    }
  }

  /** 图文帖发布：标题 + 图集 + 短正文 + 标签。默认只存草稿，publishNow 才真发布。 */
  async publishImagePost(post: ImagePost, options?: { publishNow?: boolean }): Promise<SyncResult> {
    const start = Date.now()
    if (!this.cookieData) {
      return {
        platform: this.meta.id,
        success: false,
        error: '未配置小红书 Cookie（mpub login -p xiaohongshu）',
        timestamp: Date.now() - start,
      }
    }
    if (post.images.length === 0) {
      return {
        platform: this.meta.id,
        success: false,
        error: '图文包没有图片（小红书至少 1 张图）',
        timestamp: Date.now() - start,
      }
    }
    if ([...post.title].length > 20) {
      return {
        platform: this.meta.id,
        success: false,
        error: `标题 ${[...post.title].length} 字 > 小红书上限 20`,
        timestamp: Date.now() - start,
      }
    }

    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'],
    })
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      })
      const page = await context.newPage()
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
          window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
        `,
      })
      const pageCookies = Object.entries(this.cookieData).map(([name, value]) => ({
        name,
        value,
        domain: '.xiaohongshu.com',
        path: '/',
        secure: true,
        httpOnly: false,
      }))
      await context.addCookies(pageCookies)

      await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      await page.waitForTimeout(3000)
      const currentUrl = page.url()
      if (currentUrl.includes('login') || currentUrl.includes('sign')) {
        return {
          platform: this.meta.id,
          success: false,
          error: '未登录或登录已过期，请重新登录',
          timestamp: Date.now() - start,
        }
      }

      // 上传图集
      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.setInputFiles(post.images)
      await page.waitForTimeout(5000)

      // 标题
      const titleInput = page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"]').first()
      if (await titleInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await titleInput.fill(post.title)
      }

      // 正文 + 话题标签
      const bodyText = post.tags.length > 0 ? `${post.body}\n\n${post.tags.map(t => `#${t}`).join(' ')}` : post.body
      const contentEl = page.locator('div[contenteditable="true"]').first()
      if (await contentEl.isVisible({ timeout: 3000 }).catch(() => false)) {
        await contentEl.click()
        await page.keyboard.press('Control+a')
        await page.waitForTimeout(200)
        await page.evaluate((text) => {
          const div = document.querySelector('[contenteditable="true"]') as HTMLDivElement
          if (div) {
            div.innerText = text
            div.dispatchEvent(new InputEvent('input', { bubbles: true }))
          }
        }, bodyText)
      }

      await page.waitForTimeout(8000)

      if (options?.publishNow) {
        const publishBtn = page.locator('button, div[role="button"]').filter({ hasText: /发布/}).first()
        if (await publishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await publishBtn.click()
          await page.waitForTimeout(5000)
        }
      } else {
        // 只保存草稿：等自动保存
        await page.waitForTimeout(5000)
      }

      const finalUrl = page.url()
      const idMatch = finalUrl.match(/[?&]id=(\w+)/)
      return {
        platform: this.meta.id,
        success: true,
        postId: idMatch?.[1],
        postUrl: finalUrl,
        draftOnly: !options?.publishNow,
        timestamp: Date.now() - start,
      }
    } catch (err) {
      return {
        platform: this.meta.id,
        success: false,
        error: (err as Error).message,
        timestamp: Date.now() - start,
      }
    } finally {
      await browser.close()
    }
  }

}

import type { IPlatformAdapter, ImagePost } from './interface.js'
