/**
 * 微信公众号发布核心逻辑
 * - AppID + AppSecret 获取 access_token
 * - 图片上传到微信 CDN（使用 form-data + axios，兼容 Node 24）
 * - 创建草稿图文消息
 */
import type { RuntimeInterface } from '../runtime/index.js'
import axios from 'axios'
import { createReadStream } from 'node:fs'
import FormData from 'form-data'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { ConfigStore } from '../config.js'

interface UploadCache {
  [url: string]: string  // url → media_id
}

function extFromUrl(url: string): string {
  const ext = path.extname(new URL(url).pathname).toLowerCase()
  return ext || '.jpg'
}

function nameFromUrl(url: string): string {
  return path.basename(new URL(url).pathname) || `image${extFromUrl(url)}`
}

export class WechatPublisher {
  private runtime: RuntimeInterface
  private uploadCache: UploadCache = {}

  constructor(runtime: RuntimeInterface) {
    this.runtime = runtime
  }

  private async loadCredential(): Promise<{ appId: string; appSecret: string }> {
    const cred = await ConfigStore.getWeixin()
    const appId = cred.appId
    const appSecret = cred.appSecret
    if (!appId || !appSecret) {
      throw new Error('未配置微信公众号凭据。请运行: mpub credential --set')
    }
    return { appId, appSecret }
  }

  async getAccessToken(): Promise<string> {
    const cred = await ConfigStore.getWeixin()
    const tokenExpiresAt = cred.token_expires_at
    if (cred.access_token && tokenExpiresAt && Date.now() < tokenExpiresAt) {
      return cred.access_token
    }

    const { appId, appSecret } = await this.loadCredential()
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
    const res = await axios.get(url)
    const data = res.data as { access_token?: string; expires_in?: number; errmsg?: string }

    if (!data.access_token) {
      throw new Error(`获取 access_token 失败: ${data.errmsg || JSON.stringify(data)}`)
    }

    const newToken = data.access_token
    const expiresAt = Date.now() + ((data.expires_in || 7200) - 300) * 1000
    await ConfigStore.setWeixin({ access_token: newToken, token_expires_at: expiresAt })
    return newToken
  }

  /**
   * 下载图片并以指定文件名上传到微信 CDN
   */
  async uploadImageFromUrl(imageUrl: string): Promise<string> {
    if (this.uploadCache[imageUrl]) return this.uploadCache[imageUrl]

    // 下载图片到临时文件
    const res = await this.runtime.fetch(imageUrl)
    if (!res.ok) throw new Error(`图片下载失败: ${imageUrl}`)
    const buf = await res.arrayBuffer()
    const ext = extFromUrl(imageUrl)
    const tmp = path.join(os.tmpdir(), `mpub-img-${Date.now()}${ext}`)
    await fs.writeFile(tmp, Buffer.from(buf))

    const filename = nameFromUrl(imageUrl)
    const mediaId = await this.uploadImageFromPath(tmp, filename)
    await fs.unlink(tmp).catch(() => {})

    this.uploadCache[imageUrl] = mediaId
    return mediaId
  }

  /**
   * 上传本地图片到微信 CDN
   */
  /**
   * 上传本地图片到微信 CDN（临时素材，用于正文嵌入）
   */
  async uploadImageFromPath(filePath: string, filename?: string): Promise<string> {
    const token = await this.getAccessToken()
    const name = filename ?? path.basename(filePath)

    const form = new FormData()
    form.append('media', createReadStream(filePath), name)

    const res = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=image`,
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity }
    )

    const data = res.data as { media_id?: string; url?: string; errcode?: number; errmsg?: string }
    if (!data.media_id) {
      throw new Error(`图片上传失败: ${data.errmsg || JSON.stringify(data)}`)
    }
    return data.media_id
  }

  /**
   * 上传永久素材图片（用于封面 thumb_media_id，draft/add 必须用永久素材）
   * 使用 material/add_material 接口
   */
  async uploadPermanentImageFromPath(filePath: string, filename?: string): Promise<string> {
    const token = await this.getAccessToken()
    const name = filename ?? path.basename(filePath)

    const form = new FormData()
    form.append('media', createReadStream(filePath), name)
    form.append('type', 'image')

    const res = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity }
    )

    const data = res.data as { media_id?: string; url?: string; errcode?: number; errmsg?: string }
    if (!data.media_id) {
      throw new Error(`永久素材上传失败: ${data.errmsg || JSON.stringify(data)}`)
    }
    return data.media_id
  }

  /**
   * 从 URL 下载图片并上传为永久素材（用于封面）
   */
  async uploadPermanentImageFromUrl(imageUrl: string): Promise<string> {
    if (this.uploadCache[imageUrl]) return this.uploadCache[imageUrl]

    const res = await this.runtime.fetch(imageUrl)
    if (!res.ok) throw new Error(`封面图片下载失败: ${imageUrl}`)
    const buf = await res.arrayBuffer()
    const ext = extFromUrl(imageUrl)
    const tmp = path.join(os.tmpdir(), `mpub-perm-${Date.now()}${ext}`)
    await fs.writeFile(tmp, Buffer.from(buf))

    try {
      const mediaId = await this.uploadPermanentImageFromPath(tmp, nameFromUrl(imageUrl))
      this.uploadCache[imageUrl] = mediaId
      return mediaId
    } finally {
      await fs.unlink(tmp).catch(() => {})
    }
  }

  /**
   * 处理 HTML 中的图片：本地图片上传到微信 CDN，外部图片保留原 URL
   * 返回处理后的 HTML 和第一张可用的 media_id（用作封面）
   */
  async processImages(html: string): Promise<{ html: string; firstMediaId?: string }> {
    const imgPattern = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi
    let firstMediaId: string | undefined
    let replaced = html

    for (const match of [...html.matchAll(imgPattern)]) {
      const original = match[0]
      const src = match[1]

      // 跳过微信已有域名
      if (src.includes('mmbiz.qpic.cn') || src.includes('mmbiz.qlogo.cn')) continue

      // 外部 URL 图片保留原样（微信支持显示外部图片）
      if (src.startsWith('http://') || src.startsWith('https://')) {
        console.warn(`[WechatPublisher] 外部图片保留原 URL: ${src}`)
        continue
      }

      try {
        const mediaId = await this.uploadImageFromUrl(src)
        if (!firstMediaId) firstMediaId = mediaId
        const cdnUrl = `https://mmbiz.qpic.cn/mmbiz_png/${mediaId}/0`
        replaced = replaced.replace(original, original.replace(src, cdnUrl))
      } catch (err) {
        console.warn(`[WechatPublisher] 上传图片失败 ${src}: ${(err as Error).message}，保留原 URL`)
      }
    }

    return { html: replaced, firstMediaId }
  }

  /**
   * 发布到微信公众号草稿箱
   */
  async publishToDraft(options: {
    title: string
    content: string
    cover: string
    author: string
    source_url: string
  }): Promise<{ media_id: string }> {
    const token = await this.getAccessToken()

    const { html: processedHtml, firstMediaId } = await this.processImages(options.content)

    // 上传封面图
    let thumbMediaId: string | undefined
    try {
      thumbMediaId = await this.uploadCover(options.cover)
    } catch (err) {
      console.warn(`[WechatPublisher] 封面上传失败，遍历正文图片: ${(err as Error).message}`)
      const imgMatches = [...options.content.matchAll(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi)]
      for (const m of imgMatches) {
        const src = m[1]
        if (src.includes('mmbiz.qpic.cn') || src.includes('mmbiz.qlogo.cn')) continue
        try {
          thumbMediaId = await this.uploadImageFromUrl(src)
          console.log(`[WechatPublisher] 用正文图片作封面: ${src}`)
          break
        } catch { /* continue */ }
      }
    }

    if (!thumbMediaId) {
      console.warn('[WechatPublisher] 没有可用封面，将使用微信默认封面')
    }

    const article: Record<string, unknown> = {
      title: options.title,
      author: options.author,
      content: processedHtml,
      digest: options.title,
      content_source_url: options.source_url,
    }
    if (thumbMediaId) article.thumb_media_id = thumbMediaId

    const payload = { articles: [article] }

    const res = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`,
      payload,
      { headers: { 'Content-Type': 'application/json' }, responseType: 'json' }
    )
    const data = res.data as { media_id?: string; errcode?: number; errmsg?: string }

    if (!data.media_id) {
      throw new Error(`发布草稿失败: ${data.errmsg || JSON.stringify(data)}`)
    }

    return { media_id: data.media_id }
  }

  private async uploadCover(coverUrl: string): Promise<string> {
    if (!coverUrl) throw new Error('封面图 URL 为空')
    if (!coverUrl.startsWith('http')) return this.uploadPermanentImageFromPath(coverUrl)
    return this.uploadPermanentImageFromUrl(coverUrl)
  }
}
