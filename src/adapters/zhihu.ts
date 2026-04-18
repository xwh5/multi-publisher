/**
 * 知乎适配器
 * 认证方式: Cookie（从 www.zhihu.com 主页提取）
 *
 * API 流程: 创建草稿 → 更新草稿内容
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { ConfigStore } from '../config.js'

interface ZhihuCookie {
  cookies?: Record<string, string>
}

export class ZhihuAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'zhihu',
    name: '知乎',
    icon: 'https://static.zhihu.com/favicon.ico',
    homepage: 'https://www.zhihu.com',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private runtime!: RuntimeInterface
  private cookieData: ZhihuCookie | null = null

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime
    this.cookieData = await this.loadCookie()
  }

  private getCookiePath(): string {
    return ConfigStore.getDir() + '/cookies/zhihu.json'
  }

  private async loadCookie(): Promise<ZhihuCookie | null> {
    const cookies = await ConfigStore.getZhihuCookies()
    if (!cookies) return null
    return { cookies }
  }

  private buildCookieString(cookieData: ZhihuCookie): string {
    if (!cookieData.cookies) return ''
    return Object.entries(cookieData.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData?.cookies) {
      return { isAuthenticated: false, error: '未配置知乎 Cookie，请运行: mpub cookie --platform zhihu --set' }
    }

    try {
      const res = await this.runtime.fetch('https://www.zhihu.com/api/v4/me', {
        headers: {
          'Cookie': this.buildCookieString(this.cookieData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-Requested-With': 'fetch',
        },
      })

      if (!res.ok) {
        return { isAuthenticated: false, error: `HTTP ${res.status}` }
      }

      const data = await res.json() as { id?: string; name?: string; avatar_url?: string }
      if (data.id) {
        return { isAuthenticated: true, userId: data.id, username: data.name, avatar: data.avatar_url }
      }

      return { isAuthenticated: false, error: '未获取到用户信息' }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    try {
      if (!this.cookieData?.cookies) {
        throw new Error('未配置知乎 Cookie，请运行: mpub cookie --platform zhihu --set')
      }

      const cookieStr = this.buildCookieString(this.cookieData)

      // 1. 创建草稿
      const createRes = await this.runtime.fetch('https://zhuanlan.zhihu.com/api/articles/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieStr,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          title: article.title,
          content: '',
          delta_time: 0,
        }),
      })

      if (!createRes.ok) {
        const errBody = await createRes.text()
        throw new Error(`创建草稿失败 (${createRes.status}): ${errBody}`)
      }

      const createData = await createRes.json() as { id?: string }
      if (!createData.id) {
        throw new Error('创建草稿失败: 无效响应')
      }

      const draftId = createData.id

      // 2. 处理内容 - 使用 HTML 格式
      let content = article.html || ''

      // 3. 知乎特殊处理：图片格式、代码块等
      content = this.transformContent(content)

      // 4. 更新草稿内容
      const updateRes = await this.runtime.fetch(
        `https://zhuanlan.zhihu.com/api/articles/${draftId}/draft`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieStr,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({
            title: article.title,
            content: content,
          }),
        }
      )

      if (!updateRes.ok) {
        throw new Error(`更新草稿失败: ${updateRes.status}`)
      }

      const draftUrl = `https://zhuanlan.zhihu.com/p/${draftId}/edit`

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

  /**
   * 知乎内容转换
   */
  private transformContent(content: string): string {
    let result = content

    // 图片格式 - 知乎需要 figure 包裹
    result = result.replace(
      /<img([^>]+)src="([^"]+)"([^>]*)>/gi,
      '<figure><img$1src="$2"$3></figure>'
    )

    // 代码块格式
    result = result.replace(
      /<pre><code class="language-(\w+)">/gi,
      '<pre lang="$1"><code>'
    )

    // 移除微信样式属性
    result = result.replace(/\s*data-(?!draft)[a-z-]+="[^"]*"/gi, '')
    result = result.replace(/\s*style="[^"]*"/gi, '')

    return result
  }
}
