/**
 * 渲染管道 - 将 Markdown 渲染为平台可用的 HTML
 */
import { parseMarkdown, type ParsedArticle } from './parser.js'
import { processMath } from './mathjax.js'
import { inlineStyles } from './styler.js'
import { loadThemeCss, DEFAULT_CSS } from './theme.js'

export interface RenderOptions {
  theme?: string
  customCss?: string
  highlight?: string
  macStyle?: boolean
  footnote?: boolean
}

export interface RenderResult {
  title: string
  html: string
  author?: string
  cover?: string
  source_url?: string
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

  return {
    title: parsed.meta.title,
    html,
    author: parsed.meta.author,
    cover: parsed.meta.cover,
    source_url: parsed.meta.source_url,
  }
}
