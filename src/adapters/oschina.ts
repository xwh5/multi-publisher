/**
 * 开源中国适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class OschinaAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'oschina',
    name: '开源中国',
    icon: 'https://www.oschina.net/favicon.ico',
    homepage: 'https://www.oschina.net/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'oschina'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置开源中国 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://www.oschina.net/home/user-info', {
        headers: {
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
      })

      const data = await res.json() as { user?: { id?: number; name?: string } }
      if (data.user?.id) {
        return {
          isAuthenticated: true,
          userId: String(data.user.id),
          username: data.user.name,
        }
      }

      return { isAuthenticated: false, error: '未登录或登录已过期' }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  async publish(article: Article): Promise<import('./interface.js').SyncResult> {
    const start = Date.now()
    if (!this.cookieData) {
      return this.createErrorResult('未配置开源中国 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      const res = await fetch('https://www.oschina.net/blog/save_draft', {
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

      const data = await res.json() as { code?: number; id?: string }
      if (data.code === 0 && data.id) {
        return this.createSuccessResult(data.id, `https://www.oschina.net/blog/edit?id=${data.id}`, true, start)
      }

      return this.createErrorResult('发布失败', start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
