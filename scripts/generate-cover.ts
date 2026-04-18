/**
 * 生成封面图 - 支持随机颜色风格
 */
import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 预设的颜色主题
const THEMES = [
  { name: '科技蓝紫', primary: '#667eea', secondary: '#764ba2', bg: '#1a1a2e' },
  { name: '火焰橙红', primary: '#f093fb', secondary: '#f5576c', bg: '#1a0a0a' },
  { name: '森林青绿', primary: '#4fd1c5', secondary: '#38b2ac', bg: '#0a1a1a' },
  { name: '金色典雅', primary: '#f6d365', secondary: '#fda085', bg: '#1a1408' },
  { name: '极光青蓝', primary: '#00d4ff', secondary: '#7c3aed', bg: '#0a0a1a' },
  { name: '玫瑰粉紫', primary: '#ff6b6b', secondary: '#c471ed', bg: '#1a0a14' },
  { name: '薄荷绿', primary: '#00f5a0', secondary: '#00d9f5', bg: '#0a1a14' },
  { name: '落日橙', primary: '#ff7e5f', secondary: '#feb47b', bg: '#1a0f05' },
]

// 装饰风格
const DECOR_STYLES = ['circles', 'rings', 'dots', 'lines', 'grid', 'hexagon']

interface CoverOptions {
  title: string
  subtitle?: string
  width?: number
  height?: number
  themeIndex?: number  // 指定主题，不指定则随机
  styleIndex?: number  // 指定装饰风格，不指定则随机
  seed?: string        // 随机种子，用于保证相同参数生成相同结果
}

/**
 * 根据种子生成确定性随机数
 */
function seededRandom(seed: string, index: number): number {
  const hash = crypto.createHash('md5').update(seed + index).digest('hex')
  return parseInt(hash.substring(0, 8), 16) / 0xffffffff
}

/**
 * 随机选择数组元素
 */
function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]
}

/**
 * 生成封面图
 */
export async function generateCover(options: CoverOptions): Promise<string> {
  const {
    title,
    subtitle = '',
    width = 900,
    height = 500,
    themeIndex,
    styleIndex,
    seed = title + Date.now(),
  } = options

  // 确定使用的主题
  const theme = themeIndex !== undefined
    ? THEMES[themeIndex % THEMES.length]
    : pick(THEMES, () => seededRandom(seed, 0))

  // 确定使用的装饰风格
  const decorStyle = styleIndex !== undefined
    ? DECOR_STYLES[styleIndex % DECOR_STYLES.length]
    : pick(DECOR_STYLES, () => seededRandom(seed, 1))

  // 根据主题生成颜色
  const primary = theme.primary
  const secondary = theme.secondary
  const bg = theme.bg

  // 计算主色调的亮度，决定文字颜色
  const primaryBrightness = parseInt(primary.slice(1, 3), 16) / 255

  // 生成 SVG
  const svg = buildSvg({ title, subtitle, width, height, primary, secondary, bg, decorStyle, seed })

  const outputPath = path.join(__dirname, '../cover-preview.png')

  await sharp(Buffer.from(svg))
    .png()
    .toFile(outputPath)

  console.log(`封面图已生成: ${outputPath} [主题: ${theme.name}] [风格: ${decorStyle}]`)
  return outputPath
}

interface BuildSvgParams {
  title: string
  subtitle: string
  width: number
  height: number
  primary: string
  secondary: string
  bg: string
  decorStyle: string
  seed: string
}

function buildSvg(p: BuildSvgParams): string {
  const { title, subtitle, width, height, primary, secondary, bg, decorStyle, seed } = p

  // 生成半透明主色
  const primaryLight = adjustColor(primary, 0.3)
  const secondaryLight = adjustColor(secondary, 0.3)

  // 创建渐变颜色
  const gradTop = adjustColor(primary, -0.2)
  const gradBottom = adjustColor(secondary, -0.2)

  // 随机装饰元素
  let decorElements = ''

  switch (decorStyle) {
    case 'circles':
      decorElements = `
        <circle cx="${width - 80}" cy="70" r="100" fill="${primary}" fill-opacity="0.08"/>
        <circle cx="${width - 80}" cy="70" r="70" fill="${secondary}" fill-opacity="0.06"/>
        <circle cx="80" cy="${height - 80}" r="120" fill="${secondary}" fill-opacity="0.08"/>
        <circle cx="80" cy="${height - 80}" r="80" fill="${primary}" fill-opacity="0.05"/>
        <circle cx="${width / 2}" cy="${height + 50}" r="150" fill="${primary}" fill-opacity="0.04"/>
      `
      break
    case 'rings':
      decorElements = `
        <circle cx="${width - 100}" cy="100" r="120" fill="none" stroke="${primary}" stroke-width="1" stroke-opacity="0.2"/>
        <circle cx="${width - 100}" cy="100" r="90" fill="none" stroke="${secondary}" stroke-width="1" stroke-opacity="0.15"/>
        <circle cx="${width - 100}" cy="100" r="60" fill="none" stroke="${primary}" stroke-width="1" stroke-opacity="0.1"/>
        <circle cx="100" cy="${height - 100}" r="100" fill="none" stroke="${secondary}" stroke-width="1" stroke-opacity="0.2"/>
        <circle cx="100" cy="${height - 100}" r="70" fill="none" stroke="${primary}" stroke-width="1" stroke-opacity="0.15"/>
      `
      break
    case 'dots':
      decorElements = `
        <circle cx="${width - 60}" cy="60" r="80" fill="${secondary}" fill-opacity="0.1"/>
        ${Array.from({ length: 8 }, (_, i) => {
          const x = 60 + i * 30
          const y = height - 40
          return `<circle cx="${x}" cy="${y}" r="2" fill="${primary}" fill-opacity="0.3"/>`
        }).join('')}
        ${Array.from({ length: 6 }, (_, i) => {
          const x = width - 180 + i * 25
          const y = 80
          return `<circle cx="${x}" cy="${y}" r="2" fill="${secondary}" fill-opacity="0.3"/>`
        }).join('')}
      `
      break
    case 'lines':
      decorElements = `
        <line x1="${width - 150}" y1="50" x2="${width - 150}" y2="${height - 50}" stroke="${primary}" stroke-width="1" stroke-opacity="0.15"/>
        <line x1="${width - 120}" y1="50" x2="${width - 120}" y2="${height - 50}" stroke="${secondary}" stroke-width="1" stroke-opacity="0.1"/>
        <line x1="50" y1="${height - 150}" x2="${width - 50}" y2="${height - 150}" stroke="${primary}" stroke-width="1" stroke-opacity="0.1"/>
        <line x1="50" y1="${height - 120}" x2="${width - 50}" y2="${height - 120}" stroke="${secondary}" stroke-width="1" stroke-opacity="0.08"/>
      `
      break
    case 'grid':
      decorElements = `
        <pattern id="decoGrid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="${primary}" stroke-width="0.5" stroke-opacity="0.08"/>
        </pattern>
        <rect width="100%" height="100%" fill="url(#decoGrid)"/>
      `
      break
    case 'hexagon':
      const hx = width - 100, hy = 100
      decorElements = `
        <polygon points="${hx},${hy - 60} ${hx + 52},${hy - 30} ${hx + 52},${hy + 30} ${hx},${hy + 60} ${hx - 52},${hy + 30} ${hx - 52},${hy - 30}"
          fill="none" stroke="${primary}" stroke-width="1" stroke-opacity="0.2"/>
        <polygon points="${hx},${hy - 40} ${hx + 35},${hy - 20} ${hx + 35},${hy + 20} ${hx},${hy + 40} ${hx - 35},${hy + 20} ${hx - 35},${hy - 20}"
          fill="${secondary}" fill-opacity="0.08"/>
        <circle cx="80" cy="${height - 80}" r="60" fill="${secondary}" fill-opacity="0.08"/>
      `
      break
  }

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- 背景渐变 -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bg};stop-opacity:1" />
      <stop offset="50%" style="stop-color:${adjustColor(bg, -0.1)};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${adjustColor(secondary, -0.7)};stop-opacity:1" />
    </linearGradient>

    <!-- 顶部光晕 -->
    <radialGradient id="topGlow" cx="70%" cy="0%" r="70%">
      <stop offset="0%" style="stop-color:${primary};stop-opacity:0.3" />
      <stop offset="100%" style="stop-color:${primary};stop-opacity:0" />
    </radialGradient>

    <!-- 底部光晕 -->
    <radialGradient id="bottomGlow" cx="30%" cy="100%" r="50%">
      <stop offset="0%" style="stop-color:${secondary};stop-opacity:0.25" />
      <stop offset="100%" style="stop-color:${secondary};stop-opacity:0" />
    </radialGradient>

    <!-- 文字渐变 -->
    <linearGradient id="titleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
      <stop offset="50%" style="stop-color:${adjustColor(primary, 0.3)};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${primaryLight};stop-opacity:1" />
    </linearGradient>

    <!-- 装饰线渐变 -->
    <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${primary};stop-opacity:0" />
      <stop offset="50%" style="stop-color:${primary};stop-opacity:0.8" />
      <stop offset="100%" style="stop-color:${secondary};stop-opacity:0" />
    </linearGradient>

    <!-- 发光滤镜 -->
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- 文字阴影 -->
    <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000000" flood-opacity="0.4"/>
    </filter>
  </defs>

  <!-- 背景 -->
  <rect width="100%" height="100%" fill="url(#bgGrad)"/>

  <!-- 顶部光晕 -->
  <ellipse cx="${width}" cy="-50" rx="${width * 0.8}" ry="250" fill="url(#topGlow)"/>

  <!-- 底部光晕 -->
  <ellipse cx="0" cy="${height + 50}" rx="${width * 0.6}" ry="200" fill="url(#bottomGlow)"/>

  <!-- 装饰元素 -->
  ${decorElements}

  <!-- 左侧装饰竖线 -->
  <rect x="60" y="140" width="2" height="220" fill="url(#lineGrad)" opacity="0.5"/>

  <!-- 主标题 -->
  <text x="${width / 2}" y="${height / 2 - 30}" font-family="Arial, sans-serif" font-size="56" font-weight="bold"
    fill="url(#titleGrad)" text-anchor="middle" filter="url(#textShadow)">
    ${escapeXml(title)}
  </text>

  <!-- 标题下划线 -->
  <rect x="${width / 2 - 150}" y="${height / 2 + 5}" width="300" height="2" rx="1" fill="url(#lineGrad)" opacity="0.7"/>

  <!-- 副标题 -->
  ${subtitle ? `
  <text x="${width / 2}" y="${height / 2 + 55}" font-family="Arial, sans-serif" font-size="28" fill="#ffffff" fill-opacity="0.8" text-anchor="middle" letter-spacing="3">
    ${escapeXml(subtitle)}
  </text>
  ` : ''}

  <!-- 命令提示框 -->
  <rect x="${width / 2 - 140}" y="${height - 70}" width="280" height="36" rx="6"
    fill="#ffffff" fill-opacity="0.06" stroke="${primary}" stroke-width="1" stroke-opacity="0.2"/>
  <text x="${width / 2}" y="${height - 45}" font-family="Consolas, monospace" font-size="14" fill="${adjustColor(primary, 0.3)}" text-anchor="middle">
    npm install -g multi-publisher
  </text>

  <!-- 底部装饰点 -->
  <circle cx="${width / 2 - 80}" cy="${height - 18}" r="2" fill="${primary}" fill-opacity="0.4"/>
  <circle cx="${width / 2 - 60}" cy="${height - 18}" r="3" fill="${secondary}" fill-opacity="0.5"/>
  <circle cx="${width / 2 - 40}" cy="${height - 18}" r="2" fill="${primary}" fill-opacity="0.3"/>
</svg>
`
}

/**
 * 调整颜色亮度
 */
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16)
  let r = (num >> 16) + Math.round(255 * amount)
  let g = ((num >> 8) & 0x00ff) + Math.round(255 * amount)
  let b = (num & 0x0000ff) + Math.round(255 * amount)
  r = Math.max(0, Math.min(255, r))
  g = Math.max(0, Math.min(255, g))
  b = Math.max(0, Math.min(255, b))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/**
 * XML 转义
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// 默认执行
const title = process.argv[2] || 'AI 写完文章'
const subtitle = process.argv[3] || '一键发布全网'

generateCover({ title, subtitle }).catch(console.error)
