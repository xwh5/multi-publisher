/**
 * 统一配置管理 - 所有平台配置存在单一 config.json
 *
 * 文件路径: ~/.config/multi-publisher/config.json
 *
 * 迁移: 首次启动时自动从旧文件(credential.json/token.json/cookies/)合并数据
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

function getConfigDir(): string {
  // 优先使用用户目录下的 .config 路径，Windows 上为 C:\Users\<user>\.config
  return path.join(os.homedir(), '.config', 'multi-publisher')
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json')
}

export interface WeixinConfig {
  appId?: string
  appSecret?: string
  access_token?: string
  token_expires_at?: number   // Unix ms
}

export interface ZhihuConfig {
  cookies?: Record<string, string>
}

export interface JuejinConfig {
  cookies?: Record<string, string>
}

export interface CSDNConfig {
  cookies?: Record<string, string>
}

export interface ToutiaoConfig {
  cookies?: Record<string, string>
}

export interface JianshuConfig {
  cookies?: Record<string, string>
}

export interface WeiboConfig {
  cookies?: Record<string, string>
}

export interface XiaohongshuConfig {
  cookies?: Record<string, string>
}

export interface BaijiahaoConfig {
  cookies?: Record<string, string>
}

export interface BilibiliConfig {
  cookies?: Record<string, string>
}

export interface SegmentfaultConfig {
  cookies?: Record<string, string>
}

export interface CnblogsConfig {
  cookies?: Record<string, string>
}

export interface OschinaConfig {
  cookies?: Record<string, string>
}

export interface ImoocConfig {
  cookies?: Record<string, string>
}

export interface Cto51Config {
  cookies?: Record<string, string>
}

export interface YueqiuConfig {
  cookies?: Record<string, string>
}

export interface WoshipmConfig {
  cookies?: Record<string, string>
}

export interface DoubanConfig {
  cookies?: Record<string, string>
}

export interface SohuConfig {
  cookies?: Record<string, string>
}

export interface EastmoneyConfig {
  cookies?: Record<string, string>
}

export interface QQConfig {
  cookies?: Record<string, string>
}

export interface GlobalConfig {
  version: number
  weixin?: WeixinConfig
  zhihu?: ZhihuConfig
  juejin?: JuejinConfig
  csdn?: CSDNConfig
  toutiao?: ToutiaoConfig
  jianshu?: JianshuConfig
  weibo?: WeiboConfig
  xiaohongshu?: XiaohongshuConfig
  baijiahao?: BaijiahaoConfig
  bilibili?: BilibiliConfig
  segmentfault?: SegmentfaultConfig
  cnblogs?: CnblogsConfig
  oschina?: OschinaConfig
  imooc?: ImoocConfig
  cto51?: Cto51Config
  yueqiu?: YueqiuConfig
  woshipm?: WoshipmConfig
  douban?: DoubanConfig
  sohu?: SohuConfig
  eastmoney?: EastmoneyConfig
  qq?: QQConfig
  // 其他平台继续扩展
}

let configCache: GlobalConfig | null = null

async function ensureDir(): Promise<void> {
  try { await fs.mkdir(getConfigDir(), { recursive: true }) } catch {}
}

/** 读取配置（带缓存） */
export async function loadConfig(): Promise<GlobalConfig> {
  if (configCache) return configCache
  const filePath = getConfigPath()
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    configCache = JSON.parse(content)
    return configCache!
  } catch {
    configCache = { version: 1 }
    return configCache
  }
}

/** 写配置（立即刷盘，清缓存） */
async function saveConfig(config: GlobalConfig): Promise<void> {
  await ensureDir()
  configCache = config
  const filePath = getConfigPath()
  const tmp = filePath + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8')
  await fs.rename(tmp, filePath)
}

/** 原子更新配置（读取-修改-写入） */
export async function updateConfig(updater: (c: GlobalConfig) => void): Promise<void> {
  const config = await loadConfig()
  updater(config)
  await saveConfig(config)
}

/** 迁移旧版分散文件到 config.json */
export async function migrateLegacyConfig(): Promise<boolean> {
  const dir = getConfigDir()
  const newConfigPath = getConfigPath()

  // 检查是否已有新配置文件
  try { await fs.access(newConfigPath); return false } catch {}

  const oldFiles: Array<{ path: string; key: string; parser: (raw: unknown) => unknown }> = [
    { path: path.join(dir, 'credential.json'), key: 'weixin', parser: (raw) => {
      const r = raw as Record<string, string>
      return { appId: r.appId || r.app_id, appSecret: r.appSecret || r.app_secret }
    }},
    { path: path.join(dir, 'token.json'), key: 'weixin', parser: (raw) => raw as Partial<WeixinConfig> },
  ]

  let hasLegacy = false
  const merged: GlobalConfig = { version: 1 }

  for (const { path: filePath, key, parser } of oldFiles) {
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      const parsed = parser(raw) as Record<string, unknown>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = merged as unknown as Record<string, Record<string, unknown> | undefined>
      const existing = m[key] || {}
      m[key] = Object.assign({}, existing, parsed)
      hasLegacy = true
    } catch { /* no legacy file, skip */ }
  }

  // 迁移 cookies/*.json
  const cookiesDir = path.join(dir, 'cookies')
  try {
    const files = await fs.readdir(cookiesDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const platform = file.replace('.json', '')
      const raw = JSON.parse(await fs.readFile(path.join(cookiesDir, file), 'utf-8'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = merged as any
      m[platform] = { cookies: raw.cookies || raw }
      hasLegacy = true
    }
  } catch { /* no cookies dir, skip */ }

  if (!hasLegacy) return false

  await saveConfig(merged)
  return true
}

/** 统一配置管理器（各平台 publisher 内部使用） */
export class ConfigStore {
  /** 获取微信配置 */
  static async getWeixin(): Promise<WeixinConfig> {
    const config = await loadConfig()
    return config.weixin || {}
  }

  /** 更新微信配置 */
  static async setWeixin(update: Partial<WeixinConfig>): Promise<void> {
    await updateConfig((c) => {
      c.weixin = { ...c.weixin, ...update }
    })
  }

  /** 获取知乎 Cookie */
  static async getZhihuCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.zhihu?.cookies || null
  }

  /** 设置知乎 Cookie */
  static async setZhihuCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.zhihu = { ...c.zhihu, cookies }
    })
  }

  /** 获取掘金 Cookie */
  static async getJuejinCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.juejin?.cookies || null
  }

  /** 设置掘金 Cookie */
  static async setJuejinCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.juejin = { ...c.juejin, cookies }
    })
  }

  /** 获取 CSDN Cookie */
  static async getCSDNCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.csdn?.cookies || null
  }

  /** 设置 CSDN Cookie */
  static async setCSDNCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.csdn = { ...c.csdn, cookies }
    })
  }

  /** 获取头条号 Cookie */
  static async getToutiaoCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.toutiao?.cookies || null
  }

  /** 设置头条号 Cookie */
  static async setToutiaoCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.toutiao = { ...c.toutiao, cookies }
    })
  }

  /** 获取简书 Cookie */
  static async getJianshuCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.jianshu?.cookies || null
  }

  /** 设置简书 Cookie */
  static async setJianshuCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.jianshu = { ...c.jianshu, cookies }
    })
  }

  /** 获取微博 Cookie */
  static async getWeiboCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.weibo?.cookies || null
  }

  /** 设置微博 Cookie */
  static async setWeiboCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.weibo = { ...c.weibo, cookies }
    })
  }

  /** 获取小红书 Cookie */
  static async getXiaohongshuCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.xiaohongshu?.cookies || null
  }

  /** 设置小红书 Cookie */
  static async setXiaohongshuCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.xiaohongshu = { ...c.xiaohongshu, cookies }
    })
  }

  /** 获取百家号 Cookie */
  static async getBaijiahaoCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.baijiahao?.cookies || null
  }

  /** 设置百家号 Cookie */
  static async setBaijiahaoCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.baijiahao = { ...c.baijiahao, cookies }
    })
  }

  /** 获取B站 Cookie */
  static async getBilibiliCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.bilibili?.cookies || null
  }

  /** 设置B站 Cookie */
  static async setBilibiliCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.bilibili = { ...c.bilibili, cookies }
    })
  }

  /** 获取思否 Cookie */
  static async getSegmentfaultCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.segmentfault?.cookies || null
  }

  /** 设置思否 Cookie */
  static async setSegmentfaultCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.segmentfault = { ...c.segmentfault, cookies }
    })
  }

  /** 获取博客园 Cookie */
  static async getCnblogsCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.cnblogs?.cookies || null
  }

  /** 设置博客园 Cookie */
  static async setCnblogsCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.cnblogs = { ...c.cnblogs, cookies }
    })
  }

  /** 获取开源中国 Cookie */
  static async getOschinaCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.oschina?.cookies || null
  }

  /** 设置开源中国 Cookie */
  static async setOschinaCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.oschina = { ...c.oschina, cookies }
    })
  }

  /** 获取慕课网 Cookie */
  static async getImoocCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.imooc?.cookies || null
  }

  /** 设置慕课网 Cookie */
  static async setImoocCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.imooc = { ...c.imooc, cookies }
    })
  }

  /** 获取 51CTO Cookie */
  static async getCto51Cookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.cto51?.cookies || null
  }

  /** 设置 51CTO Cookie */
  static async setCto51Cookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.cto51 = { ...c.cto51, cookies }
    })
  }

  /** 获取雪球 Cookie */
  static async getYueqiuCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.yueqiu?.cookies || null
  }

  /** 设置雪球 Cookie */
  static async setYueqiuCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.yueqiu = { ...c.yueqiu, cookies }
    })
  }

  /** 获取人人都是产品经理 Cookie */
  static async getWoshipmCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.woshipm?.cookies || null
  }

  /** 设置人人都是产品经理 Cookie */
  static async setWoshipmCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.woshipm = { ...c.woshipm, cookies }
    })
  }

  /** 获取豆瓣 Cookie */
  static async getDoubanCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.douban?.cookies || null
  }

  /** 设置豆瓣 Cookie */
  static async setDoubanCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.douban = { ...c.douban, cookies }
    })
  }

  /** 获取搜狐 Cookie */
  static async getSohuCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.sohu?.cookies || null
  }

  /** 设置搜狐 Cookie */
  static async setSohuCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.sohu = { ...c.sohu, cookies }
    })
  }

  /** 获取东方财富 Cookie */
  static async getEastmoneyCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.eastmoney?.cookies || null
  }

  /** 设置东方财富 Cookie */
  static async setEastmoneyCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.eastmoney = { ...c.eastmoney, cookies }
    })
  }

  /** 获取企鹅号 Cookie */
  static async getQQCookies(): Promise<Record<string, string> | null> {
    const config = await loadConfig()
    return config.qq?.cookies || null
  }

  /** 设置企鹅号 Cookie */
  static async setQQCookies(cookies: Record<string, string>): Promise<void> {
    await updateConfig((c) => {
      c.qq = { ...c.qq, cookies }
    })
  }

  /** 获取配置目录路径 */
  static getDir(): string {
    return getConfigDir()
  }
}
