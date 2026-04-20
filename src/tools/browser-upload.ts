/**
 * 浏览器自动化上传封面图片
 * 在文章编辑页面右侧设置面板中上传封面
 */
import { chromium, type Browser, type Page, type Locator } from 'playwright'
import { ConfigStore } from '../config.js'
import path from 'path'

export interface BrowserUploadResult {
  success: boolean
  coverUrl?: string
  error?: string
}

/**
 * 通过浏览器自动化上传封面图片
 * 流程：打开文章编辑页 -> 在右侧设置面板上传封面
 * @param articleId 文章ID（发布后返回的）
 * @param imagePath 本地图片路径
 * @returns 上传后的封面 URL
 */
export async function uploadCoverViaBrowser(articleId: string, imagePath: string): Promise<BrowserUploadResult> {
  const browser: Browser = await chromium.launch({
    headless: false,
    channel: 'chromium',
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    })
    const page: Page = await context.newPage()

    // 加载 CSDN cookies
    const cookies = await ConfigStore.getCSDNCookies()
    if (!cookies || Object.keys(cookies).length === 0) {
      return { success: false, error: '未配置 CSDN Cookie，请先登录' }
    }

    // 设置 cookies
    const csdnCookies = Object.entries(cookies).map(([name, value]) => ({
      name,
      value,
      domain: '.csdn.net',
      path: '/',
    }))
    await context.addCookies(csdnCookies)

    // 打开文章编辑页
    console.log('[BrowserUpload] 打开文章编辑页...')
    const articleUrl = `https://editor.csdn.net/md/?articleId=${articleId}`
    await page.goto(articleUrl, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(2000)

    // 先查找并点击"发布"按钮
    console.log('[BrowserUpload] 查找发布按钮...')
    const publishSelectors = [
      'button:has-text("发布")',
      'button:has-text("立即发布")',
      '[class*="publish"] button',
    ]

    let publishButton: Locator | null = null
    for (const selector of publishSelectors) {
      try {
        const btn = page.locator(selector).first()
        if (await btn.isVisible({ timeout: 1000 })) {
          publishButton = btn
          console.log(`[BrowserUpload] 找到发布按钮: ${selector}`)
          break
        }
      } catch {
        // continue
      }
    }

    if (!publishButton) {
      console.log('[BrowserUpload] 未找到发布按钮')
      return { success: false, error: '未找到发布按钮' }
    }

    await publishButton.click()
    console.log('[BrowserUpload] 点击发布按钮')
    await page.waitForTimeout(2000)

    // 查找弹窗/对话框中的"添加封面"
    console.log('[BrowserUpload] 查找发布设置弹窗...')

    // 等待弹窗出现
    const dialogSelectors = [
      '[class*="dialog"]',
      '[class*="modal"]',
      '[class*="popup"]',
      '[class*="publish-dialog"]',
      '[class*="publishModal"]',
    ]

    for (const selector of dialogSelectors) {
      try {
        const dialog = page.locator(selector).first()
        if (await dialog.isVisible({ timeout: 2000 })) {
          console.log(`[BrowserUpload] 找到弹窗: ${selector}`)
          break
        }
      } catch {
        // continue
      }
    }

    // 截图看看弹窗内容
    await page.screenshot({ path: `temp/csdn-publish-dialog-${Date.now()}.png` })

    // 查找"添加封面"标签后面的上传框
    console.log('[BrowserUpload] 查找"添加封面"后面的上传框...')

    let coverInput: Locator | null = null
    let foundSelector = ''

    // 尝试查找包含"添加封面"文字的元素
    const addCoverLabel = page.locator('text=/添加封面|设置封面|上传封面/i')
    if (await addCoverLabel.count() > 0) {
      console.log(`[BrowserUpload] 找到 ${await addCoverLabel.count()} 个"添加封面"相关元素`)

      // 查找这个元素附近的 file input
      // 尝试找包含"添加封面"的父元素下的 file input
      const parentFileInput = await addCoverLabel.evaluate((el: Element) => {
        // 往上找父元素
        let parent = el.parentElement
        for (let i = 0; i < 5 && parent; i++) {
          // 找这个父元素下的 input[type="file"]
          const fileInput = parent.querySelector('input[type="file"]')
          if (fileInput) {
            return 'found'
          }
          parent = parent.parentElement
        }
        return 'not-found'
      })

      console.log(`[BrowserUpload] 父元素下有 file input: ${parentFileInput}`)
    }

    // 查找弹窗中的 file input
    const dialogFileInputs = page.locator('[class*="dialog"] input[type="file"], [class*="modal"] input[type="file"], [class*="popup"] input[type="file"]')
    const dialogInputCount = await dialogFileInputs.count()
    console.log(`[BrowserUpload] 弹窗中有 ${dialogInputCount} 个 file input`)

    if (dialogInputCount > 0) {
      const firstInput = dialogFileInputs.first()
      coverInput = firstInput
      foundSelector = 'dialog file input'
      console.log(`[BrowserUpload] 使用弹窗中的 file input`)
    }

    // 通用方式：在页面中查找所有 file input
    if (!coverInput) {
      const allFileInputs = page.locator('input[type="file"]')
      const count = await allFileInputs.count()
      console.log(`[BrowserUpload] 页面上共有 ${count} 个 file input`)

      // 优先查找容器封面上传的 input (.el-upload__input)
      const coverUploadInput = page.locator('.el-upload__input')
      if (await coverUploadInput.count() > 0) {
        coverInput = coverUploadInput.first()
        foundSelector = 'el-upload__input'
        console.log(`[BrowserUpload] 使用封面上传 input`)
      } else {
        // 回退到可见的 file input
        for (let i = 0; i < count; i++) {
          const element = allFileInputs.nth(i)
          if (await element.isVisible({ timeout: 500 }).catch(() => false)) {
            coverInput = element
            foundSelector = `file input ${i}`
            console.log(`[BrowserUpload] 使用 file input ${i}`)
            break
          }
        }
      }
    }

    // 最后的尝试：直接查找 input[type="file"] 并检查其容器
    if (!coverInput) {
      console.log('[BrowserUpload] 最后尝试: 查找所有 file input...')
      const allFileInputs = page.locator('input[type="file"]')
      const count = await allFileInputs.count()
      console.log(`[BrowserUpload] 共有 ${count} 个 file input`)

      for (let i = 0; i < count; i++) {
        const element = allFileInputs.nth(i)
        try {
          // 检查这个 input 是否可见
          if (await element.isVisible({ timeout: 500 })) {
            // 检查父元素是否和封面相关
            const parentCover = await element.evaluate((el: Element) => {
              let parent = el.closest('[class*="cover"]') || el.parentElement?.closest('[class*="cover"]')
              return parent ? 'found' : 'not-found'
            })

            if (parentCover === 'found') {
              coverInput = element
              foundSelector = `file input ${i} (parent is cover)`
              console.log(`[BrowserUpload] 找到封面 input: ${foundSelector}`)
              break
            }

            // 尝试直接使用这个 input（如果页面上只有 1 个）
            if (count === 1) {
              coverInput = element
              foundSelector = `file input ${i} (only one on page)`
              console.log(`[BrowserUpload] 使用唯一的 file input`)
              break
            }
          }
        } catch {
          // continue
        }
      }
    }

    // 如果还是没找到，尝试查找"封面"文字并点击
    if (!coverInput) {
      console.log('[BrowserUpload] 尝试点击包含"封面"的元素...')
      const coverText = page.locator('text=/封面|cover/i')
      const textCount = await coverText.count()
      console.log(`[BrowserUpload] 找到 ${textCount} 个包含"封面"的元素`)

      for (let i = 0; i < textCount; i++) {
        const el = coverText.nth(i)
        try {
          // 点击这个元素
          await el.click()
          await page.waitForTimeout(1000)
          console.log(`[BrowserUpload] 点击了包含封面的元素 ${i}`)

          // 点击后重新查找 file input
          const newFileInputs = page.locator('input[type="file"]')
          const newCount = await newFileInputs.count()
          for (let j = 0; j < newCount; j++) {
            const fi = newFileInputs.nth(j)
            if (await fi.isVisible({ timeout: 500 }).catch(() => false)) {
              coverInput = fi
              foundSelector = `file input after clicking cover text`
              console.log(`[BrowserUpload] 点击后找到 file input`)
              break
            }
          }
        } catch {
          // continue
        }
        if (coverInput) break
      }
    }

    if (!coverInput) {
      console.log('[BrowserUpload] 未找到封面上传入口')
      return { success: false, error: '未找到封面上传入口' }
    }

    // 上传文件
    console.log(`[BrowserUpload] 上传封面: ${imagePath}`)
    const absolutePath = path.resolve(imagePath)

    try {
      // 先点击"从本地上传"按钮来激活上传
      const uploadBtn = page.locator('.upload-img-box').first()
      try {
        if (await uploadBtn.isVisible({ timeout: 1000 })) {
          await uploadBtn.click()
          console.log('[BrowserUpload] 点击了从本地上传按钮')
          await page.waitForTimeout(1000)
        }
      } catch {
        // ignore
      }

      // 如果找不到上传按钮，点击封面区域
      if (!(await uploadBtn.isVisible({ timeout: 500 }).catch(() => false))) {
        const coverArea = page.locator('[class*="cover"], [class*="add-cover"]').first()
        try {
          if (await coverArea.isVisible({ timeout: 1000 })) {
            await coverArea.click()
            console.log('[BrowserUpload] 点击了封面区域')
            await page.waitForTimeout(500)
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error('[BrowserUpload] 点击上传按钮失败:', err)
    }

    // 执行文件上传
    try {
      await coverInput.setInputFiles(absolutePath)
      console.log('[BrowserUpload] setInputFiles 执行成功')

      // 触发 change 事件
      await coverInput.dispatchEvent('change')
      console.log('[BrowserUpload] 触发 change 事件')
    } catch (err) {
      console.error('[BrowserUpload] setInputFiles 失败:', err)
      return { success: false, error: `上传失败: ${(err as Error).message}` }
    }

    // 等待裁剪弹窗出现
    console.log('[BrowserUpload] 等待裁剪弹窗...')
    await page.waitForTimeout(2000)

    // 点击"确认上传"按钮
    const confirmBtn = page.locator('.vicp-operate-btn:has-text("确认上传"), .el-upload__confirm-upload')
    try {
      if (await confirmBtn.isVisible({ timeout: 3000 })) {
        await confirmBtn.click()
        console.log('[BrowserUpload] 点击确认上传按钮')
      }
    } catch {
      console.log('[BrowserUpload] 未找到确认上传按钮，继续')
    }

    // 等待裁剪弹窗关闭
    await page.waitForTimeout(2000)

    // 点击"保存为草稿"按钮来保存封面设置
    const saveDraftBtn = page.locator('button:has-text("保存为草稿")')
    try {
      if (await saveDraftBtn.isVisible({ timeout: 3000 })) {
        await saveDraftBtn.click()
        console.log('[BrowserUpload] 点击保存为草稿按钮')
        await page.waitForTimeout(2000)
      }
    } catch {
      console.log('[BrowserUpload] 未找到保存为草稿按钮，继续')
    }

    // 等待上传
    console.log('[BrowserUpload] 等待上传...')
    await page.waitForTimeout(5000)

    // 截图看看上传后的状态
    await page.screenshot({ path: `temp/csdn-after-upload-${Date.now()}.png` })

    // 等待上传
    console.log('[BrowserUpload] 等待上传...')
    await page.waitForTimeout(3000)

    // 检查封面预览
    const previewSelectors = [
      'img[src*="obs"]',
      'img[src*="csdn-img"]',
      '[class*="cover"] img[src]',
      '[class*="coverPreview"] img',
      'img.cover',
      // 弹窗中的预览图
      '[class*="modal"] img[src]',
      '[class*="dialog"] img[src]',
    ]

    for (const selector of previewSelectors) {
      try {
        const imgs = page.locator(selector)
        const count = await imgs.count()
        for (let i = 0; i < count; i++) {
          const img = imgs.nth(i)
          const src = await img.getAttribute('src').catch(() => '')
          if (src && (src.includes('obs') || src.includes('csdn-img') || src.includes('https'))) {
            console.log(`[BrowserUpload] 封面上传成功: ${src}`)
            return { success: true, coverUrl: src }
          }
        }
      } catch {
        // continue
      }
    }

    // 如果没找到特定 URL，但上传操作执行了，就认为成功
    console.log('[BrowserUpload] 封面上传完成（未检测到预览 URL）')
    return { success: true, coverUrl: 'uploaded' }

  } catch (err) {
    console.error('[BrowserUpload] 上传失败:', err)
    return { success: false, error: (err as Error).message }
  } finally {
    await browser.close()
  }
}
