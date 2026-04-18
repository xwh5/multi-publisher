/**
 * 慕课网适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class ImoocAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'imooc',
    name: '慕课网',
    icon: 'https://www.imooc.com/favicon.ico',
    homepage: 'https://www.imooc.com/',
    capabilities: ['article', 'draft'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'imooc'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置慕课网 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://www.imooc.com/user/setinfo', {
        headers: {
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
      })

      const data = await res.json() as { result?: { username?: string; userid?: number } }
      if (data.result?.userid) {
        return {
          isAuthenticated: true,
          userId: String(data.result.userid),
          username: data.result.username,
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
      return this.createErrorResult('未配置慕课网 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      // 慕课网文章发布
      const res = await fetch('https://www.imooc.com/article/save_draft', {
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

      const data = await res.json() as { code?: number; data?: { id?: string } }
      if (data.code === 0 && data.data?.id) {
        return this.createSuccessResult(data.data.id, `https://www.imooc.com/article/edit?id=${data.data.id}`, true, start)
      }

      return this.createErrorResult('发布失败', start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
