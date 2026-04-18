/**
 * 语雀 (Yuque) 适配器
 * 认证方式: Cookie (Note: 语雀主要使用 OAuth，此处为占位符)
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class YuqueAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'yuque',
    name: '语雀',
    icon: 'https://www.yuque.com/favicon.ico',
    homepage: 'https://www.yuque.com/',
    capabilities: ['article', 'draft'],
  }

  async init(): Promise<void> {}

  protected getCookieConfigKey(): string {
    return 'yuque'
  }

  async checkAuth(): Promise<AuthResult> {
    return { isAuthenticated: false, error: '语雀仅支持 OAuth 登录，请使用浏览器扩展登录' }
  }

  async publish(article: Article): Promise<import('./interface.js').SyncResult> {
    const start = Date.now()
    return this.createErrorResult('语雀需要 OAuth 认证，请使用 wechatsync 浏览器扩展', start)
  }
}
