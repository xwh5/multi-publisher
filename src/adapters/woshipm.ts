/**
 * 人人都是产品经理适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class WoshipmAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'woshipm',
    name: '人人都是产品经理',
    icon: 'https://www.woshipm.com/favicon.ico',
    homepage: 'https://www.woshipm.com/',
    capabilities: ['article', 'draft'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'woshipm'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置人人都是产品经理 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://www.woshipm.com/user/profile', {
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
      return this.createErrorResult('未配置 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      const res = await fetch('https://www.woshipm.com/article/save_draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
        body: JSON.stringify({
          title: article.title,
          content: article.markdown || '',
          draft: true,
        }),
      })

      const data = await res.json() as { code?: number; data?: { id?: string } }
      if (data.code === 0 && data.data?.id) {
        return this.createSuccessResult(data.data.id, `https://www.woshipm.com/article/edit?id=${data.data.id}`, true, start)
      }

      return this.createErrorResult('发布失败', start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
