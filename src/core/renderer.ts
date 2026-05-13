/**
 * 渲染管道 - 将 Markdown 渲染为平台可用的 HTML
 */
import { parseMarkdown, type ParsedArticle } from './parser.js'
import { processMath } from './mathjax.js'
import { inlineStyles } from './styler.js'
import { loadThemeCss, DEFAULT_CSS } from './theme.js'
import { generateCover } from '../tools/cover-generator.js'
import { fetchCoverByTitle, cleanupCoverFile } from '../tools/cover-fetcher.js'

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
    coverMode = 'auto',
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
