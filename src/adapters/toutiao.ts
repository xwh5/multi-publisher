/**
 * 头条号 (Toutiao) 适配器
 * 使用 Playwright 直接操作页面发布
 */
import { chromium } from 'playwright'
import type { Article, AuthResult, PlatformMeta, SyncResult } from './interface.js'
import { ConfigStore } from '../config.js'
import { existsSync } from 'node:fs'
import path from 'node:path'

export class ToutiaoAdapter implements IPlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'toutiao',
    name: '头条号',
    icon: 'https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/bytedoctor/1.0.14/favicon.ico',
    homepage: 'https://mp.toutiao.com/',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private cookieData: Record<string, string> | null = null

  async init(): Promise<void> {
    this.cookieData = await ConfigStore.getToutiaoCookies()
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.cookieData) {
      return { isAuthenticated: false, error: '未配置头条号 Cookie' }
    }
    const hasSession = this.cookieData['sessionid'] || this.cookieData['sid_tt']
    if (!hasSession) {
      return { isAuthenticated: false, error: '登录已过期' }
    }
    return { isAuthenticated: true }
  }

  async publish(article: Article): Promise<SyncResult> {
    const start = Date.now()
    if (!this.cookieData) {
      return {
        platform: this.meta.id,
        success: false,
        error: '未配置头条号 Cookie',
        timestamp: Date.now() - start,
      }
    }

    const browser = await chromium.launch({
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
      const page = await context.newPage()

      // 使用 CDP 隐藏自动化特征
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
          window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
        `
      })

      // 设置 cookies
      const pageCookies = Object.entries(this.cookieData).map(([name, value]) => ({
        name,
        value,
        domain: '.toutiao.com',
        path: '/',
      }))
      await context.addCookies(pageCookies)

      console.log('[toutiao] 正在打开头条号编辑器...')

      await page.goto('https://mp.toutiao.com/profile_v4/graphic/publish', {
        waitUntil: 'networkidle',
        timeout: 60000
      })
      await page.waitForTimeout(3000)

      if (page.url().includes('login')) {
        return {
          platform: this.meta.id,
          success: false,
          error: '未登录或登录已过期，请重新登录',
          timestamp: Date.now() - start,
        }
      }

      // 关闭弹窗
      try {
        const mask = page.locator('.byte-drawer-mask').first()
        if (await mask.isVisible({ timeout: 1000 })) {
          await mask.click({ force: true })
          await page.waitForTimeout(500)
        }
      } catch {}

      // 填写标题
      const titleTextarea = page.locator('textarea').first()
      await titleTextarea.fill(article.title)
      console.log('[toutiao] 已填写标题')

      // 填写内容
      const contentEl = page.locator('div[contenteditable="true"]').first()
      if (await contentEl.isVisible({ timeout: 2000 }).catch(() => false)) {
        await contentEl.click()
        await page.keyboard.press('Control+a')
        await page.waitForTimeout(200)
        const htmlContent = article.html || article.markdown || ''
        await page.evaluate((el) => {
          const div = document.querySelector('[contenteditable="true"]') as HTMLDivElement
          if (div) {
            div.innerHTML = el
            div.dispatchEvent(new InputEvent('input', { bubbles: true }))
          }
        }, htmlContent)
        console.log('[toutiao] 已填写内容')
        await page.waitForTimeout(1000)
      }

      // 如果有封面图片，先上传封面再发布
      if (article.cover && existsSync(article.cover)) {
        console.log('[toutiao] 检测到封面图片，准备上传...')

        // 点击"预览并发布"按钮打开预览弹窗
        const previewBtn = page.locator('button:has-text("预览并发布")')
        if (await previewBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await previewBtn.click({ force: true })
          console.log('[toutiao] 点击预览并发布按钮')
          await page.waitForTimeout(2000)

          // 选择"单图"选项
          const singleImg = page.locator('text=单图').first()
          if (await singleImg.isVisible({ timeout: 2000 }).catch(() => false)) {
            await singleImg.click()
            console.log('[toutiao] 选择单图')
            await page.waitForTimeout(500)
          }

          // 设置 filechooser 监听
          const absolutePath = path.resolve(article.cover)
          page.on('filechooser', async (fileChooser) => {
            console.log('[toutiao] 收到 filechooser，设置封面文件')
            await fileChooser.setFiles(absolutePath)
          })

          // 点击封面添加区域
          const coverAdd = page.locator('.article-cover-add')
          if (await coverAdd.isVisible({ timeout: 2000 }).catch(() => false)) {
            await coverAdd.click({ force: true })
            console.log('[toutiao] 点击了封面添加区域')
            await page.waitForTimeout(1500)
          }

          // 点击"本地上传"
          const localUpload = page.locator('text=本地上传')
          if (await localUpload.isVisible({ timeout: 3000 }).catch(() => false)) {
            await localUpload.click()
            console.log('[toutiao] 点击本地上传')
            await page.waitForTimeout(1500)
          }

          // 点击"确定"按钮
          const confirmBtn = page.locator('button:has-text("确定")').filter({ visible: true })
          try {
            if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              const disabled = await confirmBtn.first().isDisabled().catch(() => true)
              if (!disabled) {
                await confirmBtn.first().click()
                console.log('[toutiao] 点击确定按钮，封面上传完成')
              }
            }
          } catch (e) {
            console.log('[toutiao] 确定按钮点击失败:', (e as Error).message)
          }

          // 等待封面上传保存（头条号会自动保存）
          console.log('[toutiao] 等待封面上传保存...')
          await page.waitForTimeout(5000)

          // 截图看看当前状态
          await page.screenshot({ path: 'temp/toutiao-after-cover-upload.png' })
          console.log('[toutiao] 截图已保存')
        }
      }

      // 关闭预览弹窗（如果还在的话）
      console.log('[toutiao] 尝试关闭预览弹窗...')
      try {
        // 查找关闭按钮 - 可能文本是"继续编辑"或"×"
        const continueBtn = page.locator('button:has-text("继续编辑")')
        if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await continueBtn.click({ force: true })
          console.log('[toutiao] 点击了继续编辑按钮')
          await page.waitForTimeout(2000)
        } else {
          // 尝试直接关闭
          const closeIcon = page.locator('[class*="close"], .ai-assistant-drawer-wrapper [class*="close"]')
          if (await closeIcon.isVisible({ timeout: 1000 }).catch(() => false)) {
            await closeIcon.click({ force: true })
            console.log('[toutiao] 点击了关闭图标')
            await page.waitForTimeout(1000)
          }
        }
      } catch (e) {
        console.log('[toutiao] 关闭弹窗失败:', (e as Error).message)
      }

      // 截图看看关闭弹窗后的状态
      await page.screenshot({ path: 'temp/toutiao-after-dialog-close.png' })

      // 等待编辑器稳定
      await page.waitForTimeout(2000)

      // 点击发布按钮
      console.log('[toutiao] 查找发布按钮...')
      try {
        // 尝试多种发布按钮选择器
        const publishSelectors = [
          'button:has-text("发布")',
          'button:has-text("预览并发布")',
        ]
        for (const selector of publishSelectors) {
          const btn = page.locator(selector)
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click({ force: true })
            console.log('[toutiao] 点击了:', selector)
            break
          }
        }
        await page.waitForTimeout(10000)
      } catch (e) {
        console.log('[toutiao] 发布按钮点击失败:', (e as Error).message)
      }

      const finalUrl = page.url()
      const idMatch = finalUrl.match(/[?&]id=(\d+)/)

      if (idMatch) {
        console.log('[toutiao] 保存成功，文章 ID:', idMatch[1])
        return {
          platform: this.meta.id,
          success: true,
          postId: idMatch[1],
          postUrl: `https://mp.toutiao.com/profile_v4/graphic/edit?id=${idMatch[1]}`,
          draftOnly: true,
          timestamp: Date.now() - start,
        }
      }

      console.log('[toutiao] 草稿已保存')
      return {
        platform: this.meta.id,
        success: true,
        postUrl: finalUrl,
        draftOnly: true,
        timestamp: Date.now() - start,
      }
    } catch (err) {
      console.error('[toutiao] 错误:', err)
      return {
        platform: this.meta.id,
        success: false,
        error: (err as Error).message,
        timestamp: Date.now() - start,
      }
    } finally {
      await browser.close()
    }
  }
}

import type { IPlatformAdapter } from './interface.js'