/**
 * Playwright 浏览器运行时
 * 用于自动登录获取 Cookie
 */
import { chromium, type Browser, type Page, type Cookie } from 'playwright'

export interface PlatformLoginConfig {
  /** 平台 ID */
  id: string
  /** 平台名称 */
  name: string
  /** 登录页面 URL */
  loginUrl: string
  /** 登录成功检测方式 */
  successCondition: {
    /** 检测 URL 变化（登录后跳转的 URL） */
    urlPattern?: string | RegExp
    /** 检测 DOM 元素出现 */
    selector?: string
    /** 检测 Cookie 名称 */
    cookieName?: string
    /** 等待时间（毫秒），如果设置了则等待指定时间后自动完成 */
    waitMs?: number
  }
  /** 额外的 Cookie 域名 */
  extraCookieDomains?: string[]
}

export interface LoginResult {
  success: boolean
  cookies: Record<string, string>
  error?: string
}

/**
 * 浏览器运行时管理器
 */
export class BrowserRuntime {
  private browser: Browser | null = null
  private page: Page | null = null

  /**
   * 打开浏览器并导航到登录页面
   * 使用用户默认浏览器配置文件，保持登录状态
   */
  async open(loginConfig: PlatformLoginConfig): Promise<void> {
    console.log(`正在启动浏览器...`)
    this.browser = await chromium.launch({
      headless: false, // 需要可见浏览器让用户登录
      channel: 'chromium', // 使用用户的默认 Chrome 配置
    })
    // 不创建新context，让Playwright使用默认context，保持已登录状态
    this.page = await this.browser.newPage()
    // 注意：不清理 cookies，使用用户已有的登录状态

    console.log(`打开登录页面: ${loginConfig.loginUrl}`)
    await this.page.goto(loginConfig.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  }

  /**
   * 等待用户完成登录
   */
  async waitForLogin(config: PlatformLoginConfig): Promise<LoginResult> {
    if (!this.page) {
      return { success: false, cookies: {}, error: '浏览器未启动' }
    }

    const { successCondition, extraCookieDomains = [] } = config
    const allDomains = [new URL(config.loginUrl).hostname, ...extraCookieDomains]

    try {
      // 先检查是否已经登录（cookies已存在）
      if (successCondition.cookieName) {
        const existingCookies = await this.page.context().cookies()
        const hasCookie = existingCookies.some(c => c.name === successCondition.cookieName)
        if (hasCookie) {
          console.log(`检测到已登录（Cookie ${successCondition.cookieName} 已存在）`)
        }
      }

      if (successCondition.waitMs) {
        // 方式1：等待特定 Cookie 出现，最多等待 waitMs 时间
        console.log(`等待 ${successCondition.waitMs / 1000} 秒让用户完成登录...`)
        await this.waitForCookieOrTimeout(successCondition.cookieName!, successCondition.waitMs)
      } else if (successCondition.selector) {
        // 方式2：等待 DOM 元素出现
        console.log(`等待元素: ${successCondition.selector}`)
        await this.page.waitForSelector(successCondition.selector, { timeout: 0 })
      } else if (successCondition.urlPattern) {
        // 方式3：等待 URL 变化
        const currentUrl = this.page.url()
        console.log(`等待登录完成，当前 URL: ${currentUrl}`)
        await this.page.waitForURL(successCondition.urlPattern, { timeout: 0 })
      } else if (successCondition.cookieName) {
        // 方式4：等待特定 Cookie 出现（无限等待）
        console.log(`等待 Cookie: ${successCondition.cookieName}`)
        await this.waitForCookie(successCondition.cookieName)
      } else {
        // 默认：等待页面稳定
        console.log(`等待页面稳定...`)
        await this.page.waitForLoadState('networkidle')
      }

      // 获取所有相关域名的 cookies
      // 先获取整个 context 的所有 cookies（不过滤域名），因为 cookie 可能被设置在各种子域上
      const allCookies = await this.page.context().cookies()
      console.log(`[调试] 共获取到 ${allCookies.length} 个 cookies（不过滤域名）`)
      for (const c of allCookies) {
        console.log(`  - ${c.name}=${c.value.substring(0, 20)}... (domain=${c.domain}, path=${c.path})`)
      }

      // 过滤出目标域名的 cookies
      const cookies: Record<string, string> = {}
      for (const cookie of allCookies) {
        // 匹配主域名和其子域名
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
        const matchesMainDomain = allDomains.some(d => {
          const main = d.startsWith('.') ? d.slice(1) : d
          return cookieDomain === main || cookieDomain.endsWith('.' + main)
        })
        if (matchesMainDomain || cookieDomain.includes('zhihu') || cookieDomain.includes('juejin')) {
          cookies[cookie.name] = cookie.value
        }
      }

      console.log(`[调试] 过滤后剩余 ${Object.keys(cookies).length} 个 cookies`)

      // 检查是否获取到了有效的 cookies
      const hasCookies = Object.keys(cookies).length > 0
      const expectedCookieFound = successCondition.cookieName ? !!cookies[successCondition.cookieName] : hasCookies

      if (!hasCookies || !expectedCookieFound) {
        return {
          success: false,
          cookies,
          error: hasCookies ? `未找到预期的登录 Cookie (${successCondition.cookieName})` : '未获取到任何 Cookie'
        }
      }

      return { success: true, cookies }
    } catch (err) {
      return { success: false, cookies: {}, error: (err as Error).message }
    }
  }

  /**
   * 等待特定 Cookie 出现
   */
  private async waitForCookie(cookieName: string): Promise<void> {
    if (!this.page) return

    const checkCookie = async () => {
      const cookies = await this.page!.context().cookies()
      return cookies.some(c => c.name === cookieName)
    }

    while (!(await checkCookie())) {
      await this.page.waitForTimeout(1000)
      console.log('.')
    }
  }

  /**
   * 等待特定 Cookie 出现，带超时
   */
  private async waitForCookieOrTimeout(cookieName: string, timeoutMs: number): Promise<boolean> {
    if (!this.page) return false

    const startTime = Date.now()
    const checkCookie = async () => {
      const cookies = await this.page!.context().cookies()
      return cookies.some(c => c.name === cookieName)
    }

    while (!(await checkCookie())) {
      if (Date.now() - startTime > timeoutMs) {
        console.log(`\n等待超时（${timeoutMs / 1000} 秒），继续尝试获取 Cookie...`)
        return false
      }
      await this.page.waitForTimeout(1000)
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      console.log(`已等待 ${elapsed} 秒，等待登录完成...`)
    }
    return true
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.page = null
    }
  }

  /**
   * 获取当前页面（供外部使用）
   */
  getPage(): Page | null {
    return this.page
  }

  /**
   * 获取当前页面的 cookies
   */
  async getCookies(domains?: string[]): Promise<Record<string, string>> {
    if (!this.page) return {}

    const cookies: Record<string, string> = {}
    const targets = domains || [new URL(this.page.url()).hostname]

    for (const domain of targets) {
      try {
        const pageCookies = await this.page.context().cookies(domain)
        for (const cookie of pageCookies) {
          cookies[cookie.name] = cookie.value
        }
      } catch {
        // 忽略无效域名
      }
    }

    return cookies
  }

  /**
   * 检测是否已登录（通过检查是否存在登录 Cookie）
   */
  async checkLogin(config: PlatformLoginConfig): Promise<boolean> {
    if (!this.page) return false

    const { cookieName } = config.successCondition
    if (!cookieName) return false

    const cookies = await this.getCookies([new URL(config.loginUrl).hostname])
    return !!cookies[cookieName]
  }
}

/**
 * 预配置的平台登录信息
 */
export const PLATFORM_LOGIN_CONFIGS: Record<string, PlatformLoginConfig> = {
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    loginUrl: 'https://www.zhihu.com/',
    successCondition: {
      cookieName: 'z_c0',
      waitMs: 60000, // 等待 60 秒让用户完成操作（扫码等）
    },
    extraCookieDomains: ['.zhihu.com', 'api.zhihu.com'],
  },
  juejin: {
    id: 'juejin',
    name: '掘金',
    loginUrl: 'https://juejin.cn/',
    successCondition: {
      cookieName: 'uid_tt',
      waitMs: 60000,
    },
    extraCookieDomains: ['.juejin.cn', 'api.juejin.cn'],
  },
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    loginUrl: 'https://www.csdn.net/',
    successCondition: {
      cookieName: 'UserName',
      waitMs: 60000,
    },
    extraCookieDomains: ['.csdn.net', 'bizapi.csdn.net'],
  },
  jianshu: {
    id: 'jianshu',
    name: '简书',
    loginUrl: 'https://www.jianshu.com/',
    successCondition: {
      cookieName: 'remember_user_token',
      waitMs: 60000,
    },
    extraCookieDomains: ['.jianshu.com'],
  },
  weibo: {
    id: 'weibo',
    name: '微博',
    loginUrl: 'https://weibo.com/',
    successCondition: {
      cookieName: 'SUB',
      waitMs: 60000,
    },
    extraCookieDomains: ['.weibo.com', '.sina.com.cn'],
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    name: '小红书',
    loginUrl: 'https://creator.xiaohongshu.com/',
    successCondition: {
      cookieName: 'galaxy_creator_session_id',
      waitMs: 60000,
    },
    extraCookieDomains: ['.xiaohongshu.com', '.edith.xiaohongshu.com'],
  },
  toutiao: {
    id: 'toutiao',
    name: '头条号',
    loginUrl: 'https://mp.toutiao.com/',
    successCondition: {
      cookieName: 'sessionid',
      waitMs: 60000,
    },
    extraCookieDomains: ['.toutiao.com', '.douyin.com'],
  },
  baijiahao: {
    id: 'baijiahao',
    name: '百家号',
    loginUrl: 'https://baijiahao.baidu.com/',
    successCondition: {
      cookieName: 'BDUSS',
      waitMs: 60000,
    },
    extraCookieDomains: ['.baidu.com', '.hao123.com'],
  },
  bilibili: {
    id: 'bilibili',
    name: 'B站',
    loginUrl: 'https://www.bilibili.com/',
    successCondition: {
      cookieName: 'SESSDATA',
      waitMs: 60000,
    },
    extraCookieDomains: ['.bilibili.com', 'api.bilibili.com'],
  },
  segmentfault: {
    id: 'segmentfault',
    name: '思否',
    loginUrl: 'https://segmentfault.com/',
    successCondition: {
      cookieName: 'sa_user',
      waitMs: 60000,
    },
    extraCookieDomains: ['.segmentfault.com'],
  },
  cnblogs: {
    id: 'cnblogs',
    name: '博客园',
    loginUrl: 'https://www.cnblogs.com/',
    successCondition: {
      cookieName: '.CNBlogsCookie',
      waitMs: 60000,
    },
    extraCookieDomains: ['.cnblogs.com'],
  },
  oschina: {
    id: 'oschina',
    name: '开源中国',
    loginUrl: 'https://www.oschina.net/',
    successCondition: {
      cookieName: 'oscid',
      waitMs: 60000,
    },
    extraCookieDomains: ['.oschina.net'],
  },
  imooc: {
    id: 'imooc',
    name: '慕课网',
    loginUrl: 'https://www.imooc.com/',
    successCondition: {
      cookieName: 'imooc_uuid',
      waitMs: 60000,
    },
    extraCookieDomains: ['.imooc.com'],
  },
  xueqiu: {
    id: 'xueqiu',
    name: '雪球',
    loginUrl: 'https://xueqiu.com/',
    successCondition: {
      cookieName: 'xq_a_token',
      waitMs: 60000,
    },
    extraCookieDomains: ['.xueqiu.com'],
  },
  woshipm: {
    id: 'woshipm',
    name: '人人都是产品经理',
    loginUrl: 'https://www.woshipm.com/',
    successCondition: {
      cookieName: 'woshipm_user',
      waitMs: 60000,
    },
    extraCookieDomains: ['.woshipm.com'],
  },
  douban: {
    id: 'douban',
    name: '豆瓣',
    loginUrl: 'https://www.douban.com/',
    successCondition: {
      cookieName: 'ck',
      waitMs: 60000,
    },
    extraCookieDomains: ['.douban.com', '.douban.fm'],
  },
  sohu: {
    id: 'sohu',
    name: '搜狐号',
    loginUrl: 'https://mp.sohu.com/',
    successCondition: {
      cookieName: 'SUV',
      waitMs: 60000,
    },
    extraCookieDomains: ['.sohu.com'],
  },
  eastmoney: {
    id: 'eastmoney',
    name: '东方财富',
    loginUrl: 'https://www.eastmoney.com/',
    successCondition: {
      cookieName: 'qgqp_b_id',
      waitMs: 60000,
    },
    extraCookieDomains: ['.eastmoney.com'],
  },
  yuque: {
    id: 'yuque',
    name: '语雀',
    loginUrl: 'https://www.yuque.com/',
    successCondition: {
      cookieName: 'yuque_token',
      waitMs: 60000,
    },
    extraCookieDomains: ['.yuque.com'],
  },
  cto51: {
    id: 'cto51',
    name: '51CTO',
    loginUrl: 'https://blog.51cto.com/',
    successCondition: {
      cookieName: 'app_id',
      waitMs: 60000,
    },
    extraCookieDomains: ['.51cto.com', '.cto51.com'],
  },
  qq: {
    id: 'qq',
    name: '企鹅号',
    loginUrl: 'https://om.qq.com/',
    successCondition: {
      cookieName: 'userid',
      waitMs: 60000,
    },
    extraCookieDomains: ['.qq.com', '.om.qq.com'],
  },
}

/**
 * 执行平台登录
 */
export async function loginPlatform(platformId: string): Promise<LoginResult> {
  const config = PLATFORM_LOGIN_CONFIGS[platformId]
  if (!config) {
    return { success: false, cookies: {}, error: `不支持的平台: ${platformId}` }
  }

  // 先检查配置中是否已有保存的 cookies（从之前登录获取）
  const savedCookies = loadSavedCookies(platformId)
  if (savedCookies && Object.keys(savedCookies).length > 0) {
    // 验证 cookies 是否仍然有效
    console.log(`检测到已保存的 ${Object.keys(savedCookies).length} 个 cookies，正在验证...`)
    const runtime = new BrowserRuntime()
    try {
      await runtime.open(config)
      // 设置已有 cookies 到浏览器上下文
      const cookies = Object.entries(savedCookies).map(([name, value]) => ({
        name,
        value,
        domain: new URL(config.loginUrl).hostname,
        path: '/',
      }))
      await runtime.getPage()?.context().addCookies(cookies)

      // 检查是否仍然有效
      const isLoggedIn = await runtime.checkLogin(config)
      if (isLoggedIn) {
        console.log(`✅ ${config.name} 已经登录有效！`)
        await runtime.close()
        return { success: true, cookies: savedCookies }
      } else {
        console.log(`⚠️  已保存的 cookies 已过期，需要重新登录...`)
        await runtime.close()
      }
    } catch {
      await runtime.close()
    }
  }

  // 没有有效 cookies，需要用户登录
  const runtime = new BrowserRuntime()

  try {
    // 打开浏览器
    await runtime.open(config)

    console.log(`
========================================
请在打开的浏览器中完成登录操作！

平台: ${config.name}
提示: ${config.successCondition.waitMs ? `等待 ${config.successCondition.waitMs / 1000} 秒后超时（足够完成扫码登录）` : '等待登录成功后自动完成'}
提示: 如果已经是登录状态，请手动刷新页面
========================================
`)

    // 等待登录完成
    const result = await runtime.waitForLogin(config)

    if (result.success) {
      console.log(`✅ ${config.name} 登录成功！`)
    } else {
      console.log(`❌ ${config.name} 登录失败: ${result.error}`)
    }

    return result
  } finally {
    await runtime.close()
  }
}

/**
 * 从配置文件加载保存的 cookies
 */
function loadSavedCookies(platformId: string): Record<string, string> | null {
  try {
    const { ConfigStore } = require('../config.js')
    switch (platformId) {
      case 'zhihu': return ConfigStore.getZhihuCookies()
      case 'juejin': return ConfigStore.getJuejinCookies()
      case 'csdn': return ConfigStore.getCSDNCookies()
      case 'jianshu': return ConfigStore.getJianshuCookies()
      case 'weibo': return ConfigStore.getWeiboCookies()
      case 'xiaohongshu': return ConfigStore.getXiaohongshuCookies()
      case 'toutiao': return ConfigStore.getToutiaoCookies()
      case 'baijiahao': return ConfigStore.getBaijiahaoCookies()
      case 'bilibili': return ConfigStore.getBilibiliCookies()
      case 'segmentfault': return ConfigStore.getSegmentfaultCookies()
      case 'cnblogs': return ConfigStore.getCnblogsCookies()
      case 'oschina': return ConfigStore.getOschinaCookies()
      case 'imooc': return ConfigStore.getImoocCookies()
      case 'xueqiu': return ConfigStore.getYueqiuCookies()
      case 'woshipm': return ConfigStore.getWoshipmCookies()
      case 'douban': return ConfigStore.getDoubanCookies()
      case 'sohu': return ConfigStore.getSohuCookies()
      case 'eastmoney': return ConfigStore.getEastmoneyCookies()
      case 'cto51': return ConfigStore.getCto51Cookies()
      default: return null
    }
  } catch {
    return null
  }
}
