/**
 * 51CTO 适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class Cto51Adapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'cto51',
    name: '51CTO',
    icon: 'https://blog.51cto.com/favicon.ico',
    homepage: 'https://blog.51cto.com/',
    capabilities: ['article', 'draft'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'cto51'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置 51CTO Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://blog.51cto.com/editor/draft', {
        headers: {
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
      })

      if (res.ok && !res.url.includes('login')) {
        return { isAuthenticated: true }
      }

      return { isAuthenticated: false, error: '未登录或登录已过期' }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  async publish(article: Article): Promise<import('./interface.js').SyncResult> {
    const start = Date.now()
    if (!this.cookieData) {
      return this.createErrorResult('未配置 51CTO Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      const res = await fetch('https://blog.51cto.com/blogger/save_draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
        body: JSON.stringify({
          title: article.title,
          content: article.markdown || '',
          draft: 1,
        }),
      })

      const data = await res.json() as { code?: number; id?: string }
      if (data.code === 0 && data.id) {
        return this.createSuccessResult(data.id, `https://blog.51cto.com/editor/edit?id=${data.id}`, true, start)
      }

      return this.createErrorResult('发布失败', start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
