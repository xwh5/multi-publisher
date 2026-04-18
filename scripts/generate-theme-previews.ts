/**
 * 生成主题预览截图
 * 使用 Playwright 截取 themes/preview-*.html 页面
 */
import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const THEMES_DIR = path.resolve(__dirname, '../themes')
const OUTPUT_DIR = path.resolve(__dirname, '../themes/previews')

async function generatePreviews() {
  // 创建输出目录
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 }
  })

  const themeFiles = [
    { file: 'preview-wechat.html', name: 'wechat', label: 'Wechat 微信风格' },
    { file: 'preview-cyberpunk.html', name: 'cyberpunk', label: 'Cyberpunk 赛博朋克' },
    { file: 'preview-nord.html', name: 'nord', label: 'Nord 北欧冷淡' },
    { file: 'preview-modern.html', name: 'modern', label: 'Modern 现代风格' },
    { file: 'preview-minimal.html', name: 'minimal', label: 'Minimal 简约风格' },
    { file: 'preview-paper.html', name: 'paper', label: 'Paper 笔记本' },
    { file: 'preview-dark-elite.html', name: 'darkelite', label: 'Dark Elite 深色精英' },
    { file: 'preview-sunset.html', name: 'sunset', label: 'Sunset 日落暖调' },
  ]

  console.log('开始生成主题预览截图...\n')

  for (const theme of themeFiles) {
    const filePath = path.join(THEMES_DIR, theme.file)
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  文件不存在: ${theme.file}`)
      continue
    }

    console.log(`📸 生成: ${theme.label}`)
    const page = await context.newPage()

    try {
      await page.goto(`file://${filePath}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500) // 等待字体等加载

      const outputPath = path.join(OUTPUT_DIR, `${theme.name}.png`)
      await page.screenshot({
        path: outputPath,
        fullPage: false,
        clip: { x: 0, y: 0, width: 800, height: 500 }
      })
      console.log(`   ✅ 保存到: themes/previews/${theme.name}.png`)
    } catch (err) {
      console.log(`   ❌ 失败: ${err.message}`)
    } finally {
      await page.close()
    }
  }

  await browser.close()
  console.log('\n完成！预览图保存在 themes/previews/ 目录')
}

generatePreviews().catch(console.error)
