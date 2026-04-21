/**
 * 根据文章标题自动获取封面图片
 * 使用 Bing 图片搜索
 */
import { chromium, type Browser, type Page } from 'playwright'
import { createWriteStream, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

export interface CoverFetchResult {
  success: boolean
  localPath?: string  // 本地临时文件路径
  imageUrl?: string   // 原始图片 URL
  error?: string
}

/**
 * 生成随机文件名
 */
function generateFilename(ext: string = '.jpg'): string {
  const random = crypto.randomBytes(8).toString('hex')
  return `cover-${Date.now()}-${random}${ext}`
}

/**
 * 获取文件扩展名
 */
function getExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname).toLowerCase()
    if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      return ext
    }
  } catch {}
  return '.jpg'
}

/**
 * 根据 Content-Type 获取文件扩展名
 */
function getExtensionFromContentType(contentType: string): string | null {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  }
  return map[contentType.toLowerCase()] || null
}

/**
 * 将 WebP 图片转换为 PNG
 */
async function convertWebpToPng(webpPath: string, outputDir: string): Promise<string> {
  const sharp = await import('sharp')
  const filename = generateFilename('.png')
  const pngPath = path.join(outputDir, filename)

  await sharp.default(webpPath)
    .png()
    .toFile(pngPath)

  // 删除 WebP 源文件
  await fs.unlink(webpPath).catch(() => {})

  console.log(`[cover-fetcher] WebP 已转换为 PNG: ${filename}`)
  return pngPath
}

/**
 * 根据文件魔术字节检测图片真实类型
 */
function detectImageType(buffer: Buffer): string | null {
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return '.png'
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return '.jpg'
  }
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return '.gif'
  }
  // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return '.webp'
  }
  return null
}

/**
 * 根据标题获取封面图片
 * @param title 文章标题
 * @param options 配置选项
 * @returns 封面图片本地路径
 */
export async function fetchCoverByTitle(
  title: string,
  options: {
    headless?: boolean
    timeout?: number
    outputDir?: string
  } = {}
): Promise<CoverFetchResult> {
  const {
    headless = true,
    timeout = 15000,
    outputDir = tmpdir(),
  } = options

  let browser: Browser | null = null

  try {
    console.log(`[cover-fetcher] 开始搜索封面图: "${title}"`)

    browser = await chromium.launch({ headless })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    const page = await context.newPage()

    // 绕过反爬检测
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    // 访问 Bing 图片搜索
    const searchUrl = `https://cn.bing.com/images/search?q=${encodeURIComponent(title)}&first=1&rdr=1`
    console.log(`[cover-fetcher] 访问: ${searchUrl}`)

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })

    // 等待图片加载
    try {
      await page.waitForSelector('.img_container img, .iusc img, a[rel="nofollow"] img', {
        timeout: timeout / 2
      })
    } catch {
      // 尝试备用选择器
      try {
        await page.waitForSelector('.dgControl', { timeout: 3000 })
      } catch {
        // 继续尝试其他方式
      }
    }

    // 提取第一张图片 URL（尝试多种方式）
    let imageUrl: string | null = null

    // 方式1：查找 iusc 中的大图 URL (murl 是中等尺寸，turl 是缩略图)
    const iuscElement = await page.$('.iusc')
    if (iuscElement) {
      const m = await iuscElement.getAttribute('m')
      if (m) {
        try {
          const mData = JSON.parse(m)
          // 优先使用 murl（中等尺寸），避免使用带参数的缩略图 URL
          imageUrl = mData.murl || mData.EmbedUrl || mData.turl
          console.log(`[cover-fetcher] 从 iusc 获取到图片 URL: ${imageUrl?.substring(0, 60)}...`)
        } catch {}
      }
    }

    // 方式2：如果没找到，尝试从 .mimg 获取
    if (!imageUrl) {
      const mimgElement = await page.$('.mimg')
      if (mimgElement) {
        // 尝试获取 data-src（通常是较大图片）
        imageUrl = await mimgElement.getAttribute('data-src')
        if (!imageUrl) {
          imageUrl = await mimgElement.getAttribute('src')
        }
        console.log(`[cover-fetcher] 从 mimg 获取到图片 URL`)
      }
    }

    // 方式3：直接找 img 标签，排除 bing 缩略图
    if (!imageUrl) {
      const images = await page.$$('img')
      for (const img of images) {
        const src = await img.getAttribute('src')
        const dataSrc = await img.getAttribute('data-src')
        const url = src || dataSrc

        // 排除 bing 缩略图和太短的 URL
        if (url && url.startsWith('http') && !url.includes('bing.com/th?id=') && url.length > 50) {
          imageUrl = url
          console.log(`[cover-fetcher] 从 img 标签获取到图片 URL`)
          break
        }
      }
    }

    // 方式4：查找 .dam_u 容器中的链接
    if (!imageUrl) {
      const thumbLinks = await page.$$('.dam_u')
      for (const link of thumbLinks) {
        const href = await link.getAttribute('href')
        if (href && href.includes('imgurl=')) {
          const match = href.match(/imgurl=([^&]+)/)
          if (match) {
            imageUrl = decodeURIComponent(match[1])
            break
          }
        }
      }
    }

    // 方式5：备用 - 使用 Picsum 随机图片（基于标题生成种子保证一致性）
    if (!imageUrl) {
      console.log(`[cover-fetcher] Bing 未找到图片，使用 Picsum 备用方案...`)
      // 使用标题的 hash 作为种子，保证相同标题得到相同图片
      const titleHash = title.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0)
        return a & a
      }, 0)
      const seed = Math.abs(titleHash) % 1000000
      imageUrl = `https://picsum.photos/seed/${seed}/800/450`
      console.log(`[cover-fetcher] 使用 Picsum: ${imageUrl}`)
    }

    if (!imageUrl) {
      await browser.close()
      return {
        success: false,
        error: '未找到合适的图片'
      }
    }

    console.log(`[cover-fetcher] 找到图片: ${imageUrl.substring(0, 80)}...`)

    // 下载图片
    let buffer: Buffer | null = null
    let actualContentType = ''

    // 方法1：使用 page.request.get
    try {
      const imageResponse = await page.request.get(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://cn.bing.com/',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: timeout,
      })

      if (imageResponse.ok()) {
        buffer = await imageResponse.body()
        actualContentType = imageResponse.headers()['content-type'] || ''
      }
    } catch (e) {
      console.log(`[cover-fetcher] 方法1失败: ${(e as Error).message}`)
    }

    // 方法2：如果 Picsum，直接用浏览器加载
    if (!buffer || buffer.length < 1000) {
      if (imageUrl.includes('picsum.photos')) {
        try {
          console.log(`[cover-fetcher] 使用浏览器加载 Picsum 图片...`)
          const imgPage = await context.newPage()
          await imgPage.goto(imageUrl, { waitUntil: 'networkidle', timeout: 15000 })

          // Picsum 会自动重定向到真实图片
          const finalUrl = imgPage.url()
          console.log(`[cover-fetcher] Picsum 重定向到: ${finalUrl}`)

          // 从 Picsum 获取真实的图片 URL
          if (finalUrl.includes('picsum.photos')) {
            // 使用 finalUrl 作为新 URL 重新下载
            const imgResponse = await imgPage.request.get(finalUrl, {
              timeout: timeout,
            })
            if (imgResponse.ok()) {
              buffer = await imgResponse.body()
              actualContentType = imgResponse.headers()['content-type'] || ''
            }
          }

          await imgPage.close()
        } catch (e) {
          console.log(`[cover-fetcher] Picsum 加载失败: ${(e as Error).message}`)
        }
      }
    }

    // 方法3：直接从浏览器截图方式获取图片尺寸
    if (!buffer || buffer.length < 1000) {
      try {
        console.log(`[cover-fetcher] 尝试从页面提取图片信息...`)
        const imgPage = await context.newPage()
        await imgPage.goto(imageUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})

        // 检查是否加载成功
        const loaded = await imgPage.evaluate(() => {
          return document.body && document.body.children.length > 0
        }).catch(() => false)

        if (loaded) {
          console.log(`[cover-fetcher] 页面加载成功`)
        }

        await imgPage.close()
      } catch (e) {
        console.log(`[cover-fetcher] 方法3失败: ${(e as Error).message}`)
      }
    }

    // 如果以上方法都失败，使用 Picsum 作为后备方案
    if (!buffer || buffer.length < 1000) {
      console.log(`[cover-fetcher] 使用 Picsum 后备方案...`)
      const titleHash = title.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0)
        return a & a
      }, 0)
      const seed = Math.abs(titleHash) % 1000000
      const picsumUrl = `https://picsum.photos/seed/${seed}/800/450`

      try {
        const response = await page.request.get(picsumUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          timeout: timeout,
        })
        if (response.ok()) {
          buffer = await response.body()
          actualContentType = response.headers()['content-type'] || ''
          imageUrl = picsumUrl
        }
      } catch (e) {
        console.log(`[cover-fetcher] Picsum 后备也失败: ${(e as Error).message}`)
      }
    }

    if (!buffer || buffer.length < 1000) {
      await browser.close()
      return {
        success: false,
        error: '无法下载图片'
      }
    }

    // 从魔术字节检测真实图片类型
    const detectedExt = detectImageType(buffer)
    const fromHeader = getExtensionFromContentType(actualContentType)
    const ext = detectedExt || fromHeader || getExtension(imageUrl)
    const filename = generateFilename(ext)
    let localPath = path.join(outputDir, filename)

    await fs.writeFile(localPath, buffer)

    // 如果是 WebP 格式，转换为 PNG（微信不支持 WebP）
    if (ext === '.webp') {
      try {
        localPath = await convertWebpToPng(localPath, outputDir)
      } catch (e) {
        console.warn(`[cover-fetcher] WebP 转换失败: ${(e as Error).message}，保留原文件`)
      }
    }

    const typeInfo = detectedExt ? `magic:${detectedExt}` : (fromHeader ? `header:${fromHeader}` : `url:${ext}`)
    console.log(`[cover-fetcher] 下载成功: ${path.basename(localPath)} (${typeInfo}), 大小: ${(buffer.length / 1024).toFixed(1)} KB`)

    await browser.close()

    return {
      success: true,
      localPath,
      imageUrl
    }
  } catch (error) {
    console.error(`[cover-fetcher] 获取封面图失败:`, error)
    return {
      success: false,
      
      error: (error as Error).message
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}

/**
 * 清理临时封面文件
 */
export async function cleanupCoverFile(localPath: string | undefined): Promise<void> {
  if (!localPath) return
  try {
    await fs.unlink(localPath)
    console.log(`[cover-fetcher] 已清理临时文件: ${localPath}`)
  } catch {}
}

/**
 * 下载远程封面图片到本地临时目录
 * @param coverUrl 远程图片 URL
 * @param options 配置选项
 * @returns 本地临时文件路径
 */
export async function downloadCoverUrl(
  coverUrl: string,
  options: {
    timeout?: number
    outputDir?: string
  } = {}
): Promise<CoverFetchResult> {
  const {
    timeout = 15000,
    outputDir = tmpdir(),
  } = options

  if (!coverUrl || !coverUrl.startsWith('http')) {
    return { success: false, error: '无效的 URL' }
  }

  let browser: Browser | null = null

  try {
    console.log(`[cover-fetcher] 下载封面: ${coverUrl.substring(0, 80)}...`)

    browser = await chromium.launch({ headless: true })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    const page = await context.newPage()

    // 绕过反爬检测
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    let buffer: Buffer | null = null
    let actualContentType = ''

    // 方法1：直接下载
    try {
      const response = await page.request.get(coverUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: timeout,
      })

      if (response.ok()) {
        buffer = await response.body()
        actualContentType = response.headers()['content-type'] || ''
        console.log(`[cover-fetcher] 下载成功，大小: ${(buffer.length / 1024).toFixed(1)} KB`)
      }
    } catch (e) {
      console.log(`[cover-fetcher] 直接下载失败: ${(e as Error).message}`)
    }

    // 方法2：如果失败，尝试通过浏览器加载
    if (!buffer || buffer.length < 1000) {
      try {
        await page.goto(coverUrl, { waitUntil: 'networkidle', timeout: 15000 })
        const finalUrl = page.url()
        if (finalUrl !== coverUrl) {
          const response2 = await page.request.get(finalUrl, { timeout: timeout })
          if (response2.ok()) {
            buffer = await response2.body()
            actualContentType = response2.headers()['content-type'] || ''
          }
        }
      } catch (e) {
        console.log(`[cover-fetcher] 浏览器加载失败: ${(e as Error).message}`)
      }
    }

    if (!buffer || buffer.length < 1000) {
      return { success: false, error: '无法下载图片' }
    }

    // 检测图片类型
    const detectedExt = detectImageType(buffer)
    const fromHeader = getExtensionFromContentType(actualContentType)
    const ext = detectedExt || fromHeader || getExtension(coverUrl)
    const filename = generateFilename(ext)
    const localPath = path.join(outputDir, filename)

    await fs.writeFile(localPath, buffer)

    // WebP 转换为 PNG
    if (ext === '.webp') {
      try {
        const convertedPath = await convertWebpToPng(localPath, outputDir)
        return { success: true, localPath: convertedPath, imageUrl: coverUrl }
      } catch {
        console.warn(`[cover-fetcher] WebP 转换失败，保留原文件`)
      }
    }

    return {
      success: true,
      localPath,
      imageUrl: coverUrl
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}
