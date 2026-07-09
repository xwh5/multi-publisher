/**
 * 主题加载与管理
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 获取 themes 目录路径（dist 同级 themes/）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const THEMES_DIR = path.resolve(__dirname, '../../themes')

export interface ThemeInfo {
  id: string
  name: string
  description?: string
  isBuiltin: boolean
}

// 默认微信公众号主题 CSS（导出让 renderer.ts 也能用）
// 排版规范依据微信公众号编辑器：正文 15px / 行高 1.75、浅灰代码块、
// 浅色左边框引用、图片圆角居中、表格细边框、微信蓝链接。
export const DEFAULT_CSS = `
p {
  color: rgb(51, 51, 51);
  font-size: 15px;
  line-height: 1.75em;
  margin: 0 0 1em 0;
  word-wrap: break-word;
  letter-spacing: 0.5px;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
  color: #2c3e50;
  margin: 1.2em 0 0.6em 0;
}
h1 { font-size: 1.4em; line-height: 1.4em; border-bottom: 1px solid #e8e8e8; padding-bottom: 0.3em; }
h2 { font-size: 1.2em; border-left: 4px solid #07a35a; padding-left: 0.5em; }
h3 { font-size: 1.05em; }
h4, h5, h6 { font-size: 1em; }
ul, ol { margin: 0 0 1em 0; padding-left: 1.8em; }
li { margin: 0.3em 0; line-height: 1.7em; }
li p { margin: 0; }
pre {
  background-color: #f6f8fa;
  border: 1px solid #eaecef;
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
  font-size: 13.5px;
  line-height: 1.6;
  margin: 1em 0;
  color: #24292e;
}
code {
  background-color: rgba(175, 184, 193, 0.2);
  border-radius: 3px;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
pre code { background: none; padding: 0; border: none; font-size: 13.5px; }
blockquote {
  border-left: 4px solid #07a35a;
  background-color: #f6fbf8;
  padding: 0.8em 1em;
  margin: 1em 0;
  color: #555;
  border-radius: 0 4px 4px 0;
}
hr { border: none; border-top: 1px solid #e8e8e8; margin: 1.5em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bold; color: #1a1a1a; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14px; }
table th, table td { border: 1px solid #e8e8e8; padding: 8px 12px; }
table th { background-color: #f6f8fa; font-weight: bold; color: #2c3e50; }
table tr:nth-child(even) { background-color: #fafafa; }
a { color: #576b95; text-decoration: none; border-bottom: 1px solid rgba(87, 107, 149, 0.3); }
`

// 内置主题
const BUILTIN_THEMES: Record<string, { name: string; description: string; css: string }> = {
  default: {
    name: 'Default',
    description: '默认简洁主题，适合大多数文章',
    css: DEFAULT_CSS,
  },
  wechat: {
    name: 'Wechat',
    description: '微信风格，仿微信官方文章排版（白底、微信蓝链接、浅灰代码块）',
    css: `
p {
  color: rgb(62, 62, 62);
  font-size: 15px;
  line-height: 1.75em;
  margin: 0 0 1em 0;
  word-wrap: break-word;
  letter-spacing: 0.5px;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
  color: #3f3f3f;
  margin: 1.4em 0 0.6em 0;
}
h1 { font-size: 1.4em; line-height: 1.4em; border-bottom: 1px solid #e8e8e8; padding-bottom: 0.3em; text-align: center; }
h2 { font-size: 1.2em; border-left: 4px solid #07a35a; padding-left: 0.5em; }
h3 { font-size: 1.05em; }
h4, h5, h6 { font-size: 1em; }
ul, ol { margin: 0 0 1em 0; padding-left: 1.8em; }
li { margin: 0.35em 0; line-height: 1.7em; }
li p { margin: 0; }
pre {
  background-color: #f6f8fa;
  border: 1px solid #eaecef;
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
  font-size: 13.5px;
  line-height: 1.6;
  margin: 1em 0;
  color: #24292e;
}
code {
  background-color: rgba(175, 184, 193, 0.2);
  border-radius: 3px;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
pre code { background: none; padding: 0; border: none; font-size: 13.5px; }
blockquote {
  border-left: 3px solid #c8a96e;
  background-color: #faf9f7;
  padding: 0.8em 1em;
  margin: 1em 0;
  color: #666;
  border-radius: 0 4px 4px 0;
}
hr { border: none; border-top: 1px solid #e8e8e8; margin: 1.5em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bold; color: #1a1a1a; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14px; }
table th, table td { border: 1px solid #e8e8e8; padding: 8px 12px; }
table th { background-color: #f8f8f8; font-weight: bold; color: #3f3f3f; }
table tr:nth-child(even) { background-color: #fafafa; }
a { color: #576b95; border-bottom: 1px solid rgba(87, 107, 149, 0.3); text-decoration: none; }
`,
  },
  modern: {
    name: 'Modern',
    description: '现代风格，深色代码块清晰层次，适合技术/编程类（知乎、网页友好）',
    css: `
p { color: rgb(45, 45, 45); font-size: 15.5px; line-height: 1.85em; margin: 0 0 1.3em 0; }
h1, h2, h3, h4 { font-weight: 700; line-height: 1.35em; color: #1a1a1a; }
h1 { font-size: 1.45em; border-bottom: 2px solid #4a90d9; padding-bottom: 0.25em; }
h2 { font-size: 1.2em; border-left: 4px solid #4a90d9; padding-left: 0.5em; }
h3 { font-size: 1.05em; }
h4 { font-size: 1em; color: #555; }
ul, ol { margin: 0 0 1.2em 0; padding-left: 1.8em; }
li { margin: 0.35em 0; line-height: 1.7em; }
pre { background-color: #1e1e1e; border-radius: 8px; padding: 16px 18px; font-size: 13.5px; line-height: 1.6; margin: 1.3em 0; border: 1px solid #333; color: #d4d4d4; }
code { background-color: rgba(74, 144, 217, 0.12); border-radius: 4px; padding: 0.15em 0.45em; font-size: 0.88em; color: #2f6fb0; font-family: 'SFMono-Regular', Consolas, Menlo, monospace; }
pre code { background: none; padding: 0; border: none; color: #d4d4d4; }
blockquote { border-left: 4px solid #4a90d9; background-color: #f0f7ff; padding: 0.8em 1.2em; margin: 1.2em 0; color: #444; border-radius: 0 6px 6px 0; }
img { border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); margin: 1.2em 0; max-width: 100%; }
table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: 14px; }
table th, table td { border: 1px solid #e1e4e8; padding: 8px 12px; }
table th { background-color: #4a90d9; color: #fff; font-weight: 600; }
table tr:nth-child(even) { background-color: #f6f9fc; }
a { color: #4a90d9; text-decoration: none; border-bottom: 1px solid rgba(74, 144, 217, 0.3); }
`,
  },
  minimal: {
    name: 'Minimal',
    description: '简约风格，干净留白，适合头条号等轻阅读平台',
    css: `
p { color: rgb(60, 60, 60); font-size: 16px; line-height: 2em; margin: 0 0 1.5em 0; }
h1 { font-size: 1.5em; text-align: center; letter-spacing: 0.05em; font-weight: 700; color: #222; }
h2 { font-size: 1.25em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; color: #333; }
h3 { font-size: 1.1em; color: #444; }
ul, ol { margin: 0 0 1.4em 0; padding-left: 1.6em; }
li { margin: 0.4em 0; line-height: 1.9em; }
pre { background-color: #fafafa; border-radius: 6px; border: 1px solid #eee; padding: 14px 16px; overflow-x: auto; font-size: 13.5px; line-height: 1.6; margin: 1.2em 0; }
code { background-color: rgba(0,0,0,0.04); border-radius: 3px; color: #c7254e; padding: 0.15em 0.4em; font-family: 'SFMono-Regular', Consolas, monospace; }
pre code { background: none; padding: 0; border: none; }
blockquote { border-left: none; background: #f9f9f9; font-style: italic; padding: 0.8em 1.2em; margin: 1.4em 0; color: #666; border-radius: 4px; }
img { border-radius: 4px; margin: 1.2em auto; max-width: 100%; display: block; }
table { border-collapse: collapse; width: 100%; margin: 1.4em 0; font-size: 14px; }
table th, table td { border: 1px solid #eee; padding: 8px 12px; }
table th { background-color: #f5f5f5; font-weight: 600; color: #333; }
a { color: #0969da; text-decoration: none; }
`,
  },
}

export async function listThemes(): Promise<ThemeInfo[]> {
  const themes: ThemeInfo[] = []

  for (const [id, meta] of Object.entries(BUILTIN_THEMES)) {
    themes.push({ id, name: meta.name, description: meta.description, isBuiltin: true })
  }

  try {
    const files = await fs.readdir(THEMES_DIR)
    for (const file of files) {
      if (file.endsWith('.css')) {
        const id = path.basename(file, '.css')
        if (!BUILTIN_THEMES[id]) {
          themes.push({ id, name: id, description: 'Custom theme', isBuiltin: false })
        }
      }
    }
  } catch {
    // themes dir not exist, skip
  }

  return themes
}

export async function loadThemeCss(themeId: string): Promise<string | null> {
  if (BUILTIN_THEMES[themeId]) {
    return BUILTIN_THEMES[themeId].css
  }
  try {
    return await fs.readFile(path.join(THEMES_DIR, `${themeId}.css`), 'utf-8')
  } catch {
    return null
  }
}
