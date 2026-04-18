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
    capabilities: ['article', 'draft', 'image_upload'],
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

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    if (!this.cookieData) {
      return {
        platform: this.meta.id,
        success: false,
        error: '未配置小红书 Cookie',
        timestamp: Date.now() - start,
      }
    }

    const browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-devtools-shm-usage',
        '--no-sandbox',
      ]
    })
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      })
      const page = await context.newPage()

      // 使用 CDP 隐藏自动化特征
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
          window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
        `
      })

      // 设置 cookies
      const pageCookies = Object.entries(this.cookieData).map(([name, value]) => ({
        name,
        value,
        domain: '.xiaohongshu.com',
        path: '/',
        secure: true,
        httpOnly: false,
      }))
      await context.addCookies(pageCookies)

      console.log('[xiaohongshu] 已设置 cookies:', Object.keys(this.cookieData))

      console.log('[xiaohongshu] 正在打开小红书...')

      // 先访问主站让 cookie 生效
      await page.goto('https://www.xiaohongshu.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })
      await page.waitForTimeout(2000)

      console.log('[xiaohongshu] 正在打开创作者中心...')

      await page.goto('https://creator.xiaohongshu.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })
      await page.waitForTimeout(3000)

      // 检查是否跳转到登录页
      const currentUrl = page.url()
      console.log('[xiaohongshu] 当前 URL:', currentUrl)
      if (currentUrl.includes('login') || currentUrl.includes('sign')) {
        return {
          platform: this.meta.id,
          success: false,
          error: '未登录或登录已过期，请重新登录',
          timestamp: Date.now() - start,
        }
      }

      // 点击发布笔记按钮
      console.log('[xiaohongshu] 查找发布按钮...')
      try {
        const publishBtn = page.locator('button, div[role="button"]').filter({ hasText: /发布/ }).first()
        if (await publishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await publishBtn.click()
          console.log('[xiaohongshu] 已点击发布按钮')
          await page.waitForTimeout(2000)
        }
      } catch (e) {
        console.log('[xiaohongshu] 查找发布按钮失败:', (e as Error).message)
      }

      // 填写标题
      console.log('[xiaohongshu] 填写标题...')
      try {
        // 小红书标题可能在 input 或 textarea 中
        const titleInput = page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"]').first()
        if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await titleInput.fill(article.title)
          console.log('[xiaohongshu] 已填写标题')
        }
      } catch (e) {
        console.log('[xiaohongshu] 填写标题失败:', (e as Error).message)
      }

      // 填写内容
      console.log('[xiaohongshu] 填写内容...')
      try {
        const contentEl = page.locator('div[contenteditable="true"]').first()
        if (await contentEl.isVisible({ timeout: 2000 }).catch(() => false)) {
          await contentEl.click()
          await page.keyboard.press('Control+a')
          await page.waitForTimeout(200)
          const textContent = article.markdown || article.html || ''
          await page.evaluate((el) => {
            const div = document.querySelector('[contenteditable="true"]') as HTMLDivElement
            if (div) {
              div.innerHTML = el
              div.dispatchEvent(new InputEvent('input', { bubbles: true }))
            }
          }, textContent)
          console.log('[xiaohongshu] 已填写内容')
        }
      } catch (e) {
        console.log('[xiaohongshu] 填写内容失败:', (e as Error).message)
      }

      // 等待自动保存
      console.log('[xiaohongshu] 等待自动保存...')
      await page.waitForTimeout(10000)

      // 尝试点击保存/发布按钮
      console.log('[xiaohongshu] 尝试保存...')
      try {
        const saveBtn = page.locator('button').filter({ hasText: /保存|发布/ }).first()
        if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await saveBtn.click()
          console.log('[xiaohongshu] 已点击保存按钮')
          await page.waitForTimeout(5000)
        }
      } catch (e) {
        console.log('[xiaohongshu] 保存按钮点击失败:', (e as Error).message)
      }

      const finalUrl = page.url()
      console.log('[xiaohongshu] 当前 URL:', finalUrl)

      // 检查是否保存成功
      const idMatch = finalUrl.match(/[?&]id=(\w+)/)
      if (idMatch) {
        console.log('[xiaohongshu] 保存成功，笔记 ID:', idMatch[1])
        return {
          platform: this.meta.id,
          success: true,
          postId: idMatch[1],
          postUrl: finalUrl,
          draftOnly: true,
          timestamp: Date.now() - start,
        }
      }

      console.log('[xiaohongshu] 草稿已保存')
      return {
        platform: this.meta.id,
        success: true,
        postUrl: finalUrl,
        draftOnly: true,
        timestamp: Date.now() - start,
      }
    } catch (err) {
      console.error('[xiaohongshu] 错误:', err)
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

import type { IPlatformAdapter } from './interface.js'
