/**
 * CSDN 适配器
 * 认证方式: Cookie + API 签名 (HMAC-SHA256)
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { ConfigStore } from '../config.js'
import { uploadCoverViaBrowser } from '../tools/browser-upload.js'
import { downloadCoverUrl } from '../tools/cover-fetcher.js'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'

interface CSDNCookie {
  cookies?: Record<string, string>
}

// CSDN API 签名密钥
const API_KEY = '203803574'
const API_SECRET = '9znpamsyl2c7cdrr9sas0le9vbc3r6ba'
// 封面图上传 API 的 key 和 secret
const COVER_API_KEY = '260196572'
const COVER_API_SECRET = 't5PaqxVQpWoHgLGt7XPIvd5ipJcwJTU7'

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

  /**
   * 上传图片到 CSDN
   * 流程：1. 调用签名 API 获取 policy 2. 直接上传到华为云 OBS
   * @param imagePath 本地文件路径或网络 URL
   * @returns CSDN 图片 URL
   */
  async uploadImage(imagePath: string): Promise<string> {
    if (!this.cookieData?.cookies) {
      throw new Error('未配置 CSDN Cookie')
    }

    // 如果是网络 URL，直接返回
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return imagePath
    }

    // 读取本地文件
    const fileBuffer = await fs.readFile(imagePath)
    const filename = path.basename(imagePath)
    const ext = path.extname(filename).toLowerCase()
    const imageSuffix = ext.replace('.', '')

    try {
      // 步骤 1: 获取上传签名 (policy)
      const signatureData = await this.getUploadSignature(imageSuffix)
      const { accessId, policy, signature, host, dir } = signatureData

      // 步骤 2: 直接上传到华为云 OBS
      const objectKey = `${dir}${filename}`
      const obsUrl = `${host}/${objectKey}`

      const formData = new FormData()
      formData.append('key', objectKey)
      formData.append('OSSAccessKeyId', accessId)
      formData.append('policy', policy)
      formData.append('signature', signature)
      formData.append('expire', signatureData.expire)
      formData.append('file', new Blob([fileBuffer]), filename)

      const response = await this.runtime.fetch(obsUrl, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`OBS 上传失败: ${response.status}`)
      }

      // 返回 CSDN 图片 URL
      return `https://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/${objectKey}`
    } catch (apiError) {
      throw new Error(`封面 API 上传失败: ${(apiError as Error).message}`)
    }
  }

  /**
   * 获取华为云 OBS 上传签名
   */
  private async getUploadSignature(imageSuffix: string): Promise<{
    accessId: string
    policy: string
    signature: string
    host: string
    dir: string
    expire: string
  }> {
    const cookieStr = this.buildCookieString(this.cookieData!)

    // CSDN 封面图签名 API 使用的 key 和之前的不同
    const coverApiKey = '260196572'
    const nonce = this.createUuid()
    const timestamp = Date.now().toString()

    const apiPath = '/resource-api/v1/image/direct/upload/signature'
    // 按照 Lt 函数格式: method\naccept\n\ncontentType\ntimestamp\n(sorted headers)\nurl
    const signStr = `POST\n*/*\n\napplication/json\n${timestamp}\nx-ca-key:${coverApiKey}\nx-ca-nonce:${nonce}\nx-ca-timestamp:${timestamp}\n${apiPath}`

    // 封面签名使用专用的 secret
    const signature = await this.hmacSha256(signStr, COVER_API_SECRET)

    const response = await this.runtime.fetch(
      `https://bizapi.csdn.net${apiPath}`,
      {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'x-ca-key': coverApiKey,
          'x-ca-nonce': nonce,
          'x-ca-timestamp': timestamp,
          'x-ca-signature': signature,
          'x-ca-signature-headers': 'x-ca-key,x-ca-nonce,x-ca-timestamp',
          'content-type': 'application/json',
          'Cookie': cookieStr,
        },
        body: JSON.stringify({
          imageTemplate: '',
          appName: 'direct_blog_coverimage',
          imageSuffix,
        }),
      }
    )

    const res = await response.json() as {
      code: number
      data?: {
        provider: string
        accessId: string
        policy: string
        signature: string
        host: string
        dir: string
        expire: string
      }
      message?: string
    }

    if (res.code !== 200 || !res.data) {
      throw new Error(res.message || '获取上传签名失败')
    }

    return res.data
  }

  /**
   * 处理封面图：上传本地文件或使用网络 URL
   */
  private async processCover(cover?: string): Promise<string[]> {
    if (!cover) return []

    try {
      const coverUrl = await this.uploadImage(cover)
      return [coverUrl]
    } catch (err) {
      console.warn(`[CSDN] 封面上传失败: ${(err as Error).message}`)
      return []
    }
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

      // 先发布文章（不带封面，因为 API 签名有问题）
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
            cover_type: 0,
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

      // 如果有封面图片，先下载 URL 封面到本地，再通过浏览器上传
      if (article.cover) {
        let localCover = article.cover

        // 如果是 URL 封面，先下载到本地
        if (!existsSync(article.cover)) {
          console.log(`[CSDN] 封面是 URL，正在下载到本地...`)
          const downloadResult = await downloadCoverUrl(article.cover)
          if (!downloadResult.success || !downloadResult.localPath) {
            console.warn(`[CSDN] 封面下载失败: ${downloadResult.error}，跳过封面上传`)
          } else {
            localCover = downloadResult.localPath
            console.log(`[CSDN] 封面下载成功: ${localCover}`)
          }
        }

        if (existsSync(localCover)) {
          console.log(`[CSDN] 封面上传中...`)
          const coverResult = await uploadCoverViaBrowser(postId, localCover)
          if (coverResult.success && coverResult.coverUrl) {
            console.log(`[CSDN] 封面 URL: ${coverResult.coverUrl}`)
          } else {
            console.warn(`[CSDN] 封面上传失败: ${coverResult.error}`)
          }
        }
      }

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
