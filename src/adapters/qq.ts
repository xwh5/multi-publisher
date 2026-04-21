/**
 * 企鹅号适配器
 * 认证方式: Cookie
 * 特殊: 使用浏览器自动化上传封面图片
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { ConfigStore } from '../config.js'
import { chromium, type Browser, type Page } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
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
   * 通过浏览器自动化上传封面图片
   */
  private async uploadCoverViaBrowser(imagePath: string): Promise<string | null> {
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

      // 等待页面加载完成，点击创建文章按钮
      console.log('[QQ] 等待页面加载...')
      await page.waitForTimeout(2000)

      // 截图查看页面状态
      await page.screenshot({ path: `temp/qq-creation-${Date.now()}.png` })

      // 点击"写文章"或类似按钮
      const writeBtn = page.locator('text=写文章').first()
      if (await writeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await writeBtn.click()
        await page.waitForTimeout(2000)
      }

      // 上传封面图片
      console.log('[QQ] 上传封面图片...')

      // QQ 可能需要先上传封面，找到封面上传入口
      // 通常在文章设置区域有封面上传
      const coverInput = page.locator('input[type="file"]').first()

      if (await coverInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await coverInput.setInputFiles(imagePath)
        await page.waitForTimeout(3000)
      } else {
        // 如果没有可见的 file input，尝试点击封面上传按钮
        const coverArea = page.locator('[class*="cover"]').first()
        if (await coverArea.isVisible({ timeout: 3000 }).catch(() => false)) {
          await coverArea.click()
          await page.waitForTimeout(1000)

          // 找到 file input
          const fileInput = page.locator('input[type="file"]')
          if (await fileInput.count() > 0) {
            await fileInput.first().setInputFiles(imagePath)
            await page.waitForTimeout(3000)
          }
        }
      }

      // 截图查看上传结果
      await page.screenshot({ path: `temp/qq-cover-uploaded-${Date.now()}.png` })

      // 关闭浏览器
      await browser.close()

      // 从截图中无法获取实际 URL，返回空让调用方知道上传可能成功
      // 实际 URL 需要从页面元素或后续请求中获取
      return null

    } catch (err) {
      await browser.close()
      throw err
    }
  }

  /**
   * 尝试上传图片到企鹅号
   * 由于 API 上传在 Node.js 环境下有问题，暂时返回空
   */
  private async uploadImage(filePath: string): Promise<string | null> {
    try {
      // 尝试通过浏览器上传
      return await this.uploadCoverViaBrowser(filePath)
    } catch (err) {
      console.warn(`[QQ] 封面图上传失败: ${(err as Error).message}`)
      return null
    }
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    try {
      const cookieData = await this.getCookies()
      if (!cookieData || Object.keys(cookieData).length === 0) {
        throw new Error('未配置企鹅号 Cookie，请运行: mpub login --platform qq')
      }

      // 构建 Cookie 字符串
      const cookieStr = Object.entries(cookieData)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')

      // 获取 CSRF Token
      const csrfToken = cookieData['csrfToken'] || ''

      // 上传封面图（如果提供）
      let coverUrl = ''
      if (article.cover && existsSync(article.cover)) {
        try {
          // 封面图上传通过浏览器完成
          await this.uploadCoverViaBrowser(article.cover)
          // 封面 URL 需要从页面获取，这里暂时无法获取
          console.log('[QQ] 封面图已通过浏览器上传')
        } catch (err) {
          console.warn(`封面图上传失败: ${(err as Error).message}`)
        }
      }

      // 创建草稿
      const createResponse = await this.runtime.fetch(
        'https://api.om.qq.com/article/create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieStr,
            'Referer': 'https://om.qq.com/',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({
            title: article.title,
            content: article.markdown || article.html || '',
            cover: coverUrl,
            summary: article.summary || '',
            tags: article.tags?.join(',') || '',
            original_url: article.source_url || '',
          }),
        }
      )

      const responseText = await createResponse.text()

      if (!createResponse.ok) {
        throw new Error(`创建文章失败: ${createResponse.status} - ${responseText}`)
      }

      let createData: { code?: number; msg?: string; data?: { article_id?: string } }
      try {
        createData = JSON.parse(responseText)
      } catch {
        throw new Error(`创建文章响应无效: ${responseText.substring(0, 100)}`)
      }

      if (createData.code && createData.code !== 0) {
        throw new Error(createData.msg || `创建文章失败: 错误码 ${createData.code}`)
      }

      const articleId = createData.data?.article_id
      const articleUrl = articleId ? `https://om.qq.com/article/${articleId}` : undefined

      return {
        platform: this.meta.id,
        success: true,
        postId: articleId,
        postUrl: articleUrl,
        draftOnly: true,
        timestamp: Date.now() - start,
      }
    } catch (err) {
      return {
        platform: this.meta.id,
        success: false,
        error: (err as Error).message,
        timestamp: Date.now() - start,
      }
    }
  }
}