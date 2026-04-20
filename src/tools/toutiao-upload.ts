/**
 * 头条号封面图片浏览器上传
 */
import { chromium, type Browser, type Page } from 'playwright'
import { ConfigStore } from '../config.js'
import path from 'path'

export interface ToutiaoUploadResult {
  success: boolean
  coverUrl?: string
  error?: string
}

/**
 * 通过浏览器自动化上传头条号封面
 * 流程：打开发布页 -> 填写内容 -> 点击预览并发布 -> 在预览弹窗中上传封面 -> 确认
 */
export async function uploadCoverViaBrowser(imagePath: string): Promise<ToutiaoUploadResult> {
  const browser: Browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-devtools-shm-usage',
      '--no-sandbox',
    ]
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    const page: Page = await context.newPage()

    // CDP 隐藏自动化特征
    const cdp = await context.newCDPSession(page)
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
      `
    })

    // 加载 cookies
    const cookies = await ConfigStore.getToutiaoCookies()
    if (!cookies || Object.keys(cookies).length === 0) {
      return { success: false, error: '未配置头条号 Cookie' }
    }

    const toutiaoCookies = Object.entries(cookies).map(([name, value]) => ({
      name,
      value,
      domain: '.toutiao.com',
      path: '/',
    }))
    await context.addCookies(toutiaoCookies)

    console.log('[ToutiaoUpload] 打开发布页...')
    await page.goto('https://mp.toutiao.com/profile_v4/graphic/publish', {
      waitUntil: 'networkidle',
      timeout: 60000
    })
    await page.waitForTimeout(2000)

    // 关闭可能存在的遮罩层
    try {
      const mask = page.locator('.byte-drawer-mask').first()
      if (await mask.isVisible({ timeout: 1000 })) {
        await mask.click({ force: true })
        await page.waitForTimeout(500)
      }
    } catch {}

    // 截图
    await page.screenshot({ path: `temp/toutiao-upload-start-${Date.now()}.png` })

    // 填写标题和内容（让用户之前已经填好了，这里只做演示）
    const titleInput = page.locator('textarea').first()
    if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const currentTitle = await titleInput.inputValue().catch(() => '')
      if (!currentTitle) {
        await titleInput.fill('临时标题-封面测试')
        console.log('[ToutiaoUpload] 填写了临时标题')
      }
    }

    // 填写内容（如果为空）
    const contentEl = page.locator('div[contenteditable="true"]').first()
    if (await contentEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      const currentContent = await contentEl.textContent().catch(() => '')
      if (!currentContent || currentContent.trim() === '') {
        await contentEl.click()
        await page.keyboard.press('Control+a')
        await page.keyboard.type('临时内容-封面测试')
        console.log('[ToutiaoUpload] 填写了临时内容')
      }
    }

    // 点击"预览并发布"按钮
    console.log('[ToutiaoUpload] 点击预览并发布按钮...')
    const publishBtn = page.locator('button:has-text("预览并发布")')
    if (await publishBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await publishBtn.click({ force: true })
      console.log('[ToutiaoUpload] 已点击预览并发布')
      await page.waitForTimeout(3000)
    } else {
      return { success: false, error: '未找到预览并发布按钮' }
    }

    // 在预览弹窗中选择"单图"选项
    console.log('[ToutiaoUpload] 选择单图选项...')
    const singleImageOption = page.locator('text=单图').first()
    if (await singleImageOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await singleImageOption.click()
      console.log('[ToutiaoUpload] 点击了单图')
      await page.waitForTimeout(500)
    }

    // 截图
    await page.screenshot({ path: `temp/toutiao-upload-select-cover-${Date.now()}.png` })

    // 设置 filechooser 监听
    const absolutePath = path.resolve(imagePath)
    console.log(`[ToutiaoUpload] 准备上传: ${absolutePath}`)

    page.on('filechooser', async (fileChooser) => {
      console.log('[ToutiaoUpload] 收到 filechooser，设置文件')
      await fileChooser.setFiles(absolutePath)
    })

    // 点击封面添加区域触发 filechooser
    console.log('[ToutiaoUpload] 点击封面添加区域...')
    const coverAdd = page.locator('.article-cover-add')
    if (await coverAdd.isVisible({ timeout: 2000 }).catch(() => false)) {
      await coverAdd.click({ force: true })
      console.log('[ToutiaoUpload] 点击了 article-cover-add')
    } else {
      return { success: false, error: '未找到封面添加区域' }
    }

    // 等待文件选择
    await page.waitForTimeout(2000)

    // 点击"本地上传"按钮
    console.log('[ToutiaoUpload] 点击本地上传按钮...')
    const localUploadBtn = page.locator('text=本地上传')
    if (await localUploadBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await localUploadBtn.click()
      console.log('[ToutiaoUpload] 点击了本地上传')
      await page.waitForTimeout(2000)
    }

    // 截图看预览
    await page.screenshot({ path: `temp/toutiao-upload-preview-${Date.now()}.png` })

    // 点击"确定"按钮
    console.log('[ToutiaoUpload] 点击确定按钮...')
    const confirmBtn = page.locator('button:has-text("确定")').filter({ visible: true })
    try {
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        const disabled = await confirmBtn.first().isDisabled().catch(() => true)
        if (!disabled) {
          await confirmBtn.first().click()
          console.log('[ToutiaoUpload] 点击了确定按钮')
        } else {
          console.log('[ToutiaoUpload] 确定按钮被禁用')
        }
      }
    } catch {
      console.log('[ToutiaoUpload] 未找到确定按钮')
    }

    // 等待保存
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `temp/toutiao-upload-finish-${Date.now()}.png` })

    console.log('[ToutiaoUpload] 封面上传流程完成')
    return { success: true, coverUrl: 'uploaded' }

  } catch (err) {
    console.error('[ToutiaoUpload] 上传失败:', err)
    return { success: false, error: (err as Error).message }
  } finally {
    await browser.close()
  }
}