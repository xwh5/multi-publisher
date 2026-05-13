/**
 * 微信公众号适配器
 * 认证方式: AppID + AppSecret（access_token）
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { WechatPublisher } from './wechat-publisher.js'
import os from 'os'
import fs from 'node:fs/promises'

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

  private getPublisher(): WechatPublisher {
    if (!this.publisher) {
      this.publisher = new WechatPublisher(this.runtime)
    }
    return this.publisher
  }

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const token = this.getPublisher().getAccessToken()
      return {
        isAuthenticated: !!token,
        userId: 'authenticated',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { isAuthenticated: false, error: msg }
    }
  }

  async processMermaid(html: string): Promise<{ html: string; tempFiles: string[] }> {
    const { processMermaid: convert } = await import('../core/renderer.js')
    const { html: processed, tempFiles } = await convert(html, os.tmpdir())

    // 上传图片到微信 CDN 并替换 URL
    const imgPattern = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi
    let result = processed
    for (const match of [...processed.matchAll(imgPattern)]) {
      const original = match[0]
      const src = match[1]
      if (!src.startsWith('http://') && !src.startsWith('https://')) {
        try {
          const url = await this.getPublisher().uploadImageForArticle(src)
          result = result.replace(original, original.replace(src, url))
        } catch (err) {
          console.warn(`[weixin] mermaid 图片上传失败 ${src}: ${(err as Error).message}`)
        }
      }
    }
    return { html: result, tempFiles }
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    try {
      if (!article.html) {
        throw new Error('article.html is required for WeChat publishing')
      }

      // 处理 Mermaid 代码块（转换为图片并上传 CDN）
      let processedHtml = article.html
      if (this.processMermaid) {
        const { html: mermaidHtml, tempFiles } = await this.processMermaid(article.html)
        processedHtml = mermaidHtml
        // 清理临时文件
        await Promise.all(tempFiles.map(f => fs.unlink(f).catch(() => {})))
      }

      const result = await this.getPublisher().publishToDraft({
        title: article.title,
        content: processedHtml,
        cover: article.cover ?? '',
        author: article.author ?? '',
        source_url: article.source_url ?? '',
      })

      const token = await this.getPublisher().getAccessToken()
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
