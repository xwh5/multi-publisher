/**
 * cookie 命令 - 管理各平台 Cookie
 */
import input from '@inquirer/input'
import { ConfigStore } from '../config.js'

export async function runCookie(options: {
  platform?: string
  set?: boolean
  check?: boolean
}): Promise<void> {
  const platform = options.platform || 'zhihu'

  try {
    if (options.check) {
      const cookies = await getCookies(platform)
      if (cookies && Object.keys(cookies).length > 0) {
        console.log(`✅ ${platform} Cookie 已配置 (${Object.keys(cookies).length} 条)`)
      } else {
        console.log(`⚠️  ${platform} 未配置 Cookie`)
      }
      return
    }

    if (options.set) {
      const cookieStr = await input({
        message: `请输入 ${platform} 的完整 Cookie (从浏览器开发者工具获取):`,
      })
      if (!cookieStr.trim()) {
        console.error('Cookie 不能为空')
        process.exit(1)
      }

      // 解析 Cookie 字符串为 key-value 对象
      const cookies: Record<string, string> = {}
      cookieStr.split(';').forEach((part: string) => {
        const eqIdx = part.indexOf('=')
        if (eqIdx < 0) return
        const key = part.slice(0, eqIdx).trim()
        const valueParts = [part.slice(eqIdx + 1)]
        // 有些 Cookie 值可能包含 =，所以合并回来
        cookies[key] = valueParts.join('=').trim()
      })

      await setCookies(platform, cookies)
      console.log(`✅ ${platform} Cookie 已保存到 config.json！`)
      return
    }

    // 无参数显示帮助
    console.log(`用法:`)
    console.log(`  mpub cookie --platform ${platform} --set     设置 Cookie`)
    console.log(`  mpub cookie --platform ${platform} --check   验证 Cookie`)
  } catch (err) {
    console.error('[cookie]', (err as Error).message)
    process.exit(1)
  }
}

async function getCookies(platform: string): Promise<Record<string, string> | null> {
  switch (platform) {
    case 'zhihu':
      return ConfigStore.getZhihuCookies()
    case 'juejin':
      return ConfigStore.getJuejinCookies()
    case 'csdn':
      return ConfigStore.getCSDNCookies()
    case 'toutiao':
      return ConfigStore.getToutiaoCookies()
    default:
      return null
  }
}

async function setCookies(platform: string, cookies: Record<string, string>): Promise<void> {
  switch (platform) {
    case 'zhihu':
      return ConfigStore.setZhihuCookies(cookies)
    case 'juejin':
      return ConfigStore.setJuejinCookies(cookies)
    case 'csdn':
      return ConfigStore.setCSDNCookies(cookies)
    case 'toutiao':
      return ConfigStore.setToutiaoCookies(cookies)
    default:
      console.error(`暂不支持平台: ${platform}`)
      process.exit(1)
  }
}
