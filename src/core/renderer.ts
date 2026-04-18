/**
 * 渲染管道 - 将 Markdown 渲染为平台可用的 HTML
 */
import { parseMarkdown, type ParsedArticle } from './parser.js'
import { processMath } from './mathjax.js'
import { inlineStyles } from './styler.js'
import { loadThemeCss, DEFAULT_CSS } from './theme.js'
import { generateCover } from '../tools/cover-generator.js'
import { cleanupCoverFile } from '../tools/cover-fetcher.js'

export interface RenderOptions {
  theme?: string
  customCss?: string
  highlight?: string
  macStyle?: boolean
  footnote?: boolean
  /** 是否在无封面时自动根据标题获取封面图 */
  autoCover?: boolean
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
 * 渲染 Markdown 文件为平台 HTML
 */
export async function renderMarkdown(
  content: string,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const {
    theme = 'default',
    customCss,
    macStyle = true,
    autoCover = false,
  } = options

  // 1. 解析 front-matter + Markdown → HTML
  const parsed = parseMarkdown(content)

  // 2. 处理 LaTeX 公式（$...$ 和 $$...$$）
  let html = processMath(parsed.html)

  // 3. 加载主题 CSS
  const themeCss = customCss ?? (await loadThemeCss(theme)) ?? DEFAULT_CSS

  // 4. CSS 内联
  html = inlineStyles(html, themeCss)

  // 5. 包裹 section 标签（微信公众号要求）
  html = `<section style="margin-left:6px;margin-right:6px;line-height:1.75em">${html}</section>`

  let autoCoverPath: string | undefined

  // 6. 自动生成封面图（当未指定封面图时）
  if (autoCover && !parsed.meta.cover && parsed.meta.title) {
    console.log(`[renderer] 未指定封面图，正在根据标题生成封面...`)
    const result = await generateCover(parsed.meta.title, parsed.meta.description || '')

    if (result.success && result.localPath) {
      autoCoverPath = result.localPath
      console.log(`[renderer] 自动封面图生成成功: ${result.localPath}`)
    } else {
      console.warn(`[renderer] 自动封面图生成失败: ${result.error}`)
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
