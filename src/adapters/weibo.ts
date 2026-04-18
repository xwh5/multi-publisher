/**
 * 微博适配器
 * 认证方式: Cookie
 */
import { BaseAdapter } from './base-adapter.js'
import type { Article, AuthResult, PlatformMeta } from './interface.js'

export class WeiboAdapter extends BaseAdapter {
  readonly meta: PlatformMeta = {
    id: 'weibo',
    name: '微博',
    icon: 'https://weibo.com/favicon.ico',
    homepage: 'https://card.weibo.com/article/v5/editor',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await this.loadCookies()
  }

  protected getCookieConfigKey(): string {
    return 'weibo'
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置微博 Cookie' }
    }

    try {
      // 微博通过访问编辑器页面验证登录状态
      const response = await fetch('https://card.weibo.com/article/v5/editor', {
        credentials: 'include',
      })
      const html = await response.text()

      // 从页面中解析用户配置
      const configMatch = html.match(/config:\s*JSON\.parse\('(.+?)'\)/)
      if (!configMatch) {
        // 尝试另一种方式检测
        if (html.includes('"uid"') && html.includes('"nick"')) {
          return { isAuthenticated: true }
        }
        return { isAuthenticated: false, error: '无法解析用户信息' }
      }

      return { isAuthenticated: true }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  async publish(article: Article): Promise<import('./interface.js').SyncResult> {
    const start = Date.now()
    if (!this.cookieData) {
      return this.createErrorResult('未配置微博 Cookie', start)
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)

      // 1. 创建草稿
      const createRes = await fetch(
        `https://card.weibo.com/article/v5/aj/editor/draft/create?_r=${Date.now()}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieStr,
            ...this.getCommonHeaders(),
          },
          body: new URLSearchParams({}),
        }
      )

      const createData = await createRes.json() as { code?: number; msg?: string; data?: { id: string } }
      if (createData.code !== 100000 || !createData.data?.id) {
        throw new Error(createData.msg || '创建草稿失败')
      }

      const postId = createData.data.id

      // 2. 处理内容
      let content = article.html || article.markdown || ''

      // 3. 保存草稿
      const saveRes = await fetch(
        `https://card.weibo.com/article/v5/aj/editor/draft/save?id=${postId}&_r=${Date.now()}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieStr,
            ...this.getCommonHeaders(),
          },
          body: new URLSearchParams({
            id: postId,
            title: article.title,
            content,
            status: '0',
            save: '1',
          }),
        }
      )

      const saveData = await saveRes.json() as { code?: string }
      if (String(saveData.code) !== '100000') {
        throw new Error('保存草稿失败')
      }

      const draftUrl = `https://card.weibo.com/article/v5/editor#/draft/${postId}`
      return this.createSuccessResult(postId, draftUrl, true, start)
    } catch (err) {
      return this.createErrorResult((err as Error).message, start)
    }
  }
}
