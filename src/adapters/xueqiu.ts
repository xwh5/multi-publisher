/**
 * 雪球 (Xueqiu) 适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class XueqiuAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'xueqiu',
    name: '雪球',
    icon: 'https://xueqiu.com/favicon.ico',
    homepage: 'https://xueqiu.com/',
    capabilities: ['article', 'draft'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'xueqiu'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置雪球 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://xueqiu.com/settings/user', {
        headers: {
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
      })

      const text = await res.text()
      if (res.ok && (text.includes('个人资料') || text.includes('username'))) {
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
      return this.createErrorResult('未配置雪球 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      // 雪球文章发布 API
      const res = await fetch('https://xueqiu.com/articles/save_draft', {
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
        return this.createSuccessResult(data.id, `https://xueqiu.com/articles/edit?id=${data.id}`, true, start)
      }

      return this.createErrorResult('发布失败', start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
