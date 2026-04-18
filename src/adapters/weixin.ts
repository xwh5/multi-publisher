/**
 * 微信公众号适配器
 * 认证方式: AppID + AppSecret（access_token）
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { WechatPublisher } from './wechat-publisher.js'

export class WeixinAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'weixin',
    name: '微信公众号',
    icon: 'https://mp.weixin.qq.com/favicon.ico',
    homepage: 'https://mp.weixin.qq.com',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private runtime!: RuntimeInterface
  private publisher!: WechatPublisher

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime
    this.publisher = new WechatPublisher(runtime)
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const token = await this.publisher.getAccessToken()
      return {
        isAuthenticated: !!token,
        userId: 'authenticated',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { isAuthenticated: false, error: msg }
    }
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    try {
      if (!article.html) {
        throw new Error('article.html is required for WeChat publishing')
      }

      const result = await this.publisher.publishToDraft({
        title: article.title,
        content: article.html,
        cover: article.cover ?? '',
        author: article.author ?? '',
        source_url: article.source_url ?? '',
      })

      const token = await this.publisher.getAccessToken()
      const draftUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${result.media_id}&token=${token}&lang=zh_CN`

      return {
        platform: this.meta.id,
        success: true,
        postId: result.media_id,
        postUrl: draftUrl,
        draftOnly: true,
        timestamp: Date.now() - start,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        platform: this.meta.id,
        success: false,
        error: msg,
        timestamp: Date.now() - start,
      }
    }
  }
}
