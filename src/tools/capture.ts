/**
 * 通用抓包工具
 *
 * 使用方式:
 *   node dist/tools/capture.js <platform> [timeout]
 *
 * 示例:
 *   node dist/tools/capture.js csdn        # 抓取 CSDN (60s 超时)
 *   node dist/tools/capture.js csdn 120    # 抓取 CSDN (120s 超时)
 *   node dist/tools/capture.js juejin      # 抓取掘金
 */
import { chromium, type Browser, type Page, type Request } from 'playwright'
import { ConfigStore } from '../config.js'
import fs from 'fs/promises'
import path from 'path'

interface CaptureOptions {
  platform: string
  timeout: number
}

interface CapturedRequest {
  id: string
  timestamp: number
  method: string
  url: string
  headers: Record<string, string>
  postData?: string
  responseStatus?: number
  responseBody?: string
  matched: boolean  // 是否匹配上传特征
}

interface CaptureData {
  platform: string
  captureTime: string
  timeout: number
  editorUrl: string
  uploadApiUrl?: string
  requests: CapturedRequest[]
  summary: {
    totalRequests: number
    matchedRequests: number
    uploadEndpoints: string[]
  }
}

// 平台配置
const PLATFORM_CONFIGS: Record<string, { editorUrl: string; uploadPatterns: RegExp[] }> = {
  csdn: {
    editorUrl: 'https://editor.csdn.net/md/',
    uploadPatterns: [/uploadImg/i, /upload/i, /file/i, /image/i],
  },
  juejin: {
    editorUrl: 'https://editor.juejin.cn/',
    uploadPatterns: [/upload/i, /file/i, /image/i, /img/i],
  },
  zhihu: {
    editorUrl: 'https://zhuanlan.zhihu.com/write',
    uploadPatterns: [/upload/i, /file/i, /image/i, /img/i],
  },
  toutiao: {
    editorUrl: 'https://mp.toutiao.com/',
    uploadPatterns: [/upload/i, /file/i, /image/i, /img/i],
  },
  jianshu: {
    editorUrl: 'https://www.jianshu.com/writer',
    uploadPatterns: [/upload/i, /file/i, /image/i, /img/i],
  },
  weibo: {
    editorUrl: 'https://weibo.com/compose',
    uploadPatterns: [/upload/i, /file/i, /image/i, /img/i],
  },
  qq: {
    editorUrl: 'https://om.qq.com/main/creation/article',
    uploadPatterns: [/upload/i, /file/i, /image/i, /img/i, /cover/i],
  },
}

function isUploadRequest(url: string, headers: Record<string, string>, postData?: string): boolean {
  const contentType = headers['content-type'] || ''
  const isMultipart = contentType.includes('multipart/form-data')
  const isUploadUrl = PLATFORM_CONFIGS[Object.keys(PLATFORM_CONFIGS)[0]]?.uploadPatterns.some(p => p.test(url))

  // 检查 URL 是否匹配上传模式
  for (const config of Object.values(PLATFORM_CONFIGS)) {
    if (config.uploadPatterns.some(p => p.test(url))) {
      return true
    }
  }

  // 如果是 multipart/form-data，很可能是上传
  if (isMultipart) {
    return true
  }

  return false
}

async function loadCookies(platform: string): Promise<Record<string, string>> {
  try {
    switch (platform) {
      case 'csdn': return await ConfigStore.getCSDNCookies() || {}
      case 'zhihu': return await ConfigStore.getZhihuCookies() || {}
      case 'juejin': return await ConfigStore.getJuejinCookies() || {}
      case 'toutiao': return await ConfigStore.getToutiaoCookies() || {}
      case 'jianshu': return await ConfigStore.getJianshuCookies() || {}
      case 'weibo': return await ConfigStore.getWeiboCookies() || {}
      case 'qq': return await ConfigStore.getQQCookies() || {}
      default: return {}
    }
  } catch {
    return {}
  }
}

function getCookieDomains(platform: string): string[] {
  const domains: Record<string, string[]> = {
    csdn: ['.csdn.net', '.bizapi.csdn.net'],
    zhihu: ['.zhihu.com'],
    juejin: ['.juejin.cn', '.掘金.com'],
    toutiao: ['.toutiao.com'],
    jianshu: ['.jianshu.com'],
    weibo: ['.weibo.com', '.sina.com.cn'],
    qq: ['.qq.com', '.om.qq.com'],
  }
  return domains[platform] || []
}

export async function capture(platform: string, timeoutMs: number = 60000): Promise<CaptureData | null> {
  const config = PLATFORM_CONFIGS[platform]
  if (!config) {
    console.error(`不支持的平台: ${platform}`)
    console.error(`支持的平台: ${Object.keys(PLATFORM_CONFIGS).join(', ')}`)
    return null
  }

  console.log(`
========================================
  通用抓包工具 - ${platform.toUpperCase()}
========================================
平台: ${platform}
编辑器: ${config.editorUrl}
超时: ${timeoutMs / 1000}秒
========================================
`)

  // 加载 cookies
  const cookies = await loadCookies(platform)
  if (Object.keys(cookies).length === 0) {
    console.warn(`⚠️  未找到 ${platform} 的 cookies，可能需要先登录`)
    console.warn(`   运行: node dist/cli/index.js login --platform ${platform}`)
  } else {
    console.log(`✅ 已加载 ${Object.keys(cookies).length} 个 cookies`)
  }

  // 启动浏览器
  const browser: Browser = await chromium.launch({
    headless: false,
    channel: 'chromium',
  })

  const context = await browser.newContext()
  const page: Page = await context.newPage()

  // 设置 cookies
  const cookieDomains = getCookieDomains(platform)
  for (const [name, value] of Object.entries(cookies)) {
    for (const domain of cookieDomains) {
      try {
        await context.addCookies([{
          name,
          value,
          domain,
          path: '/',
        }])
        break
      } catch {
        // 忽略无效 cookie
      }
    }
  }

  // 抓包数据
  const requests: CapturedRequest[] = []
  let lastActivityTime = Date.now()

  // 拦截所有请求
  page.on('request', async (request: Request) => {
    const url = request.url()
    const headers = request.headers()
    const method = request.method()
    const contentType = headers['content-type'] || ''

    // 只记录 API 请求（放宽过滤条件）
    if (!url.includes('api') && !url.includes('bizapi') && !url.includes('.om.qq.com')) {
      return
    }

    const captured: CapturedRequest = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      method,
      url,
      headers,
      matched: isUploadRequest(url, headers),
    }

    // 获取 post data
    try {
      const postData = await request.postData()
      if (postData) {
        captured.postData = postData
      }
    } catch {
      // ignore
    }

    requests.push(captured)
    lastActivityTime = Date.now()

    // 打印关键请求
    if (captured.matched || url.includes('upload')) {
      console.log(`\n📤 [${method}] ${url}`)
      if (contentType) {
        console.log(`   Content-Type: ${contentType.substring(0, 50)}...`)
      }
    }
  })

  // 拦截响应
  page.on('response', async (response) => {
    const url = response.url()
    const status = response.status()

    // 找到对应的请求并更新
    const captured = requests.find(r => r.url === url)
    if (captured) {
      captured.responseStatus = status

      // 尝试获取响应体
      try {
        const body = await response.text()
        if (body && body.length < 10000) {
          captured.responseBody = body
        }
      } catch {
        // ignore
      }

      // 打印上传响应
      if (captured.matched) {
        console.log(`   ← ${status} ${captured.responseBody?.substring(0, 100) || ''}...`)
      }
    }
  })

  // 监听浏览器关闭
  const browserClosedPromise = new Promise<void>((resolve) => {
    browser.on('disconnected', () => {
      console.log('\n🔌 浏览器已关闭，停止抓包...')
      resolve()
    })
  })

  // 超时 Promise
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.log(`\n⏱️  超时 (${timeoutMs / 1000}秒)，停止抓包...`)
      resolve()
    }, timeoutMs)
  })

  // 无操作超时检测
  const activityCheckPromise = new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      if (Date.now() - lastActivityTime > timeoutMs) {
        console.log('\n⏱️  长时间无活动，停止抓包...')
        clearInterval(checkInterval)
        resolve()
      }
    }, 5000)
  })

  // 打开编辑器
  console.log(`\n🌐 打开编辑器: ${config.editorUrl}`)
  await page.goto(config.editorUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  console.log('✅ 编辑器已加载')
  console.log('\n📋 操作提示:')
  console.log('   1. 在编辑器中找到上传图片功能')
  console.log('   2. 上传一张图片')
  console.log('   3. 完成后关闭浏览器')
  console.log('\n🕐 开始抓包，等待操作...\n')

  // 等待浏览器关闭或超时
  await Promise.race([
    browserClosedPromise,
    Promise.race([timeoutPromise, activityCheckPromise]),
  ])

  // 关闭浏览器
  try {
    await browser.close()
  } catch {
    // ignore
  }

  // 分析抓包数据
  const uploadEndpoints = [...new Set(
    requests.filter(r => r.matched).map(r => {
      try {
        return new URL(r.url).pathname
      } catch {
        return r.url
      }
    })
  )]

  const captureData: CaptureData = {
    platform,
    captureTime: new Date().toISOString(),
    timeout: timeoutMs,
    editorUrl: config.editorUrl,
    uploadApiUrl: uploadEndpoints[0],
    requests: requests.map(r => ({
      ...r,
      responseBody: r.responseBody?.substring(0, 500), // 截断响应体
    })),
    summary: {
      totalRequests: requests.length,
      matchedRequests: requests.filter(r => r.matched).length,
      uploadEndpoints,
    },
  }

  return captureData
}

async function main() {
  const args = process.argv.slice(2)
  const platform = args[0] || 'csdn'
  const timeout = parseInt(args[1] || '60', 10) * 1000

  if (!PLATFORM_CONFIGS[platform]) {
    console.error(`不支持的平台: ${platform}`)
    console.error(`支持的平台: ${Object.keys(PLATFORM_CONFIGS).join(', ')}`)
    process.exit(1)
  }

  const data = await capture(platform, timeout)

  if (!data) {
    process.exit(1)
  }

  // 保存到临时文件
  const timestamp = Date.now()
  const filename = `temp/capture-${platform}-${timestamp}.json`
  const filepath = path.resolve(process.cwd(), filename)

  // 确保 temp 目录存在
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8')

  console.log(`
========================================
  抓包完成
========================================
文件: ${filepath}

📊 统计:
   总请求数: ${data.summary.totalRequests}
   命中请求: ${data.summary.matchedRequests}
   上传端点: ${data.summary.uploadEndpoints.join(', ') || '无'}

========================================
`)

  if (data.summary.uploadEndpoints.length > 0) {
    console.log('🎯 检测到上传请求！')
    console.log('   把这个文件路径告诉 AI，让它分析签名格式')
  } else {
    console.log('⚠️  未检测到上传请求')
    console.log('   可能原因:')
    console.log('   1. 没有执行上传操作')
    console.log('   2. 上传功能需要先登录')
    console.log('   3. 平台上传 API 不在拦截范围内')
  }

  console.log('\n运行 AI 分析:')
  console.log(`   帮我分析 ${platform} 的抓包数据: ${filepath}`)
}

// 仅在直接运行时执行（不在被 import 时执行）
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch(console.error)
}
