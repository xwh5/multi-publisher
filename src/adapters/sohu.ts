/**
 * 搜狐号适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class SohuAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'sohu',
    name: '搜狐号',
    icon: 'https://mp.sohu.com/favicon.ico',
    homepage: 'https://mp.sohu.com/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'sohu'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置搜狐 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://mp.sohu.com/article/list', {
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
      return this.createErrorResult('未配置搜狐 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      const res = await fetch('https://mp.sohu.com/api/article/save_draft', {
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
        }),
      })

      const data = await res.json() as { code?: number; data?: { id?: string } }
      if (data.code === 0 && data.data?.id) {
        return this.createSuccessResult(data.data.id, `https://mp.sohu.com/article/edit?id=${data.data.id}`, true, start)
      }

      return this.createErrorResult('发布失败', start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
