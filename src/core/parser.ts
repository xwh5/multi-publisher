/**
 * Markdown 解析 + front-matter 提取
 */
import fm from 'front-matter'
import { marked, type TokenizerExtension, type RendererExtension } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'

export interface ArticleMeta {
  title: string
  author?: string
  cover?: string
  source_url?: string
  description?: string
  tags?: string[]
}

export interface ParsedArticle {
  meta: ArticleMeta
  body: string       // 去除 front-matter 的原始 markdown
  html: string        // marked 渲染后的 HTML
}

/**
 * 创建 marked 实例（集成 highlight.js 代码高亮）
 */
function createMarked() {
  return marked.use(
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext'
        return hljs.highlight(code, { language }).value
      },
    }),
    {
      gfm: true,
      breaks: false,
    }
  )
}

const markedInstance = createMarked()

/**
 * 解析 Markdown 内容，返回 front-matter 元数据 + HTML
 */
export function parseMarkdown(content: string): ParsedArticle {
  const parsed = fm<ArticleMeta>(content)

  const html = markedInstance.parse(parsed.body)

  return {
    meta: {
      title: parsed.attributes.title || '无标题',
      author: parsed.attributes.author,
      cover: parsed.attributes.cover,
      source_url: parsed.attributes.source_url,
      description: parsed.attributes.description,
      tags: parsed.attributes.tags,
    },
    body: parsed.body,
    html: typeof html === 'string' ? html : '',
  }
}
