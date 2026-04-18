/**
 * login 命令 - 通过浏览器自动登录获取 Cookie
 */
import type { Command } from 'commander'
import { loginPlatform, PLATFORM_LOGIN_CONFIGS } from '../runtime/browser-runtime.js'
import { ConfigStore } from '../config.js'

export async function runLogin(options: {
  platform?: string
}): Promise<void> {
  const platformId = options.platform || 'zhihu'

  // 检查是否支持该平台
  const config = PLATFORM_LOGIN_CONFIGS[platformId]
  if (!config) {
    console.error(`❌ 不支持的平台: ${platformId}`)
    console.log(`\n支持的平台:`)
    for (const [id, cfg] of Object.entries(PLATFORM_LOGIN_CONFIGS)) {
      console.log(`  - ${id}: ${cfg.name}`)
    }
    return
  }

  console.log(`🚀 开始 ${config.name} 登录流程...\n`)

  try {
    // 执行登录
    const result = await loginPlatform(platformId)

    if (result.success && Object.keys(result.cookies).length > 0) {
      // 保存 Cookie 到配置文件
      await saveCookies(platformId, result.cookies)
      console.log(`✅ ${config.name} Cookie 已保存！`)
      console.log(`   共 ${Object.keys(result.cookies).length} 个 cookie`)
    } else {
      console.error(`❌ 登录失败: ${result.error || '未知错误'}`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`❌ 登录过程出错:`, (err as Error).message)
    process.exit(1)
  }
}

async function saveCookies(platformId: string, cookies: Record<string, string>): Promise<void> {
  switch (platformId) {
    case 'zhihu':
      await ConfigStore.setZhihuCookies(cookies)
      break
    case 'juejin':
      await ConfigStore.setJuejinCookies(cookies)
      break
    case 'csdn':
      await ConfigStore.setCSDNCookies(cookies)
      break
    case 'jianshu':
      await ConfigStore.setJianshuCookies(cookies)
      break
    case 'weibo':
      await ConfigStore.setWeiboCookies(cookies)
      break
    case 'xiaohongshu':
      await ConfigStore.setXiaohongshuCookies(cookies)
      break
    case 'toutiao':
      await ConfigStore.setToutiaoCookies(cookies)
      break
    case 'baijiahao':
      await ConfigStore.setBaijiahaoCookies(cookies)
      break
    case 'bilibili':
      await ConfigStore.setBilibiliCookies(cookies)
      break
    case 'segmentfault':
      await ConfigStore.setSegmentfaultCookies(cookies)
      break
    case 'cnblogs':
      await ConfigStore.setCnblogsCookies(cookies)
      break
    case 'oschina':
      await ConfigStore.setOschinaCookies(cookies)
      break
    case 'imooc':
      await ConfigStore.setImoocCookies(cookies)
      break
    case 'xueqiu':
      await ConfigStore.setYueqiuCookies(cookies)
      break
    case 'woshipm':
      await ConfigStore.setWoshipmCookies(cookies)
      break
    case 'douban':
      await ConfigStore.setDoubanCookies(cookies)
      break
    case 'sohu':
      await ConfigStore.setSohuCookies(cookies)
      break
    case 'eastmoney':
      await ConfigStore.setEastmoneyCookies(cookies)
      break
    case 'yuque':
      // 语雀使用 OAuth，Cookie 方式不支持
      console.warn(`⚠️  语雀仅支持 OAuth 登录，请使用 wechatsync 浏览器扩展`)
      break
    case 'cto51':
      await ConfigStore.setCto51Cookies(cookies)
      break
    default:
      console.warn(`⚠️  尚未为 ${platformId} 实现 Cookie 保存，请手动保存`)
  }
}
