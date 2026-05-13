/**
 * 渲染管道 - 将 Markdown 渲染为平台可用的 HTML
 */
import { parseMarkdown, type ParsedArticle } from './parser.js'
import { processMath } from './mathjax.js'
import { inlineStyles } from './styler.js'
import { loadThemeCss, DEFAULT_CSS } from './theme.js'
import { generateCover } from '../tools/cover-generator.js'
import { fetchCoverByTitle, cleanupCoverFile } from '../tools/cover-fetcher.js'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'

export type CoverMode = 'sharp' | 'network' | 'auto'

export interface RenderOptions {
  theme?: string
  customCss?: string
  highlight?: string
  macStyle?: boolean
  footnote?: boolean
  /** 是否在无封面时自动根据标题获取封面图 */
  autoCover?: boolean
  /** 封面模式: sharp(SVG生成)|network(网络抓取)|auto(自动选择) */
  coverMode?: CoverMode
}

export interface RenderResult {
  title: string
  html: string
  author?: string
  cover?: string
  source_url?: string
  /** 自动获取的封面图本地路径（需在使用后清理） */
  autoCoverPath?: string
}

/**
 * 处理 Mermaid 代码块，将它们转换为图片
 * 各平台适配器可调用此函数
 */
export async function processMermaid(html: string, outputDir: string): Promise<{ html: string; tempFiles: string[] }> {
  const mermaidBlockRegex = /<pre[^>]*><code[^>]*class="hljs language-mermaid"[^>]*>([\s\S]*?)<\/code><\/pre>/gi
  const matches = [...html.matchAll(mermaidBlockRegex)]
  const tempFiles: string[] = []

  if (matches.length === 0) return { html, tempFiles }

  console.log(`[renderer] 发现 ${matches.length} 个 mermaid 代码块，开始转换为图片...`)

  for (const match of matches) {
    let mermaidCode = match[1].trim()
    // 解码 HTML 实体
    mermaidCode = mermaidCode
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
    const tmpMmd = path.join(os.tmpdir(), `mermaid-${Date.now()}-${Math.random()}.mmd`)
    const outputPng = path.join(outputDir, `mermaid-${Date.now()}-${Math.random()}.png`)

    try {
      // 写入临时 mmd 文件
      await fs.writeFile(tmpMmd, mermaidCode, 'utf8')
      tempFiles.push(tmpMmd)

      // 调用 mmdc 渲染
      execSync(`mmdc -i "${tmpMmd}" -o "${outputPng}" -b white`, {
        stdio: 'pipe',
        timeout: 60000
      })

      // 验证图片生成
      await fs.access(outputPng)
      tempFiles.push(outputPng)

      // 替换 mermaid 代码块为图片
      const imageTag = `<img src="${outputPng.replace(/\\/g, '/')}" />`
      html = html.replace(match[0], imageTag)
      console.log(`[renderer] Mermaid 图片生成成功: ${outputPng}`)
    } catch (err) {
      console.warn(`[renderer] Mermaid 渲染失败: ${(err as Error).message}，保留原代码块`)
      await fs.unlink(tmpMmd).catch(() => {})
    }
  }

  return { html, tempFiles }
}

export async function renderMarkdown(
  content: string,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const {
    theme = 'default',
    customCss,
    macStyle = true,
    autoCover = false,
    coverMode = 'auto',
  } = options

  // 1. 解析 front-matter + Markdown → HTML
  const parsed = parseMarkdown(content)

  // 2. 处理 LaTeX 公式（$...$ 和 $$...$$）
  let html = processMath(parsed.html)

  // 注意：Mermaid 处理移到各平台适配器的 processMermaid 钩子
  // 各 adapter 自己决定是否转换 mermaid 代码块

  // 3. 加载主题 CSS
  const themeCss = customCss ?? (await loadThemeCss(theme)) ?? DEFAULT_CSS

  // 4. CSS 内联
  html = inlineStyles(html, themeCss)

  // 5. 包裹 section 标签（微信公众号要求）
  html = `<section style="margin-left:6px;margin-right:6px;line-height:1.75em">${html}</section>`

  // 5.5 校验 title
  if (!parsed.meta.title || parsed.meta.title === '无标题') {
    console.warn(`[renderer] ⚠️ 标题为空或为默认值，将尝试从正文提取。原始 content 前200字符: ${content.substring(0, 200)}`)
  } else {
    console.log(`[renderer] ✅ 标题: "${parsed.meta.title}"`)
  }

  let autoCoverPath: string | undefined

  // 6. 自动生成封面图
  // 条件：有 --auto-cover 且（front-matter 无封面 或 coverMode=sharp/network 强制覆盖）
  const shouldGenerateCover = autoCover && (
    !parsed.meta.cover ||
    coverMode === 'sharp' ||
    coverMode === 'network'
  )

  if (shouldGenerateCover && parsed.meta.title) {
    if (coverMode === 'sharp') {
      // sharp 模式：强制用 SVG 生成封面
      console.log(`[renderer] cover-mode=sharp，强制用 SVG 生成封面...`)
      const result = await generateCover(parsed.meta.title, parsed.meta.description || '')
      if (result.success && result.localPath) {
        autoCoverPath = result.localPath
        console.log(`[renderer] SVG 封面生成成功: ${result.localPath}`)
      } else {
        console.warn(`[renderer] SVG 封面生成失败: ${result.error}`)
      }
    } else if (coverMode === 'network' || (coverMode === 'auto' && !parsed.meta.cover)) {
      // network 模式 或 auto 模式（无 front-matter 封面）：从网络抓取
      console.log(`[renderer] cover-mode=${coverMode}，从网络抓取封面...`)
      const result = await fetchCoverByTitle(parsed.meta.title)
      if (result.success && result.localPath) {
        autoCoverPath = result.localPath
        console.log(`[renderer] 网络封面获取成功: ${result.localPath}`)
      } else {
        console.warn(`[renderer] 网络封面获取失败: ${result.error}`)
      }
    }
  }

  return {
    title: parsed.meta.title,
    html,
    author: parsed.meta.author,
    cover: parsed.meta.cover,
    source_url: parsed.meta.source_url,
    autoCoverPath,
  }
}
