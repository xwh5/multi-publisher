/**
 * Markdown 解析 + front-matter 提取
 */
import fm from 'front-matter'
import { marked, type Tokens } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'

/** 卡片容器类型（:::tip / :::warning / :::note） */
interface CalloutToken extends Tokens.Generic {
  type: 'callout'
  kind: 'tip' | 'warning' | 'note'
  title: string
  text: string
}

/**
 * 创建 marked 实例（集成 highlight.js 代码高亮）
 */
function createMarked() {
  const instance = marked.use(
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

  // 卡片容器扩展：:::tip 标题 / :::warning / :::note → callout 区块
  // 正文用带主题色的卡片展示重点、警示、说明
  instance.use({
    extensions: [
      {
        name: 'callout',
        level: 'block' as const,
        start(src: string): number | undefined {
          return src.match(/^:::/)?.index
        },
        tokenizer(src: string): CalloutToken | undefined {
          const match = /^:::(tip|warning|note)[ \t]*([^\n]*)\n([\s\S]*?)\n:::\s*/.exec(src)
          if (!match) return undefined
          return {
            type: 'callout',
            raw: match[0],
            kind: match[1] as CalloutToken['kind'],
            title: match[2].trim(),
            text: match[3],
            tokens: [],
          }
        },
        renderer(token: Tokens.Generic): string {
          const ct = token as CalloutToken
          // 递归渲染卡片内部 Markdown
          const inner = instance.parse(ct.text)
          const titleHtml = ct.title
            ? `<p style="font-weight:bold;color:#b45309;margin:0 0 0.4em 0">${ct.title}</p>`
            : ''
          return `<section class="callout callout-${ct.kind}">${titleHtml}${inner}</section>`
        },
      },
    ],
  })

  return instance
}

export interface ArticleMeta {
  title: string
  author?: string
  cover?: string
  source_url?: string
  description?: string
  /** 微信摘要（与 description 同义，mpub 规范用 summary） */
  summary?: string
  tags?: string[]
}

export interface ParsedArticle {
  meta: ArticleMeta
  body: string       // 去除 front-matter 的原始 markdown
  html: string        // marked 渲染后的 HTML
}

/**
 * 创建 marked 实例（集成 highlight.js 代码高亮 + 卡片容器扩展）
 */
const markedInstance = createMarked()

/**
 * 解析 Markdown 内容，返回 front-matter 元数据 + HTML
 */
export function parseMarkdown(content: string): ParsedArticle {
  const parsed = fm<ArticleMeta>(content)

  const html = markedInstance.parse(parsed.body)

  // Fallback title extraction: try to get first # heading if front-matter title is missing
  let title = parsed.attributes.title
  if (!title) {
    const headingMatch = parsed.body.match(/^#\s+(.+)/m)
    if (headingMatch) {
      title = headingMatch[1].trim()
    }
  }

  return {
    meta: {
      title: title || '无标题',
      author: parsed.attributes.author,
      cover: parsed.attributes.cover,
      source_url: parsed.attributes.source_url,
      description: parsed.attributes.description,
      summary: parsed.attributes.summary || parsed.attributes.description,
      tags: parsed.attributes.tags,
    },
    body: parsed.body,
    html: typeof html === 'string' ? html : '',
  }
}
