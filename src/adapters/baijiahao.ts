/**
 * 百家号适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class BaijiahaoAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'baijiahao',
    name: '百家号',
    icon: 'https://baijiahao.baidu.com/favicon.ico',
    homepage: 'https://baijiahao.baidu.com/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'baijiahao'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置百家号 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://baijiahao.baidu.com/creator-center/stats', {
        headers: {
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
      })

      //百家号登录后会重定向到登录页
      if (res.url.includes('passport.baidu.com')) {
        return { isAuthenticated: false, error: '未登录或登录已过期' }
      }

      return { isAuthenticated: true }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  async publish(article: Article): Promise<import('./interface.js').SyncResult> {
    const start = Date.now()
    if (!this.cookieData) {
      return this.createErrorResult('未配置百家号 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      // 百家号内容发布 API
      const res = await fetch('https://baijiahao.baidu.com/creator-center/content/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
        body: JSON.stringify({
          title: article.title,
          content: article.html || article.markdown || '',
          draft: 1,
          cover_image: article.cover || '',
        }),
      })

      const data = await res.json() as { code?: number; msg?: string; data?: { content_id?: string } }
      if (data.code !== 0) {
        throw new Error(data.msg || '发布失败')
      }

      const postId = String(data.data?.content_id || '')
      const draftUrl = `https://baijiahao.baidu.com/creator-center/content/edit?content_id=${postId}`

      return this.createSuccessResult(postId, draftUrl, true, start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
