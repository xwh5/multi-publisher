/**
 * capture 命令入口
 */
import { capture } from '../tools/capture.js'
import fs from 'fs/promises'
import path from 'path'

interface CaptureOptions {
  platform?: string
  timeout?: string
}

export async function runCapture(options: CaptureOptions) {
  const platform = options.platform || 'csdn'
  const timeoutSeconds = parseInt(options.timeout || '60', 10)
  const timeoutMs = timeoutSeconds * 1000

  const data = await capture(platform, timeoutMs)

  if (!data) {
    console.error('抓包失败')
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
