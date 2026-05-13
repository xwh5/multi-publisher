/**
 * 图片上传工具 - 提供公共 URL 供各平台使用
 * 尝试多个图床服务，按优先级 fallback
 */
import axios from 'axios'
import FormData from 'form-data'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 上传本地图片到图床（自动重试多个服务）
 * 返回公开 URL
 */
export async function uploadImageToPublicUrl(filePath: string): Promise<string> {
  const services = [
    () => uploadToLitterbox(filePath),
    () => uploadToCatbox(filePath),
  ]

  for (const attempt of services) {
    try {
      const url = await attempt()
      return url
    } catch (err) {
      console.warn(`[imgbb-uploader] 上传失败: ${(err as Error).message}，尝试下一个服务`)
    }
  }
  throw new Error('所有图床上传服务均失败')
}

/**
 * 上传到 Litterbox（临时，1小时有效期，无需认证）
 */
async function uploadToLitterbox(filePath: string): Promise<string> {
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('time', '1h')
  form.append('fileToUpload', readFileSync(filePath), {
    filename: path.basename(filePath),
    contentType: 'image/png',
  })

  const res = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
    headers: form.getHeaders(),
    timeout: 30000,
  })

  const url = (res.data as string).trim()
  if (!url.startsWith('http')) {
    throw new Error(`Litterbox 上传失败: ${url}`)
  }
  return url
}

/**
 * 上传到 Catbox.moe（永久，无需认证）
 */
async function uploadToCatbox(filePath: string): Promise<string> {
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('fileToUpload', readFileSync(filePath), {
    filename: path.basename(filePath),
    contentType: 'image/png',
  })

  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    timeout: 30000,
  })

  const url = res.data as string
  if (!url.startsWith('http')) {
    throw new Error(`Catbox 上传失败: ${url}`)
  }
  return url
}

/**
 * 上传到 0x0.st（匿名，无需 API key）- 已禁用
 */
export async function uploadTo0x0st(filePath: string): Promise<string> {
  const form = new FormData()
  form.append('file', readFileSync(filePath), {
    filename: path.basename(filePath),
    contentType: 'image/png',
  })

  const res = await axios.post('https://0x0.st', form, {
    headers: form.getHeaders(),
    timeout: 30000,
  })

  const url = (res.data as string).trim()
  if (!url.startsWith('http')) {
    throw new Error(`0x0.st 上传失败: ${url}`)
  }
  return url
}

export { uploadToLitterbox, uploadToCatbox }