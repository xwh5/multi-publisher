/**
 * xhs-package 命令 - 把长文转成小红书发布包
 *
 * 只产出发布包（图集 + 短标题 + 短正文 + 标签），**不做投递**：
 * 小红书笔记发出去不能删除，发布必须走带查重与回查的闸门脚本。
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import fm from 'front-matter'
import sharp from 'sharp'
import type { ArticleMeta } from '../core/parser.js'

const TITLE_LIMIT = 20
const BODY_LIMIT = 1000
const BODY_FALLBACK = 600
const TARGET_RATIO = 3 / 4

interface XhsMeta {
  title?: string
  body?: string
  tags?: string[]
  images?: string[]
}

interface FullMeta extends ArticleMeta {
  xhs?: XhsMeta
}

export interface XhsPackageOptions {
  file?: string
  out?: string
  image?: string[]
  cover?: string
}

export interface PackageMeta {
  title: string
  body: string
  tags: string[]
  images: string[]
  cover?: string
  source: string
  generatedAt: string
  limits: { title: number; body: number }
  warnings: string[]
}

function charLength(text: string): number {
  return [...text].length
}

/** Markdown → 纯文本（小红书正文不吃 HTML 排版） */
function toPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 截断到上限，尽量断在句末 */
function truncate(text: string, limit: number): string {
  const chars = [...text]
  if (chars.length <= limit) return text
  const slice = chars.slice(0, limit).join('')
  const cut = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('\n'), slice.lastIndexOf('；'))
  return cut > limit * 0.6 ? slice.slice(0, cut + 1) : slice
}

function slugOf(file: string): string {
  return basename(file).replace(/\.[^.]+$/, '').replace(/[^\w一-龥-]+/g, '-')
}

async function copyImage(src: string, imgDir: string, warnings: string[]): Promise<string | undefined> {
  const abs = resolve(src)
  if (!existsSync(abs)) {
    warnings.push(`图片不存在，已跳过：${src}`)
    return undefined
  }
  const name = basename(abs)
  const dest = join(imgDir, name)
  if (!existsSync(dest)) await copyFile(abs, dest)
  try {
    const meta = await sharp(abs).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    if (w > 0 && h > 0) {
      const ratio = w / h
      if (Math.abs(ratio - TARGET_RATIO) > 0.02) {
        warnings.push(`图片比例 ${w}×${h} 不是 3:4（小红书封面建议 1080×1440）`)
      }
    }
  } catch {
    warnings.push(`无法读取图片尺寸：${src}`)
  }
  return name
}

export async function runXhsPackage(options: XhsPackageOptions): Promise<void> {
  try {
    if (!options.file) throw new Error('请提供 -f 选项指定 Markdown 文件')
    const raw = await readFile(options.file, 'utf-8')
    const parsed = fm<FullMeta>(raw)
    const warnings: string[] = []

    const xhs = parsed.attributes.xhs ?? {}
    const baseDir = dirname(resolve(options.file))

    // 标题：xhs.title → front-matter title；超 20 字截断
    const rawTitle = (xhs.title ?? parsed.attributes.title ?? '').trim()
    if (!rawTitle) throw new Error('缺少标题：请在 front-matter 写 title 或 xhs.title')
    let title = rawTitle
    if (charLength(title) > TITLE_LIMIT) {
      warnings.push(`标题 ${charLength(title)} 字 > 小红书上限 ${TITLE_LIMIT}，已截断`)
      title = truncate(title, TITLE_LIMIT)
    }

    // 正文来源：xhs.body → 够长的 summary/description → 长文正文（截断）
    const summary = parsed.attributes.summary ?? parsed.attributes.description
    let body = ''
    let bodyFrom = ''
    if (xhs.body && xhs.body.trim()) {
      body = xhs.body.trim()
      bodyFrom = 'xhs.body'
    } else if (summary && summary.trim().length >= BODY_FALLBACK) {
      body = summary.trim()
      bodyFrom = 'front-matter summary'
    } else {
      body = toPlainText(parsed.body)
      bodyFrom = '长文正文（兜底）'
      if (summary && summary.trim()) {
        warnings.push(`summary 只有 ${summary.trim().length} 字（< ${BODY_FALLBACK}），已改用长文正文兜底；要精确控制小红书文案请写 xhs.body`)
      }
    }
    if (!body) throw new Error('正文为空：请在 front-matter 写 xhs.body 或 summary')
    if (body.length > BODY_LIMIT) {
      warnings.push(`正文 ${body.length} 字 > 小红书上限 ${BODY_LIMIT}，已截断`)
      body = truncate(body, BODY_LIMIT)
    } else if (bodyFrom !== 'xhs.body' && body.length < BODY_FALLBACK) {
      warnings.push(`正文只有 ${body.length} 字，建议在 xhs.body 里手写短文案`)
    }

    // 标签
    const tags = (xhs.tags ?? parsed.attributes.tags ?? [])
      .map(t => String(t).trim())
      .filter(Boolean)
    if (tags.length === 0) warnings.push('没有标签：请在 front-matter 写 tags 或 xhs.tags')

    // 输出目录
    const slug = slugOf(options.file)
    const outDir = options.out ? resolve(options.out) : join(process.cwd(), 'dist', 'xhs', slug)
    const imgDir = join(outDir, 'images')
    await mkdir(imgDir, { recursive: true })

    // 图集
    const imageList = xhs.images ?? options.image ?? []
    const images: string[] = []
    for (const src of imageList) {
      const resolved = resolve(baseDir, src)
      const name = await copyImage(resolved, imgDir, warnings)
      if (name) images.push(name)
    }

    // 封面
    let cover: string | undefined
    const coverSrc = options.cover ?? parsed.attributes.cover
    if (coverSrc) {
      const name = await copyImage(resolve(baseDir, coverSrc), imgDir, warnings)
      if (name) {
        cover = name
        if (!images.includes(name)) images.unshift(name)
      }
    }
    if (images.length === 0) warnings.push('没有图片：小红书笔记至少要 1 张图（用 -i 指定）')

    // 写包
    const frontMatter = ['---', `title: ${JSON.stringify(title)}`, `tags: [${tags.join(', ')}]`, '---', ''].join('\n')
    await writeFile(join(outDir, 'post.md'), `${frontMatter}${body}\n`, 'utf-8')

    const meta: PackageMeta = {
      title,
      body,
      tags,
      images,
      cover,
      source: resolve(options.file),
      generatedAt: new Date().toISOString(),
      limits: { title: TITLE_LIMIT, body: BODY_LIMIT },
      warnings,
    }
    await writeFile(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf-8')

    // 输出摘要与投递命令
    const lines: string[] = []
    lines.push(`[xhs-package] ${outDir}`)
    lines.push(`  标题(${charLength(title)}/${TITLE_LIMIT})：${title}`)
    lines.push(`  正文(${body.length}/${BODY_LIMIT}，来源：${bodyFrom})｜标签 ${tags.length} 个：${tags.join('、') || '（无）'}`)
    lines.push(`  图集 ${images.length} 张：${images.join('、') || '（无）'}`)
    for (const w of warnings) lines.push(`  ⚠️ ${w}`)
    const cmd = [
      'bash knowledge/reference/xhs-publish.sh',
      `--title ${JSON.stringify(title)}`,
      `--body ${join(outDir, 'post.md')}`,
      ...images.map(i => `--image ${join(imgDir, i)}`),
      ...tags.map(t => `--tag ${JSON.stringify(t)}`),
    ].join(' ')
    lines.push('')
    lines.push('投递命令（发布前会自动查重 + 过 AI 腔闸门 + 发布后回查）：')
    lines.push(`  ${cmd}`)
    process.stdout.write(`${lines.join('\n')}\n`)
  } catch (err) {
    console.error('[xhs-package]', (err as Error).message)
    process.exit(1)
  }
}
