/**
 * render 命令 - 将 Markdown 渲染为 HTML
 */
import { readFile } from 'node:fs/promises'
import { renderMarkdown } from '../core/renderer.js'

interface RenderOptions {
  file?: string
  theme?: string
  customTheme?: string
  highlight?: string
  macStyle?: boolean
}

export async function runRender(options: RenderOptions): Promise<void> {
  try {
    let content: string

    if (options.file) {
      if (options.file.startsWith('http://') || options.file.startsWith('https://')) {
        const res = await fetch(options.file)
        if (!res.ok) throw new Error(`无法读取 URL: ${options.file}`)
        content = await res.text()
      } else {
        content = await readFile(options.file, 'utf-8')
      }
    } else {
      content = await readFile('/dev/stdin', 'utf-8').catch(() => {
        throw new Error('请提供 -f 选项指定文件')
      })
    }

    let customCss: string | undefined
    if (options.customTheme) {
      customCss = await readFile(options.customTheme, 'utf-8')
    }

    const result = await renderMarkdown(content, {
      theme: options.theme,
      customCss,
      macStyle: options.macStyle,
    })

    process.stdout.write(result.html)
  } catch (err) {
    console.error('[render]', (err as Error).message)
    process.exit(1)
  }
}
