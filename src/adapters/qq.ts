/**
 * 企鹅号适配器
 * 认证方式: Cookie
 * 发布方式: 浏览器自动化
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { ConfigStore } from '../config.js'
import { chromium, type Browser, type Page } from 'playwright'
import { existsSync } from 'node:fs'

export class QQAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'qq',
    name: '企鹅号',
    icon: 'https://inews.gtimg.com/news_lite/20210806/favicon.ico',
    homepage: 'https://om.qq.com/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private runtime!: RuntimeInterface

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime
  }

  private async getCookies(): Promise<Record<string, string> | null> {
    return await ConfigStore.getQQCookies()
  }

  async checkAuth(): Promise<AuthResult> {
    const cookieData = await this.getCookies()
    if (!cookieData || Object.keys(cookieData).length === 0) {
      return { isAuthenticated: false, error: '未配置企鹅号 Cookie，请运行: mpub login --platform qq' }
    }

    if (!cookieData['userid']) {
      return { isAuthenticated: false, error: 'Cookie 中缺少 userid，可能登录已失效' }
    }

    try {
      return {
        isAuthenticated: true,
        userId: cookieData['userid'],
        username: cookieData['pt2gguin'] ? `o${cookieData['pt2gguin']}` : undefined,
      }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  /**
   * 通过浏览器自动化上传封面图片，返回图片 URL
   */
  private async uploadCoverViaBrowser(page: Page, imagePath: string): Promise<string | null> {
    // 监听上传响应
    const [response] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('ArchacaleUploadViaFile'), { timeout: 30000 }),
      (async () => {
        // 上传文件
        const fileInput = page.locator('input[type="file"]').first()
        if (await fileInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await fileInput.setInputFiles(imagePath)
        } else {
          // 尝试点击封面上传区域
          const coverArea = page.locator('[class*="cover"], [class*="upload"]').first()
          if (await coverArea.isVisible({ timeout: 3000 }).catch(() => false)) {
            await coverArea.click()
            await page.waitForTimeout(500)
            const input = page.locator('input[type="file"]').first()
            if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
              await input.setInputFiles(imagePath)
            }
          }
        }
      })()
    ])

    try {
      const json = await response.json()
      if (json.code === 0 && json.data?.url) {
        const urlData = json.data.url as Record<string, { imageUrl?: string }>
        return urlData['640']?.imageUrl || urlData['0']?.imageUrl || Object.values(urlData)[0]?.imageUrl || null
      }
    } catch {}
    return null
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    const browser: Browser = await chromium.launch({
      headless: false,
      channel: 'chromium',
    })

    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      })
      const page: Page = await context.newPage()

      // 加载 cookies
      const cookies = await this.getCookies()
      if (!cookies || Object.keys(cookies).length === 0) {
        throw new Error('未配置企鹅号 Cookie')
      }

      const qqCookies = Object.entries(cookies).map(([name, value]) => ({
        name,
        value,
        domain: '.om.qq.com',
        path: '/',
      }))
      await context.addCookies(qqCookies)

      // 打开创作页面
      console.log('[QQ] 打开创作页面...')
      await page.goto('https://om.qq.com/main/creation/article', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      })
      await page.waitForTimeout(3000)

      // 截图查看状态
      await page.screenshot({ path: `temp/qq-publish-1-${Date.now()}.png` })

      // 点击"写文章"按钮
      const writeBtn = page.locator('text=写文章').first()
      if (await writeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await writeBtn.click()
        await page.waitForTimeout(2000)
      }

      // 截图
      await page.screenshot({ path: `temp/qq-publish-2-${Date.now()}.png` })

      // 填写标题
      console.log('[QQ] 填写标题...')
      const titleInput = page.locator('input[placeholder*="标题"], input[name*="title"]').first()
      if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await titleInput.fill(article.title)
      }

      // 填写内容 - 找到富文本编辑器
      console.log('[QQ] 填写内容...')
      const contentArea = page.locator('[contenteditable="true"], .editor, [role="textbox"]').first()
      if (await contentArea.isVisible({ timeout: 3000 }).catch(() => false)) {
        await contentArea.click()
        await contentArea.fill(article.markdown || article.html || '')
      }

      // 上传封面（如果有）
      if (article.cover && existsSync(article.cover)) {
        console.log('[QQ] 上传封面...')
        const coverUrl = await this.uploadCoverViaBrowser(page, article.cover)
        if (coverUrl) {
          console.log(`[QQ] 封面 URL: ${coverUrl}`)
        }
      }

      await page.waitForTimeout(2000)
      await page.screenshot({ path: `temp/qq-publish-3-${Date.now()}.png` })

      // 点击发布/保存按钮
      console.log('[QQ] 点击发布...')
      const publishBtn = page.locator('button:has-text("发布"), button:has-text("保存"), button:has-text("提交")').first()
      if (await publishBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await publishBtn.click()
        await page.waitForTimeout(3000)
      }

      await page.screenshot({ path: `temp/qq-publish-4-${Date.now()}.png` })

      // 关闭浏览器
      await browser.close()

      return {
        platform: this.meta.id,
        success: true,
        draftOnly: true,
        timestamp: Date.now() - start,
        postUrl: 'https://om.qq.com/main/creation/article',
      }

    } catch (err) {
      await browser.close()
      return {
        platform: this.meta.id,
        success: false,
        error: (err as Error).message,
        timestamp: Date.now() - start,
      }
    }
  }
}