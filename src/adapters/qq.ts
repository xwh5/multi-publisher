/**
 * 企鹅号适配器
 * 认证方式: Cookie
 * 发布方式: API (editorCache/update)
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { ConfigStore } from '../config.js'
import { existsSync } from 'node:fs'

export class QQAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'qq',
    name: '企鹅号',
    icon: 'https://inews.gtimg.com/news_lite/20210806/favicon.ico',
    homepage: 'https://om.qq.com/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private runtime!: RuntimeInterface

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime
  }

  private async getCookies(): Promise<Record<string, string> | null> {
    return await ConfigStore.getQQCookies()
  }

  async checkAuth(): Promise<AuthResult> {
    const cookieData = await this.getCookies()
    if (!cookieData || Object.keys(cookieData).length === 0) {
      return { isAuthenticated: false, error: '未配置企鹅号 Cookie，请运行: mpub login --platform qq' }
    }

    if (!cookieData['userid']) {
      return { isAuthenticated: false, error: 'Cookie 中缺少 userid，可能登录已失效' }
    }

    try {
      return {
        isAuthenticated: true,
        userId: cookieData['userid'],
        username: cookieData['pt2gguin'] ? `o${cookieData['pt2gguin']}` : undefined,
      }
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message }
    }
  }

  /**
   * 上传封面图片到企鹅号，返回图片 URL
   */
  private async uploadCover(imagePath: string, cookieStr: string): Promise<string | null> {
    const FormData = require('form-data')
    const fs = require('fs')

    const form = new FormData()
    const fileBuffer = fs.readFileSync(imagePath)
    const fileName = imagePath.split(/[\\/]/).pop() || 'image.jpg'

    form.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'image/jpeg',
    })

    const response = await this.runtime.fetch(
      'https://image.om.qq.com/cpom_pimage/ArchacaleUploadViaFile',
      {
        method: 'POST',
        headers: {
          'Cookie': cookieStr,
          'Referer': 'https://om.qq.com/',
          'X-Requested-With': 'XMLHttpRequest',
          ...form.getHeaders(),
        },
        body: form,
      }
    )

    if (!response.ok) {
      return null
    }

    try {
      const data = await response.json() as { code?: number; data?: { url?: Record<string, { imageUrl?: string }> } }
      if (data.code === 0 && data.data?.url) {
        const urlData = data.data.url
        return urlData['640']?.imageUrl || urlData['0']?.imageUrl || Object.values(urlData)[0]?.imageUrl || null
      }
    } catch {}
    return null
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    try {
      const cookieData = await this.getCookies()
      if (!cookieData || Object.keys(cookieData).length === 0) {
        throw new Error('未配置企鹅号 Cookie，请运行: mpub login --platform qq')
      }

      const cookieStr = Object.entries(cookieData)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')

      const mediaId = cookieData['userid']

      // 上传封面（如果有）
      let coverUrl = ''
      if (article.cover && existsSync(article.cover)) {
        try {
          coverUrl = await this.uploadCover(article.cover, cookieStr) || ''
          console.log(`[QQ] 封面上传结果: ${coverUrl || '失败'}`)
        } catch (err) {
          console.warn(`封面图上传失败: ${(err as Error).message}`)
        }
      }

      // 构建文章数据
      const articleData = {
        title: article.title,
        title2: '',
        tag: '',
        video: '',
        cover_type: coverUrl ? '1' : '1',
        imgurl_ext: '[]',
        category_id: '',
        content: `<p>${(article.markdown || article.html || '').replace(/<[^>]+>/g, '')}</p>`,
        orignal: 0,
        user_original: 0,
        music: '',
        activity: '',
        apply_olympic_flag: 0,
        apply_push_flag: 0,
        apply_reward_flag: 0,
        reward_flag: 0,
        survey_id: '',
        survey_name: '',
        imgurlsrc: coverUrl || null,
        om_activity_id: '',
        om_activity_name: '',
        activityInfo: '',
        commercialization_source: '',
        caiMaiInfo: '',
        isHowto: '0',
        howtoInfo: '',
        daihuoInfo: '',
        novel: '',
        needpub: 1,
        event_id: '',
        event_name: '',
        activity_scene_id: 0,
        hotBreak: '',
        self_declare: '',
        resource_aigc_mark_info: '{}',
        parent_article_id: '',
        conclusion: '',
        summary: article.summary || '',
        failedImage: [],
        adContentImgs: [],
        mediaId: mediaId,
        type: 0,
        unmount: false,
      }

      // 发送保存请求
      const postData = new URLSearchParams()
      postData.append('cache', JSON.stringify(articleData))
      postData.append('mediaid', mediaId)

      const response = await this.runtime.fetch(
        'https://om.qq.com/editorCache/update',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieStr,
            'Referer': 'https://om.qq.com/main/creation/article',
          },
          body: postData.toString(),
        }
      )

      const responseText = await response.text()

      if (!response.ok) {
        throw new Error(`保存文章失败: ${response.status} - ${responseText.substring(0, 100)}`)
      }

      let resultData: { response?: { code?: string; msg?: string } }
      try {
        resultData = JSON.parse(responseText)
      } catch {
        throw new Error(`保存响应无效: ${responseText.substring(0, 100)}`)
      }

      if (resultData.response?.code !== '0') {
        throw new Error(resultData.response?.msg || '保存文章失败')
      }

      return {
        platform: this.meta.id,
        success: true,
        draftOnly: true, // 企鹅号需要审核
        timestamp: Date.now() - start,
        postUrl: 'https://om.qq.com/main/creation/article',
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