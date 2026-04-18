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
export const DEFAULT_CSS = `
p {
  color: rgb(51, 51, 51);
  font-size: 15px;
  line-height: 1.75em;
  margin: 0 0 1em 0;
  word-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
  margin: 1em 0 0.5em 0;
}
h1 { font-size: 1.25em; line-height: 1.4em; }
h2 { font-size: 1.125em; }
h3 { font-size: 1.05em; }
h4, h5, h6 { font-size: 1em; }
li p { margin: 0; }
ul, ol { margin: 0; padding-left: 2em; }
li { margin: 0; padding: 0; line-height: normal; }
li + li { margin-top: 0.3em; }
pre {
  background-color: #f6f8fa;
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.6;
  margin: 1em 0;
}
code {
  background-color: rgba(175, 184, 193, 0.2);
  border-radius: 3px;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
pre code { background: none; padding: 0; font-size: 14px; }
blockquote { border-left: 4px solid #ddd; padding-left: 1em; margin: 1em 0; color: #666; }
hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bolder; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
table th, table td { border: 1px solid #ddd; padding: 8px 12px; }
table th { background-color: #f6f8fa; font-weight: bold; }
a { color: #0579b7; text-decoration: none; }
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
    description: '微信风格，仿微信官方文章样式',
    css: `
p {
  color: rgb(51, 51, 51);
  font-size: 15px;
  line-height: 1.75em;
  margin: 0 0 1em 0;
  word-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
  margin: 1em 0 0.5em 0;
}
h1 { font-size: 1.35em; line-height: 1.4em; border-bottom: 1px solid #e8e8e8; padding-bottom: 0.3em; }
h2 { font-size: 1.125em; }
h3 { font-size: 1.05em; }
h4, h5, h6 { font-size: 1em; }
li p { margin: 0; }
ul, ol { margin: 0; padding-left: 2em; }
li { margin: 0; padding: 0; line-height: normal; }
li + li { margin-top: 0.3em; }
pre {
  background-color: #f6f8fa;
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.6;
  margin: 1em 0;
}
code {
  background-color: rgba(175, 184, 193, 0.2);
  border-radius: 3px;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
pre code { background: none; padding: 0; font-size: 14px; }
blockquote { border-left: 3px solid #c8a96e; background: #faf9f7; padding-left: 1em; margin: 1em 0; color: #666; }
hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bolder; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
table th, table td { border: 1px solid #ddd; padding: 8px 12px; }
table th { background-color: #f8f8f8; font-weight: bold; }
a { color: #576b95; border-bottom: 1px solid rgba(87, 107, 149, 0.3); text-decoration: none; }
`,
  },
  modern: {
    name: 'Modern',
    description: '现代风格，深色代码块，清晰的视觉层次',
    css: `
p { color: rgb(45, 45, 45); font-size: 15.5px; line-height: 1.85em; margin: 0 0 1.3em 0; }
h1, h2, h3 { font-weight: 700; line-height: 1.35em; color: #111; }
h1 { font-size: 1.4em; border-bottom: 2px solid #4a90d9; padding-bottom: 0.25em; }
h2 { font-size: 1.2em; }
pre { background-color: #1e1e1e; border-radius: 10px; padding: 18px 22px; font-size: 13.5px; margin: 1.3em 0; border: 1px solid #333; }
code { background-color: rgba(74, 144, 217, 0.12); border-radius: 4px; padding: 0.15em 0.45em; font-size: 0.88em; color: #4a90d9; }
pre code { background: none; padding: 0; color: #d4d4d4; }
blockquote { border-left: 4px solid #4a90d9; background: linear-gradient(135deg, #f0f7ff 0%, #fff 100%); padding: 0.6em 1.2em; border-radius: 0 6px 6px 0; }
img { border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
table th { background-color: #4a90d9; color: #fff; }
a { color: #4a90d9; }
`,
  },
  minimal: {
    name: 'Minimal',
    description: '简约风格，干净留白，适合阅读',
    css: `
p { color: rgb(60, 60, 60); font-size: 16px; line-height: 2em; margin: 0 0 1.5em 0; }
h1 { font-size: 1.5em; text-align: center; letter-spacing: 0.05em; }
h2 { font-size: 1.25em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
pre { background-color: #fafafa; border-radius: 6px; border: 1px solid #eee; }
code { background-color: rgba(0,0,0,0.04); border-radius: 3px; color: #c7254e; }
blockquote { border-left: none; background: #f9f9f9; font-style: italic; }
img { border-radius: 4px; }
a { color: #0969da; }
`,
  },
  cyberpunk: {
    name: 'Cyberpunk',
    description: '赛博朋克风格，炫酷霓虹发光效果',
    css: `
p { color: #c8c8ff; font-size: 15px; line-height: 1.8em; margin: 0 0 1em 0; }
h1, h2, h3, h4, h5, h6 { font-weight: bold; margin: 1.2em 0 0.6em 0; line-height: 1.4em; }
h1 { font-size: 1.6em; color: #00fff5; text-shadow: 0 0 20px #00fff5, 0 0 40px #00fff5; border-bottom: 2px solid #ff00ff; padding-bottom: 0.4em; }
h2 { font-size: 1.3em; color: #ff00ff; text-shadow: 0 0 10px #ff00ff; }
h3 { font-size: 1.15em; color: #00fff5; }
li p { margin: 0; }
ul, ol { margin: 0.8em 0; padding-left: 1.5em; }
li { margin-bottom: 0.4em; color: #c8c8ff; }
pre { background: linear-gradient(135deg, #0d022155, #0a0a1f); border: 1px solid #ff00ff33; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 13.5px; line-height: 1.7; margin: 1em 0; box-shadow: 0 0 20px #ff00ff22; }
code { background: linear-gradient(90deg, #ff00ff22, #00fff522); border: 1px solid #ff00ff55; border-radius: 4px; padding: 0.2em 0.5em; color: #00fff5; font-size: 0.9em; font-family: 'SF Mono', Consolas, monospace; }
pre code { background: none; border: none; padding: 0; color: #00fff5; }
blockquote { border-left: 3px solid #ff00ff; background: linear-gradient(90deg, #ff00ff11, transparent); padding: 0.8rem 1rem; margin: 1em 0; color: #ff88ff; border-radius: 0 4px 4px 0; }
hr { border: none; border-top: 1px solid #ff00ff44; margin: 2em 0; }
i, cite, em, var, address { font-style: italic; color: #ff88ff; }
b, strong { font-weight: bold; color: #fff; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 8px; box-shadow: 0 0 20px #00fff544; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
table th, table td { border: 1px solid #ff00ff44; padding: 8px 12px; }
table th { background: linear-gradient(90deg, #ff00ff33, #00fff533); color: #00fff5; font-weight: bold; }
table tr:nth-child(even) { background-color: #ff00ff11; }
a { color: #00fff5; text-decoration: none; border-bottom: 1px solid #00fff5; }
a:hover { text-shadow: 0 0 10px #00fff5; }
`,
  },
  nord: {
    name: 'Nord',
    description: '北欧冷淡风格，蓝灰色调克制简洁',
    css: `
p { color: #d8dee9; font-size: 15px; line-height: 1.8em; margin: 0 0 1em 0; }
h1, h2, h3, h4, h5, h6 { font-weight: 600; margin: 1.2em 0 0.6em 0; line-height: 1.4em; }
h1 { font-size: 1.6em; color: #88c0d0; border-bottom: 2px solid #4c566a; padding-bottom: 0.4em; }
h2 { font-size: 1.3em; color: #81a1c1; }
h3 { font-size: 1.15em; color: #88c0d0; }
li p { margin: 0; }
ul, ol { margin: 0.8em 0; padding-left: 1.5em; }
li { margin-bottom: 0.4em; color: #d8dee9; }
pre { background: #3b4252; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 13.5px; line-height: 1.7; margin: 1em 0; border-left: 3px solid #88c0d0; }
code { background: #3b4252; border-radius: 4px; padding: 0.2em 0.5em; color: #a3be8c; font-size: 0.9em; font-family: 'SF Mono', Consolas, monospace; }
pre code { background: none; padding: 0; color: #eceff4; }
blockquote { border-left: 3px solid #5e81ac; background: #3b425255; padding: 0.8rem 1rem; margin: 1em 0; color: #d8dee9; font-style: italic; border-radius: 0 4px 4px 0; }
hr { border: none; border-top: 1px solid #4c566a; margin: 2em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bold; color: #eceff4; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
table th, table td { border: 1px solid #4c566a; padding: 8px 12px; }
table th { background: #3b4252; color: #88c0d0; font-weight: bold; }
table tr:nth-child(even) { background-color: #3b425255; }
a { color: #88c0d0; text-decoration: none; }
a:hover { color: #81a1c1; }
`,
  },
  paper: {
    name: 'Paper',
    description: '笔记本风格，纸张纹理文艺复古',
    css: `
body { background-image: linear-gradient(transparent 95%, #e8e4dc 95%); background-size: 100% 2em; }
p { color: #444; font-size: 15px; line-height: 2em; margin: 0 0 1em 0; text-indent: 2em; }
h1, h2, h3, h4, h5, h6 { font-weight: bold; margin: 1.5em 0 0.6em 0; line-height: 1.4em; color: #1a1a1a; font-family: Georgia, serif; }
h1 { font-size: 1.8em; text-align: center; letter-spacing: 0.05em; text-indent: 0; }
h2 { font-size: 1.4em; color: #2d2d2d; border-bottom: 1px solid #ccc; padding-bottom: 0.3em; text-indent: 0; }
h3 { font-size: 1.1em; color: #3d3d3d; text-indent: 0; }
li p { margin: 0; }
ul, ol { margin: 0.8em 0; padding-left: 2em; }
li { margin-bottom: 0.4em; color: #444; }
pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 16px; overflow-x: auto; font-size: 13.5px; line-height: 1.6; margin: 1em 0; font-family: 'Courier New', monospace; }
code { background: #f5f5f5; border: 1px solid #ddd; border-radius: 3px; padding: 0.15em 0.4em; color: #c7254e; font-size: 0.9em; font-family: 'Courier New', monospace; }
pre code { background: none; border: none; padding: 0; color: #333; }
blockquote { border-left: 3px solid #c8a96e; background: #f9f7f3; padding: 0.8rem 1rem; margin: 1em 0; color: #666; font-style: italic; border-radius: 0 4px 4px 0; }
hr { border: none; border-top: 1px solid #ccc; margin: 2em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bold; color: #111; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
table th, table td { border: 1px solid #ddd; padding: 8px 12px; }
table th { background: #f5f5f5; color: #333; font-weight: bold; }
a { color: #0969da; text-decoration: none; border-bottom: 1px dashed #0969da; }
a:hover { border-bottom-style: solid; }
`,
  },
  darkelite: {
    name: 'Dark Elite',
    description: '深色精英风格，GitHub 式专业硬核',
    css: `
p { color: #c9d1d9; font-size: 15px; line-height: 1.8em; margin: 0 0 1em 0; }
h1, h2, h3, h4, h5, h6 { font-weight: bold; margin: 1.2em 0 0.6em 0; line-height: 1.4em; }
h1 { font-size: 1.6em; color: #fff; border-bottom: 1px solid #30363d; padding-bottom: 0.4em; }
h2 { font-size: 1.3em; color: #58a6ff; }
h3 { font-size: 1.15em; color: #8b949e; }
li p { margin: 0; }
ul, ol { margin: 0.8em 0; padding-left: 1.5em; }
li { margin-bottom: 0.4em; color: #c9d1d9; }
pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; overflow-x: auto; font-size: 13.5px; line-height: 1.7; margin: 1em 0; }
code { background: #21262d; border: 1px solid #30363d; border-radius: 4px; padding: 0.2em 0.5em; color: #f0883e; font-size: 0.9em; font-family: 'SF Mono', Consolas, monospace; }
pre code { background: none; border: none; padding: 0; color: #c9d1d9; }
blockquote { border-left: 3px solid #238636; background: #161b22; padding: 0.8rem 1rem; margin: 1em 0; color: #8b949e; border-radius: 0 4px 4px 0; }
hr { border: none; border-top: 1px solid #30363d; margin: 2em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bold; color: #fff; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 6px; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; border: 1px solid #30363d; }
table th, table td { border: 1px solid #30363d; padding: 8px 12px; }
table th { background: #161b22; color: #58a6ff; font-weight: bold; }
a { color: #58a6ff; text-decoration: none; }
a:hover { color: #79c0ff; }
`,
  },
  sunset: {
    name: 'Sunset',
    description: '日落暖调风格，温暖治愈系',
    css: `
body { background: linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%); }
p { color: #ddd; font-size: 15px; line-height: 1.8em; margin: 0 0 1em 0; }
h1, h2, h3, h4, h5, h6 { font-weight: bold; margin: 1.2em 0 0.6em 0; line-height: 1.4em; color: #f5f5f5; }
h1 { font-size: 1.6em; color: #ff6b6b; text-shadow: 0 0 30px #ff6b6b55; text-align: center; }
h2 { font-size: 1.3em; color: #ffa07a; border-bottom: 1px solid #ffa07a44; padding-bottom: 0.3em; }
h3 { font-size: 1.15em; color: #ffd93d; }
li p { margin: 0; }
ul, ol { margin: 0.8em 0; padding-left: 1.5em; }
li { margin-bottom: 0.4em; color: #ddd; }
pre { background: #2d2d44; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 13.5px; line-height: 1.7; margin: 1em 0; border-left: 3px solid #ff6b6b; }
code { background: #2d2d44; border-radius: 4px; padding: 0.2em 0.5em; color: #ffd93d; font-size: 0.9em; font-family: 'SF Mono', Consolas, monospace; }
pre code { background: none; padding: 0; color: #ffa07a; }
blockquote { background: linear-gradient(90deg, #ff6b6b11, transparent); border-left: 3px solid #ff6b6b; padding: 0.8rem 1rem; margin: 1em 0; color: #bbb; border-radius: 0 4px 4px 0; }
hr { border: none; border-top: 1px solid #444; margin: 2em 0; }
i, cite, em, var, address { font-style: italic; color: #ffa07a; }
b, strong { font-weight: bold; color: #fff; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
table th, table td { border: 1px solid #444; padding: 8px 12px; }
table th { background: #2d2d44; color: #ffd93d; font-weight: bold; }
a { color: #ffa07a; text-decoration: none; }
a:hover { color: #ff6b6b; }
`,
  },
  zen: {
    name: 'Zen',
    description: '禅意风格，日式极简留白',
    css: `
body { background: #f7f5f0; }
p { color: #4a4a4a; font-size: 15px; line-height: 2em; margin: 0 0 1.5em 0; }
h1, h2, h3, h4, h5, h6 { font-weight: normal; margin: 2em 0 0.8em 0; line-height: 1.6em; color: #2d2d2d; font-family: 'Noto Serif SC', 'Songti SC', serif; }
h1 { font-size: 1.8em; text-align: center; letter-spacing: 0.15em; border-bottom: 1px solid #d4d4d4; padding-bottom: 0.5em; }
h2 { font-size: 1.4em; letter-spacing: 0.1em; border-left: 3px solid #8b7355; padding-left: 0.8em; }
h3 { font-size: 1.15em; color: #5a5a5a; }
li p { margin: 0; }
ul, ol { margin: 1em 0; padding-left: 1.5em; }
li { margin-bottom: 0.6em; color: #4a4a4a; line-height: 1.9; }
pre { background: #ebe8e0; border-radius: 4px; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.7; margin: 1.5em 0; border-left: 2px solid #8b7355; }
code { background: #ebe8e0; border-radius: 3px; padding: 0.15em 0.4em; color: #6b5b4f; font-size: 0.9em; font-family: 'SF Mono', monospace; }
pre code { background: none; padding: 0; color: #4a4a4a; }
blockquote { border-left: none; border-top: 1px solid #d4d4d4; border-bottom: 1px solid #d4d4d4; background: none; padding: 1em 1.5em; margin: 2em 0; color: #7a7a7a; font-style: normal; text-align: center; }
hr { border: none; text-align: center; margin: 3em 0; }
hr::after { content: '· · ·'; color: #8b7355; letter-spacing: 0.5em; font-size: 1.2em; }
i, cite, em, var, address { font-style: italic; color: #7a7a7a; }
b, strong { font-weight: normal; color: #3d3d3d; }
img { max-width: 100%; height: auto; display: block; margin: 2em auto; border-radius: 2px; }
table { border-collapse: collapse; width: 100%; margin: 1.5em 0; }
table th, table td { border: none; border-top: 1px solid #d4d4d4; padding: 10px 12px; }
table th { color: #8b7355; font-weight: normal; text-align: left; }
a { color: #8b7355; text-decoration: none; border-bottom: 1px solid transparent; }
a:hover { border-bottom-color: #8b7355; }
`,
  },
  retro: {
    name: 'Retro Futurism',
    description: '80年代复古未来主义，霓虹几何',
    css: `
body { background: #0d0d1a; background-image: repeating-linear-gradient(0deg, transparent, transparent 50px, #1a1a2e 50px, #1a1a2e 51px), repeating-linear-gradient(90deg, transparent, transparent 50px, #1a1a2e 50px, #1a1a2e 51px); }
p { color: #e0e0e0; font-size: 15px; line-height: 1.8em; margin: 0 0 1em 0; }
h1, h2, h3, h4, h5, h6 { font-weight: bold; margin: 1.5em 0 0.8em 0; line-height: 1.3em; color: #fff; text-transform: uppercase; letter-spacing: 0.1em; }
h1 { font-size: 2em; color: #ff6ec7; text-shadow: 3px 3px 0 #00d4ff, -1px -1px 0 #ffff00; transform: skewX(-5deg); }
h2 { font-size: 1.4em; color: #00d4ff; border-bottom: 2px solid #ff6ec7; padding-bottom: 0.3em; }
h3 { font-size: 1.15em; color: #ffff00; }
li p { margin: 0; }
ul, ol { margin: 1em 0; padding-left: 1.5em; }
li { margin-bottom: 0.5em; color: #e0e0e0; }
pre { background: linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%); border: 2px solid #ff6ec7; border-radius: 0; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.7; margin: 1.5em 0; transform: perspective(500px) rotateX(2deg); box-shadow: 5px 5px 0 #00d4ff; }
code { background: #ff6ec755; border: 1px solid #ff6ec7; border-radius: 0; padding: 0.2em 0.5em; color: #ff6ec7; font-size: 0.9em; font-family: 'Courier New', monospace; }
pre code { background: none; border: none; padding: 0; color: #00d4ff; }
blockquote { border-left: 4px solid #ffff00; background: #1a1a2e; padding: 1rem 1.5rem; margin: 1.5em 0; color: #e0e0e0; transform: skewX(-3deg); }
hr { border: none; border-top: 2px dashed #ff6ec7; margin: 2.5em 0; }
i, cite, em, var, address { font-style: italic; color: #ff6ec7; }
b, strong { font-weight: bold; color: #ffff00; }
img { max-width: 100%; height: auto; display: block; margin: 1.5em auto; border: 3px solid #00d4ff; filter: contrast(1.1) saturate(1.2); }
table { border-collapse: separate; border-spacing: 2px; width: 100%; margin: 1.5em 0; }
table th, table td { background: #1a1a2e; padding: 10px 14px; border: 1px solid #ff6ec7; }
table th { color: #ffff00; text-align: center; }
a { color: #00d4ff; text-decoration: none; text-transform: uppercase; }
a:hover { color: #ff6ec7; text-shadow: 0 0 10px #ff6ec7; }
`,
  },
  midnight: {
    name: 'Midnight Library',
    description: '深夜图书馆，暖黄灯光书香氛围',
    css: `
body { background: #0f1a14; background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%231a2f23' fill-opacity='0.3'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); }
p { color: #d4c5a9; font-size: 15.5px; line-height: 1.9em; margin: 0 0 1.2em 0; font-family: 'Lora', 'Noto Serif SC', Georgia, serif; }
h1, h2, h3, h4, h5, h6 { font-weight: normal; margin: 1.8em 0 0.8em 0; line-height: 1.5em; color: #f5e6c8; font-family: 'Playfair Display', 'Noto Serif SC', serif; }
h1 { font-size: 1.9em; text-align: center; letter-spacing: 0.08em; text-shadow: 0 0 40px #ffd70044; border-bottom: 1px solid #3d5a45; padding-bottom: 0.5em; }
h2 { font-size: 1.4em; color: #c9a962; border-left: 3px solid #8b7355; padding-left: 0.8em; }
h3 { font-size: 1.15em; color: #b8956e; }
li p { margin: 0; }
ul, ol { margin: 1em 0; padding-left: 1.5em; }
li { margin-bottom: 0.5em; color: #d4c5a9; }
pre { background: #1a2f23; border: 1px solid #3d5a45; border-radius: 4px; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.7; margin: 1.5em 0; box-shadow: inset 0 0 20px #0d1a1444; }
code { background: #2a3f33; border-radius: 3px; padding: 0.15em 0.4em; color: #ffd700; font-size: 0.9em; font-family: 'Courier New', monospace; }
pre code { background: none; padding: 0; color: #d4c5a9; }
blockquote { border-left: 3px solid #8b7355; background: linear-gradient(90deg, #1a2f2344, transparent); padding: 1rem 1.5rem; margin: 2em 0; color: #b8956e; font-style: italic; border-radius: 0 4px 4px 0; }
hr { border: none; border-top: 1px solid #3d5a45; margin: 3em 0; }
i, cite, em, var, address { font-style: italic; color: #c9a962; }
b, strong { font-weight: normal; color: #f5e6c8; }
img { max-width: 100%; height: auto; display: block; margin: 2em auto; border-radius: 2px; box-shadow: 0 4px 20px #00000055; }
table { border-collapse: collapse; width: 100%; margin: 1.5em 0; }
table th, table td { border: 1px solid #3d5a45; padding: 10px 14px; }
table th { background: #1a2f23; color: #c9a962; text-align: left; }
a { color: #c9a962; text-decoration: none; border-bottom: 1px dotted #8b7355; }
a:hover { color: #ffd700; border-bottom-color: #ffd700; }
`,
  },
  brutalism: {
    name: 'Brutalism',
    description: '粗野主义，大字体原始美学',
    css: `
body { background: #fff; }
p { color: #000; font-size: 16px; line-height: 1.6em; margin: 0 0 1em 0; font-weight: 500; }
h1, h2, h3, h4, h5, h6 { font-weight: 900; margin: 1.5em 0 0.5em 0; line-height: 1.1em; color: #000; text-transform: uppercase; }
h1 { font-size: 3em; border: 4px solid #000; padding: 0.2em 0.4em; transform: rotate(-1deg); display: inline-block; }
h2 { font-size: 1.8em; border-bottom: 4px solid #000; padding-bottom: 0.2em; }
h3 { font-size: 1.3em; }
li p { margin: 0; }
ul, ol { margin: 1em 0; padding-left: 1.5em; }
li { margin-bottom: 0.5em; color: #000; font-weight: 600; }
pre { background: #000; border-radius: 0; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.6; margin: 1.5em 0; }
code { background: #000; border-radius: 0; padding: 0.2em 0.4em; color: #fff; font-size: 1em; font-family: 'SF Mono', monospace; font-weight: bold; }
pre code { background: none; padding: 0; color: #fff; }
blockquote { border: 4px solid #000; background: #f0f0f0; padding: 1rem 1.5rem; margin: 2em 0; }
blockquote p { font-size: 1.2em; font-weight: 900; margin: 0; }
hr { border: none; border-top: 4px solid #000; margin: 3em 0; }
i, cite, em, var, address { font-style: normal; text-decoration: underline; text-decoration-thickness: 3px; }
b, strong { font-weight: 900; }
img { max-width: 100%; height: auto; display: block; margin: 1.5em 0; border: 4px solid #000; }
table { border-collapse: collapse; width: 100%; margin: 1.5em 0; border: 4px solid #000; }
table th, table td { border: 2px solid #000; padding: 10px 14px; }
table th { background: #000; color: #fff; font-weight: 900; text-transform: uppercase; }
a { color: #000; text-decoration: none; background: #ffff00; padding: 0 0.2em; }
a:hover { background: #000; color: #fff; }
`,
  },
  neumorphism: {
    name: 'Neumorphism',
    description: '新拟态风格，柔和立体软UI',
    css: `
body { background: #e0e5ec; }
p { color: #4a5568; font-size: 15px; line-height: 1.8em; margin: 0 0 1em 0; }
h1, h2, h3, h4, h5, h6 { font-weight: 600; margin: 1.2em 0 0.6em 0; line-height: 1.4em; color: #2d3748; }
h1 { font-size: 1.7em; text-align: center; text-shadow: 6px 6px 12px #b8bcc2, -6px -6px 12px #ffffff; padding: 0.5em; }
h2 { font-size: 1.3em; color: #4a5568; border-left: 4px solid #7c3aed; padding-left: 0.6em; }
h3 { font-size: 1.1em; color: #5a6577; }
li p { margin: 0; }
ul, ol { margin: 0.8em 0; padding-left: 1.5em; }
li { margin-bottom: 0.5em; color: #4a5568; }
pre { background: #e0e5ec; border-radius: 16px; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.7; margin: 1.2em 0; box-shadow: 8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff; }
code { background: #e0e5ec; border-radius: 8px; padding: 0.2em 0.5em; color: #7c3aed; font-size: 0.9em; font-family: 'SF Mono', monospace; box-shadow: inset 2px 2px 4px #b8bcc2, inset -2px -2px 4px #ffffff; }
pre code { background: none; padding: 0; color: #4a5568; box-shadow: none; }
blockquote { background: #e0e5ec; border-radius: 16px; padding: 1rem 1.5rem; margin: 1.2em 0; color: #5a6577; box-shadow: 8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff; border-left: 4px solid #7c3aed; }
hr { border: none; margin: 2em 0; }
hr::after { content: '···'; color: #7c3aed; font-size: 1.5em; letter-spacing: 0.5em; }
i, cite, em, var, address { font-style: italic; color: #7c3aed; }
b, strong { font-weight: 600; color: #2d3748; }
img { max-width: 100%; height: auto; display: block; margin: 1.2em auto; border-radius: 16px; box-shadow: 8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff; }
table { border-collapse: collapse; width: 100%; margin: 1.2em 0; background: #e0e5ec; border-radius: 16px; overflow: hidden; box-shadow: 8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff; }
table th, table td { padding: 12px 16px; }
table th { background: linear-gradient(145deg, #e6ebf2, #d1d9e6); color: #7c3aed; font-weight: 600; }
table tr:nth-child(even) { background: rgba(124, 58, 237, 0.05); }
a { color: #7c3aed; text-decoration: none; font-weight: 600; }
a:hover { color: #5b21b6; text-decoration: underline; }
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
