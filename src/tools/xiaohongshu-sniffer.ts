/**
 * 小红书 抓包工具 - 只抓保存草稿 API
 */
import { chromium } from 'playwright'

async function sniffXiaohongshu() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()

  // 监听所有小红书 API 请求
  page.on('request', (req) => {
    const url = req.url()
    if (!url.includes('xiaohongshu.com')) return

    const method = req.method()
    const body = req.postData()

    // 只打印 POST 请求（通常是数据提交）
    if (method === 'POST' && body) {
      console.log('\n========== POST 请求 ==========')
      console.log(`URL: ${url}`)
      console.log(`Body: ${body}`)
    }
  })

  // 监听响应
  page.on('response', (resp) => {
    const url = resp.url()
    if (!url.includes('xiaohongshu.com')) return

    if (resp.status() >= 200 && resp.status() < 300) {
      resp.text().then(body => {
        if (body && body.length < 500) {
          console.log(`响应 [${resp.status()}]: ${body}`)
        }
      }).catch(() => {})
    }
  })

  console.log('========================================')
  console.log('小红书 抓包工具 - 保存草稿')
  console.log('========================================')
  console.log('步骤：')
  console.log('1. 打开 https://creator.xiaohongshu.com/')
  console.log('2. 手动登录')
  console.log('3. 点击"发布笔记" -> "图文"')
  console.log('4. 填写标题和内容')
  console.log('5. 点击"保存草稿"按钮')
  console.log('6. 观察下方输出的 POST 请求')
  console.log('========================================\n')

  await page.goto('https://creator.xiaohongshu.com/', { waitUntil: 'networkidle' })

  console.log('等待操作...\n')

  // 等待手动停止
  await new Promise(() => {})
}

sniffXiaohongshu().catch(console.error)
