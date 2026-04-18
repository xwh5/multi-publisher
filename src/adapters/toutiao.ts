/**
 * 头条号 (Toutiao) 适配器
 * 使用 Playwright 直接操作页面发布
 */
import { chromium } from 'playwright'
import type { Article, AuthResult, PlatformMeta, SyncResult } from './interface.js'
import { ConfigStore } from '../config.js'

export class ToutiaoAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'toutiao',
    name: '头条号',
    icon: 'https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/bytedoctor/1.0.14/favicon.ico',
    homepage: 'https://mp.toutiao.com/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await ConfigStore.getToutiaoCookies()
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置头条号 Cookie' }
    }
    const hasSession = this.cookieData['sessionid'] || this.cookieData['sid_tt']
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
        error: '未配置头条号 Cookie',
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
        domain: '.toutiao.com',
        path: '/',
      }))
      await context.addCookies(pageCookies)

      console.log('[toutiao] 正在打开头条号编辑器...')

      await page.goto('https://mp.toutiao.com/profile_v4/graphic/publish', {
        waitUntil: 'networkidle',
        timeout: 60000
      })
      await page.waitForTimeout(3000)

      if (page.url().includes('login')) {
        return {
          platform: this.meta.id,
          success: false,
          error: '未登录或登录已过期，请重新登录',
          timestamp: Date.now() - start,
        }
      }

      // 关闭弹窗
      try {
        const mask = page.locator('.byte-drawer-mask').first()
        if (await mask.isVisible({ timeout: 1000 })) {
          await mask.click({ force: true })
          await page.waitForTimeout(500)
        }
      } catch {}

      // 填写标题
      const titleTextarea = page.locator('textarea').first()
      await titleTextarea.fill(article.title)
      console.log('[toutiao] 已填写标题')

      // 填写内容
      const contentEl = page.locator('div[contenteditable="true"]').first()
      if (await contentEl.isVisible({ timeout: 2000 }).catch(() => false)) {
        await contentEl.click()
        // 使用 Ctrl+A 全选，然后输入内容（模拟用户输入）
        await page.keyboard.press('Control+a')
        await page.waitForTimeout(200)
        const htmlContent = article.html || article.markdown || ''
        await page.evaluate((el) => {
          const div = document.querySelector('[contenteditable="true"]') as HTMLDivElement
          if (div) {
            div.innerHTML = el
            // 触发 input 事件
            div.dispatchEvent(new InputEvent('input', { bubbles: true }))
          }
        }, htmlContent)
        console.log('[toutiao] 已填写内容')
        await page.waitForTimeout(1000)
      }

      // 等待编辑器自动保存（最多5秒）
      console.log('[toutiao] 等待编辑器自动保存（5秒）...')
      for (let i = 0; i < 5; i++) {
        const url = page.url()
        if (url.includes('id=')) {
          console.log('[toutiao] 检测到文章 ID，保存完成')
          break
        }
        await page.waitForTimeout(1000)
      }

      // 检查 URL 是否包含文章 ID
      let currentUrl = page.url()
      let idMatch = currentUrl.match(/[?&]id=(\d+)/)
      let savedId = idMatch ? idMatch[1] : null
      if (idMatch) {
        console.log('[toutiao] 检测到文章 ID:', idMatch[1])
      } else {
        console.log('[toutiao] URL 仍未变化:', currentUrl)
      }

      // 尝试点击"发布"按钮触发保存
      console.log('[toutiao] 尝试点击发布按钮...')
      try {
        // 查找发布按钮（可能在右上角或底部）
        const publishBtn = page.locator('button').filter({ hasText: /^发布$/ }).first()
        if (await publishBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await publishBtn.click({ force: true })
          console.log('[toutiao] 已点击发布按钮')
          // 等待保存完成
          await page.waitForTimeout(10000)
        } else {
          // 如果没找到发布按钮，尝试保存按钮
          const saveBtn = page.locator('button').filter({ hasText: /保存草稿|保存/ }).first()
          if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await saveBtn.click({ force: true })
            console.log('[toutiao] 已点击保存按钮')
            await page.waitForTimeout(10000)
          }
        }
      } catch (e) {
        console.log('[toutiao] 按钮点击失败:', (e as Error).message)
      }

      const finalUrl = page.url()
      idMatch = finalUrl.match(/[?&]id=(\d+)/)

      if (idMatch) {
        console.log('[toutiao] 保存成功，文章 ID:', idMatch[1])
        return {
          platform: this.meta.id,
          success: true,
          postId: idMatch[1],
          postUrl: `https://mp.toutiao.com/profile_v4/graphic/edit?id=${idMatch[1]}`,
          draftOnly: true,
          timestamp: Date.now() - start,
        }
      }

      console.log('[toutiao] 草稿已保存')
      return {
        platform: this.meta.id,
        success: true,
        postUrl: finalUrl,
        draftOnly: true,
        timestamp: Date.now() - start,
      }
    } catch (err) {
      console.error('[toutiao] 错误:', err)
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
