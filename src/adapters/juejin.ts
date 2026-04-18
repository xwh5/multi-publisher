/**
 * 掘金适配器
 * 认证方式: Cookie
 * 特殊: 需要 CSRF token 和 ImageX AWS4 图片上传
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { ConfigStore } from '../config.js'
import crypto from 'node:crypto'

interface JuejinCookie {
  cookies?: Record<string, string>
}

// ImageX 服务常量
const IMAGEX_AID = '2608'
const IMAGEX_SERVICE_ID = '73owjymdk6'

function generateUUID(): string {
  return 'xxxxxxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  ) + Date.now().toString()
}

export class JuejinAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'juejin',
    name: '掘金',
    icon: 'https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png',
    homepage: 'https://juejin.cn',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private runtime!: RuntimeInterface
  private cookieData: JuejinCookie | null = null
  private cachedCsrfToken: string | null = null

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime
    this.cookieData = await this.loadCookie()
  }

  private async loadCookie(): Promise<JuejinCookie | null> {
    const cookies = await ConfigStore.getJuejinCookies()
    if (!cookies) return null
    return { cookies }
  }

  private buildCookieString(cookieData: JuejinCookie): string {
    if (!cookieData.cookies) return ''
    return Object.entries(cookieData.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  private getCommonHeaders(cookieStr: string): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': cookieStr,
      'Origin': 'https://juejin.cn',
      'Referer': 'https://juejin.cn/',
    }
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData?.cookies) {
      return { isAuthenticated: false, error: '未配置掘金 Cookie，请运行: mpub cookie --platform juejin --set' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const res = await this.runtime.fetch('https://api.juejin.cn/user_api/v1/user/get', {
        headers: this.getCommonHeaders(cookieStr),
      })

      const data = await res.json() as {
        data?: { user_id?: string; user_name?: string; avatar_large?: string }
      }

      if (data.data?.user_id) {
        return {
          isAuthenticated: true,
          userId: data.data.user_id,
          username: data.data.user_name,
          avatar: data.data.avatar_large,
        }
      }

      return { isAuthenticated: false, error: '未获取到用户信息' }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  /**
   * 获取 CSRF Token
   */
  private async getCsrfToken(): Promise<string> {
    if (this.cachedCsrfToken) {
      return this.cachedCsrfToken
    }

    if (!this.cookieData?.cookies) {
      throw new Error('未配置掘金 Cookie')
    }

    const cookieStr = this.buildCookieString(this.cookieData)

    const response = await this.runtime.fetch('https://api.juejin.cn/user_api/v1/sys/token', {
      method: 'HEAD',
      headers: {
        ...this.getCommonHeaders(cookieStr),
        'x-secsdk-csrf-request': '1',
        'x-secsdk-csrf-version': '1.2.10',
      },
    })

    const wareToken = response.headers.get('x-ware-csrf-token')
    if (!wareToken) {
      throw new Error('Failed to get CSRF token')
    }

    // Token 格式: "0,{actual_token},86370000,success,{session_id}"
    const parts = wareToken.split(',')
    if (parts.length < 2) {
      throw new Error('Invalid CSRF token format')
    }

    this.cachedCsrfToken = parts[1]
    return this.cachedCsrfToken
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    try {
      if (!this.cookieData?.cookies) {
        throw new Error('未配置掘金 Cookie，请运行: mpub cookie --platform juejin --set')
      }

      const cookieStr = this.buildCookieString(this.cookieData)
      const csrfToken = await this.getCsrfToken()

      // 使用 Markdown 格式
      let markdown = article.markdown || ''

      // 创建草稿
      const createResponse = await this.runtime.fetch(
        'https://api.juejin.cn/content_api/v1/article_draft/create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.getCommonHeaders(cookieStr),
            'x-secsdk-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            brief_content: '',
            category_id: '0',
            cover_image: '',
            edit_type: 10,
            html_content: 'deprecated',
            link_url: '',
            mark_content: markdown,
            tag_ids: [],
            title: article.title,
          }),
        }
      )

      const responseText = await createResponse.text()

      if (!createResponse.ok) {
        throw new Error(`创建草稿失败: ${createResponse.status} - ${responseText}`)
      }

      let createData: { data?: { id?: string }; err_msg?: string; err_no?: number }
      try {
        createData = JSON.parse(responseText)
      } catch {
        throw new Error(`创建草稿失败: 响应不是有效 JSON - ${responseText.substring(0, 100)}`)
      }

      if (createData.err_no && createData.err_no !== 0) {
        throw new Error(createData.err_msg || `创建草稿失败: 错误码 ${createData.err_no}`)
      }

      if (!createData.data?.id) {
        throw new Error(createData.err_msg || '创建草稿失败: 无效响应')
      }

      const draftId = createData.data.id
      const draftUrl = `https://juejin.cn/editor/drafts/${draftId}`

      return {
        platform: this.meta.id,
        success: true,
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: true,
        timestamp: Date.now() - start,
      }
    } catch (err) {
      return {
        platform: this.meta.id,
        success: false,
        error: (err as Error).message,
        timestamp: Date.now() - start,
      }
    }
  }
}
