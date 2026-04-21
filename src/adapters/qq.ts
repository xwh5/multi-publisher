/**
 * 企鹅号适配器
 * 认证方式: Cookie
 * 特殊: 使用浏览器自动化上传封面图片
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

      // 截图查看页面状态
      await page.screenshot({ path: `temp/qq-creation-${Date.now()}.png` })

      // 点击"写文章"或类似按钮
      const writeBtn = page.locator('text=写文章').first()
      if (await writeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await writeBtn.click()
        await page.waitForTimeout(2000)
      }

      console.log('[QQ] 上传封面图片...')

      // 使用 JavaScript 上传文件并获取返回的 URL
      const uploadResult = await page.evaluate(async (filePath) => {
        // 读取文件为 base64
        const response = await fetch(filePath)
        const blob = await response.blob()
        const arrayBuffer = await blob.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
        const mimeType = blob.type || 'image/jpeg'
        const filename = filePath.split(/[\\/]/).pop() || 'image.jpg'

        // 构建 multipart form data
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
        const footer = `\r\n--${boundary}--`
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }

        // 构造 multipart body
        const bodyArray = new Uint8Array(header.length + bytes.length + footer.length)
        let offset = 0
        for (let i = 0; i < header.length; i++) bodyArray[offset++] = header.charCodeAt(i)
        bodyArray.set(bytes, offset)
        offset += bytes.length
        for (let i = 0; i < footer.length; i++) bodyArray[offset++] = footer.charCodeAt(i)

        // 发送请求
        const uploadResponse = await fetch('https://image.om.qq.com/cpom_pimage/ArchacaleUploadViaFile', {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Referer': 'https://om.qq.com/',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: bodyArray,
        })

        const result = await uploadResponse.json()
        if (result.code === 0 && result.data?.url) {
          // 返回 640 尺寸的 URL
          const urlData = result.data.url as Record<string, { imageUrl?: string }>
          return urlData['640']?.imageUrl || urlData['0']?.imageUrl || Object.values(urlData)[0]?.imageUrl
        }
        return null
      }, `file://${imagePath.replace(/\\/g, '/')}`)

      await page.screenshot({ path: `temp/qq-cover-uploaded-${Date.now()}.png` })
      await browser.close()

      console.log(`[QQ] 上传结果: ${uploadResult}`)
      return uploadResult || null

    } catch (err) {
      await browser.close()
      throw err
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
          coverUrl = await this.uploadCoverViaBrowser(article.cover) || ''
          if (coverUrl) {
            console.log(`[QQ] 封面图上传成功: ${coverUrl}`)
          }
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