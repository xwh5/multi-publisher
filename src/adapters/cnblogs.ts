/**
 * 博客园 (Cnblogs) 适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class CnblogsAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'cnblogs',
    name: '博客园',
    icon: 'https://www.cnblogs.com/favicon.ico',
    homepage: 'https://i.cnblogs.com/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'cnblogs'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置博客园 Cookie' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await fetch('https://home.cnblogs.com/user/CurrentUserInfo', {
        headers: {
          'Cookie': cookieStr,
          ...this.getCommonHeaders(),
        },
      })

      const text = await res.text()
      const avatarMatch = text.match(/<img[^>]+class="pfs"[^>]+src="([^"]+)"/)
      const linkMatch = text.match(/href="\/u\/([^/]+)\/"/)

      if (linkMatch) {
        return {
          isAuthenticated: true,
          userId: linkMatch[1],
          username: linkMatch[1],
          avatar: avatarMatch?.[1],
        }
      }

      return { isAuthenticated: false, error: '未获取到用户信息' }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  async publish(article: Article): Promise<import('./interface.js').SyncResult> {
    const start = Date.now()
    if (!this.cookieData) {
      return this.createErrorResult('未配置博客园 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      // 先获取 XSRF token
      await fetch('https://i.cnblogs.com/posts/edit', { credentials: 'include' })
      const xsrfToken = this.cookieData['.CNBlogsCookie']?.split(';')?.find(c => c.includes('XSRF-TOKEN')) || ''

      const res = await fetch('https://i.cnblogs.com/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-xsrf-token': xsrfToken,
          'Cookie': cookieStr,
        },
        body: JSON.stringify({
          id: null,
          postType: 2,
          title: article.title,
          postBody: article.markdown || '',
          isMarkdown: true,
          isDraft: true,
          isPublished: false,
        }),
      })

      const data = await res.json() as { id?: number; error?: string }
      if (!data.id) {
        throw new Error(data.error || '创建草稿失败')
      }

      const postId = String(data.id)
      const draftUrl = `https://i.cnblogs.com/articles/edit;postId=${postId}`

      return this.createSuccessResult(postId, draftUrl, true, start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
