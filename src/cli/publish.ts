/**
 * publish 命令 - 渲染并发布文章到平台
 */
import { readFile } from 'node:fs/promises'
import type { Command } from 'commander'
import { renderMarkdown } from '../core/renderer.js'
import { createNodeRuntime } from '../runtime/node-runtime.js'
import { initAdapterRegistry, getAdapter } from '../adapters/index.js'
import { ConfigStore } from '../config.js'

export async function runPublish(
  options: {
    file?: string
    platform?: string
    theme?: string
    appId?: string
    macStyle?: boolean
  },
  input?: string
): Promise<void> {
  try {
    // 1. 读取内容
    let content: string
    if (options.file) {
      if (options.file.startsWith('http://') || options.file.startsWith('https://')) {
        const res = await fetch(options.file)
        if (!res.ok) throw new Error(`无法读取 URL: ${options.file}`)
        content = await res.text()
      } else {
        content = await readFile(options.file, 'utf-8')
      }
    } else if (input) {
      content = input
    } else {
      throw new Error('请提供 -f 选项指定 Markdown 文件')
    }

    // 2. 渲染
    const result = await renderMarkdown(content, {
      theme: options.theme || 'default',
      macStyle: options.macStyle !== false,
    })

    // 3. 选择适配器
    const platformId = options.platform || 'weixin'

    // 初始化适配器注册表
    const runtime = createNodeRuntime()
    await initAdapterRegistry(runtime)

    const adapter = getAdapter(platformId)
    if (!adapter) {
      // 列出所有支持的平台
      const { adapterRegistry } = await import('../adapters/index.js')
      const allAdapters = Array.from(adapterRegistry.getAll().values())
      const supportedPlatforms = allAdapters.map(a => a.meta.id).sort().join(', ')
      throw new Error(`不支持的平台: ${platformId}。支持: ${supportedPlatforms}`)
    }

    // 注入 AppID 到运行时（如果提供了）
    if (options.appId) {
      process.env.WECHAT_APP_ID = options.appId
    }

    const syncResult = await adapter.publish({
      title: result.title,
      markdown: content,
      html: result.html,
      author: result.author,
      cover: result.cover,
      source_url: result.source_url,
    })

    // 4. 输出结果
    if (syncResult.success) {
      console.log(`✅ 发布成功！`)
      if (syncResult.postUrl) {
        console.log(`📝 草稿链接: ${syncResult.postUrl}`)
      }
      if (syncResult.postId) {
        console.log(`🆔 媒体 ID: ${syncResult.postId}`)
      }
    } else {
      console.error(`❌ 发布失败: ${syncResult.error}`)
      process.exit(1)
    }
  } catch (err) {
    console.error('[publish]', (err as Error).message)
    process.exit(1)
  }
}
