/**
 * 生成 all-themes-preview.html（当前 4 套内置主题 + 卡片示例）
 * 用法: npx tsx scripts/generate-all-themes-preview.ts
 */
import { parseMarkdown } from '../src/core/parser.js'
import { loadThemeCss, type ThemeInfo } from '../src/core/theme.js'
import { inlineStyles } from '../src/core/styler.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../themes/all-themes-preview.html')

// 标准示例文章（覆盖全部元素类型）
const SAMPLE = `---
title: 主题预览示例：项目放哪，决定你的 AI 编程快 100 倍
---

同一台机器，同一个项目：**原生文件系统 0.05s**，桥接访问 8.8s——慢 169 倍。

:::tip 先记住结论
项目放对地方：warm build **2.63s**；放错地方：直接卡死崩溃。
:::

## 为什么慢

WSL2 不是"子系统"，是台独立虚拟机。访问 \`/mnt/c\` 时，每个文件操作都要经 9p 协议翻译一次。

> 官方原话：For the fastest performance speed, store your files in the WSL file system.

:::warning 验证纪律
TCP 三次握手能完成 ≠ 连接真的通了——**黑洞连接也能握手**。
:::

## 三种放法

| 方式 | warm build | 命运 |
| --- | --- | --- |
| Windows 原生 | 4.23s | 正常 |
| WSL /mnt 桥接 | 卡死 | 崩溃 |
| WSL 原生 ext4 | 2.63s | 最快 |

:::note 适合谁
纯轻编辑型 → Windows 原生也可；**唯一不能选的是 /mnt 桥接**。
:::

## 代码示例

\`\`\`bash
cp -r /mnt/c/Dev/my-project ~/work/my-project
time dotnet build
\`\`\`

行内代码 \`dotnet restore\` 与重点 **加粗强调** 效果如上。
`

async function main() {
  const themes: ThemeInfo[] = [
    { id: 'default', name: 'Default', description: '默认简洁，适合大多数文章', isBuiltin: true },
    { id: 'wechat', name: 'Wechat', description: '琥珀编辑风（Tufte 灵感）：重点高亮、金句引用、卡片容器', isBuiltin: true },
    { id: 'modern', name: 'Modern', description: '现代风格：深色代码块，适合技术/知乎', isBuiltin: true },
    { id: 'minimal', name: 'Minimal', description: '简约留白，适合头条轻阅读', isBuiltin: true },
  ]

  const sections: string[] = []
  for (const t of themes) {
    const css = await loadThemeCss(t.id)
    const parsed = parseMarkdown(SAMPLE)
    const html = inlineStyles(parsed.html, css ?? '')
    sections.push(`
    <div class="theme-block">
      <div class="theme-head">
        <h2>${t.id}</h2>
        <span class="theme-desc">${t.description}</span>
      </div>
      <div class="theme-body">${html}</div>
    </div>`)
  }

  const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>multi-publisher 主题预览（4 套）</title>
<style>
  body { margin: 0; background: #f0efeb; font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  .page-head { max-width: 1100px; margin: 0 auto; padding: 32px 24px 8px; }
  .page-head h1 { margin: 0 0 6px; font-size: 24px; }
  .page-head p { margin: 0; color: #666; font-size: 14px; }
  .theme-block { max-width: 1100px; margin: 24px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); overflow: hidden; }
  .theme-head { display: flex; align-items: baseline; gap: 12px; padding: 16px 24px; border-bottom: 1px solid #eee; background: #fafaf8; }
  .theme-head h2 { margin: 0; font-size: 18px; font-family: monospace; }
  .theme-desc { color: #888; font-size: 13px; }
  .theme-body { padding: 16px 32px 32px; }
</style>
</head>
<body>
  <div class="page-head">
    <h1>multi-publisher 内置主题预览</h1>
    <p>同一篇示例文章（含卡片容器 :::tip/warning/note）在 4 套主题下的渲染效果。生成: npx tsx scripts/generate-all-themes-preview.ts</p>
  </div>
  ${sections.join('\n')}
</body>
</html>`

  fs.writeFileSync(OUT, page, 'utf-8')
  console.log(`✅ 已生成: ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
