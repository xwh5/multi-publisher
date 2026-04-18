/**
 * CSDN 适配器
 * 认证方式: Cookie + API 签名 (HMAC-SHA256)
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { ConfigStore } from '../config.js'
import crypto from 'node:crypto'

interface CSDNCookie {
  cookies?: Record<string, string>
}

// CSDN API 签名密钥
const API_KEY = '203803574'
const API_SECRET = '9znpamsyl2c7cdrr9sas0le9vbc3r6ba'

export class CSDNAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'csdn',
    name: 'CSDN',
    icon: 'https://g.csdnimg.cn/static/logo/favicon32.ico',
    homepage: 'https://editor.csdn.net/md/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private runtime!: RuntimeInterface
  private cookieData: CSDNCookie | null = null

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime
    this.cookieData = await this.loadCookie()
  }

  private async loadCookie(): Promise<CSDNCookie | null> {
    const cookies = await ConfigStore.getCSDNCookies()
    if (!cookies) return null
    return { cookies }
  }

  private buildCookieString(cookieData: CSDNCookie): string {
    if (!cookieData.cookies) return ''
    return Object.entries(cookieData.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  private getCommonHeaders(): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://editor.csdn.net',
      'Referer': 'https://editor.csdn.net/',
    }
  }

  /**
   * 生成 UUID
   */
  private createUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  /**
   * HMAC-SHA256 签名
   */
  private async hmacSha256(message: string, secret: string): Promise<string> {
    return crypto.createHmac('sha256', secret).update(message).digest('base64')
  }

  /**
   * 生成 CSDN API 签名
   */
  private async signRequest(apiPath: string, method: 'GET' | 'POST' = 'POST'): Promise<Record<string, string>> {
    const nonce = this.createUuid()

    const signStr = method === 'GET'
      ? `GET\n*/*\n\n\n\nx-ca-key:${API_KEY}\nx-ca-nonce:${nonce}\n${apiPath}`
      : `POST\n*/*\n\napplication/json\n\nx-ca-key:${API_KEY}\nx-ca-nonce:${nonce}\n${apiPath}`

    const signature = await this.hmacSha256(signStr, API_SECRET)

    const headers: Record<string, string> = {
      'accept': '*/*',
      'x-ca-key': API_KEY,
      'x-ca-nonce': nonce,
      'x-ca-signature': signature,
      'x-ca-signature-headers': 'x-ca-key,x-ca-nonce',
      ...this.getCommonHeaders(),
    }

    if (method === 'POST') {
      headers['content-type'] = 'application/json'
    }

    return headers
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData?.cookies) {
      return { isAuthenticated: false, error: '未配置 CSDN Cookie，请运行: mpub cookie --platform csdn --set' }
    }

    try {
      const cookieStr = this.buildCookieString(this.cookieData)
      const apiPath = '/blog-console-api/v3/editor/getBaseInfo'
      const headers = await this.signRequest(apiPath, 'GET')

      const response = await this.runtime.fetch(
        `https://bizapi.csdn.net${apiPath}`,
        {
          method: 'GET',
          headers: {
            ...headers,
            'Cookie': cookieStr,
          },
        }
      )

      const res = await response.json() as {
        code: number
        data?: { name: string; nickname: string; avatar: string; blog_url: string }
      }

      if (res.code === 200 && res.data?.name) {
        return {
          isAuthenticated: true,
          userId: res.data.name,
          username: res.data.nickname || res.data.name,
          avatar: res.data.avatar,
        }
      }

      return { isAuthenticated: false, error: 'CSDN 未授权' }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    try {
      if (!this.cookieData?.cookies) {
        throw new Error('未配置 CSDN Cookie，请运行: mpub cookie --platform csdn --set')
      }

      const cookieStr = this.buildCookieString(this.cookieData)

      // 使用 Markdown 格式
      let markdown = article.markdown || ''
      const htmlContent = article.html || ''

      // 生成签名
      const apiPath = '/blog-console-api/v3/mdeditor/saveArticle'
      const headers = await this.signRequest(apiPath)

      const response = await this.runtime.fetch(
        `https://bizapi.csdn.net${apiPath}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Cookie': cookieStr,
          },
          body: JSON.stringify({
            title: article.title,
            markdowncontent: markdown,
            content: htmlContent,
            readType: 'public',
            level: 0,
            tags: '',
            status: 2, // 草稿
            categories: '',
            type: 'original',
            original_link: '',
            authorized_status: false,
            not_auto_saved: '1',
            source: 'pc_mdeditor',
            cover_images: [],
            cover_type: 1,
            is_new: 1,
            vote_id: 0,
            resource_id: '',
            pubStatus: 'draft',
            creator_activity_id: '',
          }),
        }
      )

      const res = await response.json() as {
        code: number
        message?: string
        msg?: string
        data?: { id: string }
      }

      if (res.code !== 200 || !res.data?.id) {
        throw new Error(res.msg || res.message || '保存草稿失败')
      }

      const postId = res.data.id
      const draftUrl = `https://editor.csdn.net/md?articleId=${postId}`

      return {
        platform: this.meta.id,
        success: true,
        postId: postId,
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
