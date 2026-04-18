/**
 * 东方财富适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class EastmoneyAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'eastmoney',
    name: '东方财富',
    icon: 'https://www.eastmoney.com/favicon.ico',
    homepage: 'https://www.eastmoney.com/',
    capabilities: ['article', 'draft'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'eastmoney'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置东方财富 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      // 东方财富号
      const res = await fetch('https://nsfc.eastmoney.com/', {
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
    return this.createErrorResult('东方财富发布功能开发中', start)
  }
}
