/**
 * B站 (Bilibili) 适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class BilibiliAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'bilibili',
    name: 'B站',
    icon: 'https://www.bilibili.com/favicon.ico',
    homepage: 'https://member.bilibili.com/articles/edit',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'bilibili'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置 B站 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
          'Cookie': cookieStr,
          'User-Agent': this.getCommonHeaders()['User-Agent'],
        },
      })

      const data = await res.json() as { code?: number; data?: { uname?: string; mid?: number } }
      if (data.code === 0 && data.data?.mid) {
        return {
          isAuthenticated: true,
          userId: String(data.data.mid),
          username: data.data.uname,
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
      return this.createErrorResult('未配置 B站 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      // B站创作中心 API - 获取 csrf token
      const csrfToken = this.cookieData.bili_jct || ''

      // 发布文章草稿
      const res = await fetch('https://member.bilibili.com/articles/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
        body: JSON.stringify({
          title: article.title,
          content: article.markdown || article.html || '',
          category_id: 0,
          tag_ids: [],
          list_id: 0,
          draft: 1, // 存草稿
          image_urls: [],
        }),
      })

      const data = await res.json() as { code?: number; message?: string; data?: { id?: number } }
      if (data.code !== 0) {
        throw new Error(data.message || '发布失败')
      }

      const postId = String(data.data?.id || 0)
      const draftUrl = `https://member.bilibili.com/articles/edit?id=${postId}`

      return this.createSuccessResult(postId, draftUrl, true, start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
