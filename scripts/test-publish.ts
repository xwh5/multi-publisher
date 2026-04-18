/**
 * 全流程发布测试脚本
 *
 * 用法：
 *   npx tsx scripts/test-publish.ts                    # 仅检查认证
 *   npx tsx scripts/test-publish.ts --publish         # 检查认证 + 实际发布测试
 *   npx tsx scripts/test-publish.ts --publish -p weixin,zhihu  # 只测指定平台
 *
 * 测试说明：
 *   - 微信公众号：使用占位封面图 fallback（无图片时自动用 httpbin 图）
 *   - 头条号：Playwright 浏览器登录（需用户手动操作）
 *   - 知乎/掘金/CSDN：Cookie 认证
 */

import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 测试配置
const TEST_ARTICLE = path.join(__dirname, '../articles/20260418-from-idea-to-npm-one-click-multi-platform-publishing.md')
const TEST_THEME = 'default'

const PLATFORMS = {
  weixin: { name: '微信公众号', color: '\x1b[36m' },
  zhihu: { name: '知乎', color: '\x1b[35m' },
  juejin: { name: '掘金', color: '\x1b[33m' },
  csdn: { name: 'CSDN', color: '\x1b[34m' },
  toutiao: { name: '头条号', color: '\x1b[32m' },
}

const RESET = '\x1b[0m'

interface TestResult {
  platform: string
  name: string
  success: boolean
  duration: number
  error?: string
  postUrl?: string
}

function parseFrontMatter(content: string): { content: string; metadata: Record<string, unknown> } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { content, metadata: {} }

  const [, yamlStr, body] = match
  const metadata: Record<string, unknown> = {}

  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value: unknown = line.slice(colonIdx + 1).trim()

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim())
    }
    if (value === 'true') value = true
    if (value === 'false') value = false

    metadata[key] = value
  }

  return { content: body, metadata }
}

async function main() {
  const program = new Command()

  program
    .name('test-publish')
    .description('全流程发布测试脚本')
    .option('-f, --file <path>', '文章文件路径', TEST_ARTICLE)
    .option('-p, --platforms <platforms>', '平台列表（逗号分隔）', 'weixin,zhihu,juejin,csdn,toutiao')
    .option('-t, --theme <theme>', '渲染主题', TEST_THEME)
    .option('--publish', '实际执行发布（默认只检查认证）')

  program.parse(process.argv)
  const opts = program.opts()

  const platforms = opts.platforms.split(',').map((p: string) => p.trim())
  const filePath = opts.file

  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文章文件不存在: ${filePath}`)
    process.exit(1)
  }

  console.log(`\n📄 测试文章: ${path.basename(filePath)}`)
  console.log(`🎨 主题: ${opts.theme}`)
  console.log(`\n${'='.repeat(60)}\n`)

  // 初始化运行时和适配器注册表
  console.log('🔧 初始化运行时...')
  const { createNodeRuntime } = await import('../dist/runtime/node-runtime.js')
  const { initAdapterRegistry, getAdapter } = await import('../dist/adapters/index.js')
  const runtime = createNodeRuntime()
  await initAdapterRegistry(runtime)
  console.log('   初始化完成\n')

  // 认证检查
  console.log('🔐 认证状态检查\n')
  const authResults: Array<{ platform: string; ok: boolean; message: string }> = []

  for (const platform of platforms) {
    const info = PLATFORMS[platform as keyof typeof PLATFORMS]
    if (!info) {
      console.log(`  ${platform}: ❌ 不支持的平台`)
      authResults.push({ platform, ok: false, message: '不支持的平台' })
      continue
    }

    try {
      const adapter = getAdapter(platform)
      if (!adapter) {
        console.log(`  ${info.name}: ❌ 不支持的平台`)
        authResults.push({ platform, ok: false, message: '不支持的平台' })
        continue
      }

      const auth = await adapter.checkAuth()
      const icon = auth.isAuthenticated ? '✅' : '❌'
      const msg = auth.isAuthenticated ? '已登录' : (auth.error || '未登录')
      console.log(`  ${info.name} (${platform}): ${icon} ${msg}`)
      authResults.push({ platform, ok: auth.isAuthenticated, message: msg })
    } catch (err) {
      console.log(`  ${info.name} (${platform}): ❌ ${(err as Error).message}`)
      authResults.push({ platform, ok: false, message: (err as Error).message })
    }
  }

  const allAuthOk = authResults.every(r => r.ok)
  console.log(`\n${'─'.repeat(60)}`)

  if (!allAuthOk) {
    console.log('\n⚠️  部分平台未认证，跳过发布测试')
    console.log('   请先配置凭据：')
    console.log('   - 微信公众号: mpub credential --app-id <id> --app-secret <secret>')
    console.log('   - 其他平台:   mpub cookie --platform <platform> --set\n')
  }

  if (!opts.publish) {
    if (!allAuthOk) process.exit(1)
    console.log('✅ 认证检查完成\n')
    return
  }

  if (!allAuthOk) {
    console.log('❌ 认证检查失败，无法执行发布测试\n')
    process.exit(1)
  }

  // 读取文章
  const rawContent = fs.readFileSync(filePath, 'utf-8')
  const { content: bodyContent, metadata } = parseFrontMatter(rawContent)

  // 渲染 Markdown → HTML（与 mpub publish 流程一致）
  const { renderMarkdown } = await import('../dist/core/renderer.js')
  const renderResult = await renderMarkdown(bodyContent, {
    theme: opts.theme || 'default',
    macStyle: true,
  })

  const article = {
    title: metadata.title as string || 'Test Article',
    author: metadata.author as string || 'Test Author',
    markdown: bodyContent,         // CSDN 等平台需要原始 markdown
    html: renderResult.html,      // 渲染后的 HTML
    cover: (metadata.cover as string) || '',
    source_url: (metadata.source_url as string) || '',
  }

  console.log('\n🚀 开始发布测试\n')

  const results: TestResult[] = []

  for (const platform of platforms) {
    const info = PLATFORMS[platform as keyof typeof PLATFORMS]
    if (!info) continue

    const start = Date.now()
    process.stdout.write(`  ${info.name}: 等待中... `)

    try {
      const adapter = getAdapter(platform)
      if (!adapter) throw new Error('不支持的平台')

      const result = await adapter.publish(article)
      const duration = Date.now() - start
      results.push({
        platform,
        name: info.name,
        success: result.success,
        duration,
        error: result.error,
        postUrl: result.postUrl,
      })

      const icon = result.success ? '✅' : '❌'
      console.log(`${icon} ${duration}ms`)
      if (result.error) console.log(`         错误: ${result.error}`)
    } catch (err) {
      const duration = Date.now() - start
      const errorMsg = (err as Error).message
      results.push({
        platform,
        name: info.name,
        success: false,
        duration,
        error: errorMsg,
      })
      console.log(`❌ ${duration}ms`)
      console.log(`         错误: ${errorMsg}`)
    }
  }

  // 汇总
  console.log(`\n${'─'.repeat(60)}`)
  console.log('\n📊 测试结果汇总\n')

  for (const r of results) {
    const icon = r.success ? '✅' : '❌'
    const color = r.success ? '\x1b[32m' : '\x1b[31m'
    console.log(`  ${color}${icon}${RESET} ${r.name}: ${r.success ? '成功' : '失败'} (${r.duration}ms)`)
    if (r.postUrl) console.log(`         ${r.postUrl}`)
    if (r.error) console.log(`         ${r.error}`)
  }

  const passed = results.filter(r => r.success).length
  console.log(`\n  通过: ${passed}/${results.length}\n`)

  if (passed < results.length) process.exit(1)
}

main().catch(err => {
  console.error('\n❌ 测试脚本错误:', err.message)
  process.exit(1)
})
