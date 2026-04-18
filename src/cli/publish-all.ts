/**
 * publish-all 命令 - 一键发布到所有已登录平台
 */
import { Command } from 'commander'
import { initAdapterRegistry, getLoggedInPlatforms, publishToPlatforms } from '../adapters/index.js'
import { renderMarkdown } from '../core/renderer.js'
import type { SyncResult } from '../adapters/interface.js'

export async function runPublishAll(options: {
  file: string
  theme?: string
  highlight?: string
  macStyle?: boolean
}): Promise<void> {
  const { file, theme = 'default', highlight = 'solarized-light', macStyle = true } = options

  console.log('🔍 正在检查已登录的平台...\n')

  // 初始化适配器注册表
  await initAdapterRegistry({
    fetch: globalThis.fetch,
    getCookie: async () => '',
  } as never)

  // 获取已登录的平台
  const loggedInPlatforms = await getLoggedInPlatforms()

  if (loggedInPlatforms.length === 0) {
    console.log('❌ 没有任何平台已登录')
    console.log('\n请先登录平台:')
    console.log('  mpub login -p <平台名>')
    console.log('\n支持的平台: zhihu, juejin, csdn, weibo, bilibili, baijiahao, cnblogs, douban, eastmoney, imooc, oschina, segmentfault, sohu, woshipm, xueqiu')
    return
  }

  console.log(`✅ 找到 ${loggedInPlatforms.length} 个已登录的平台:`)
  for (const platform of loggedInPlatforms) {
    console.log(`  - ${platform.name} (${platform.id})`)
  }
  console.log()

  // 读取并渲染 Markdown
  let markdownContent: string
  try {
    if (file.startsWith('http://') || file.startsWith('https://')) {
      const res = await fetch(file)
      markdownContent = await res.text()
    } else {
      markdownContent = await import('node:fs/promises').then(fs => fs.readFile(file, 'utf-8'))
    }
  } catch (err) {
    console.error(`❌ 读取文件失败: ${(err as Error).message}`)
    return
  }

  // 提取 frontmatter
  const frontmatterMatch = markdownContent.match(/^---\n([\s\S]*?)\n---\n?/)
  let title = '无标题文章'
  let author = ''
  let cover = ''

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    const titleMatch = frontmatter.match(/title:\s*(.+)/)
    const authorMatch = frontmatter.match(/author:\s*(.+)/)
    const coverMatch = frontmatter.match(/cover:\s*(.+)/)

    if (titleMatch) title = titleMatch[1].trim()
    if (authorMatch) author = authorMatch[1].trim()
    if (coverMatch) cover = coverMatch[1].trim()

    markdownContent = markdownContent.slice(frontmatterMatch[0].length)
  }

  // 渲染 HTML
  const renderResult = await renderMarkdown(markdownContent, {
    theme,
    highlight,
    macStyle,
  })

  const article = {
    title: renderResult.title || title,
    markdown: markdownContent,
    html: renderResult.html,
    author: renderResult.author || author,
    cover: renderResult.cover || cover,
  }

  console.log(`📝 开始发布文章: "${title}"`)
  console.log(`   平台数量: ${loggedInPlatforms.length}`)
  console.log()

  // 发布到所有已登录平台
  const results: Array<{ platform: string; result: SyncResult }> = []

  for (const platform of loggedInPlatforms) {
    process.stdout.write(`⏳ ${platform.name}... `)
    const result = await publishToPlatforms([platform.id], article)
    results.push({ platform: platform.id, result: result[0] })

    if (result[0].success) {
      console.log(`✅ ${result[0].postUrl || result[0].postId}`)
    } else {
      console.log(`❌ ${result[0].error}`)
    }
  }

  console.log('\n========== 发布结果汇总 ==========\n')

  const successCount = results.filter(r => r.result.success).length
  const failCount = results.filter(r => !r.result.success).length

  console.log(`成功: ${successCount} | 失败: ${failCount}\n`)

  for (const { platform, result } of results) {
    const status = result.success ? '✅' : '❌'
    const info = result.success
      ? `${result.postUrl || result.postId}${result.draftOnly ? ' (草稿)' : ''}`
      : result.error
    console.log(`${status} ${platform}: ${info}`)
  }

  if (failCount > 0) {
    console.log('\n⚠️  部分平台发布失败，可能需要重新登录')
  }
}
