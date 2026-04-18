/**
 * 平台适配器基类
 * 使用模板方法模式定义发布流程骨架
 */
import type { IPlatformAdapter, Article, SyncResult, AuthResult, PlatformMeta } from './interface.js'
import type { RuntimeInterface } from '../runtime/index.js'
import { ConfigStore } from '../config.js'

export abstract class BaseAdapter implements IPlatformAdapter {
  abstract readonly meta: PlatformMeta
  protected runtime!: RuntimeInterface

  abstract init(runtime: RuntimeInterface): Promise<void>
  abstract checkAuth(): Promise<AuthResult>
  abstract publish(article: Article): Promise<SyncResult>

  /**
   * 获取 Cookie 配置键名（子类覆盖）
   */
  protected abstract getCookieConfigKey(): string

  /**
   * 构建 Cookie 字符串
   */
  protected buildCookieString(cookies: Record<string, string>): string {
    return Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  /**
   * 加载平台 Cookie
   */
  protected async loadCookies(): Promise<Record<string, string> | null> {
    const configKey = this.getCookieConfigKey()
    const getterMap: Record<string, () => Promise<Record<string, string> | null>> = {
      weibo: () => ConfigStore.getWeiboCookies(),
      bilibili: () => ConfigStore.getBilibiliCookies(),
      baijiahao: () => ConfigStore.getBaijiahaoCookies(),
      cnblogs: () => ConfigStore.getCnblogsCookies(),
      douban: () => ConfigStore.getDoubanCookies(),
      eastmoney: () => ConfigStore.getEastmoneyCookies(),
      imooc: () => ConfigStore.getImoocCookies(),
      cto51: () => ConfigStore.getCto51Cookies(),
      oschina: () => ConfigStore.getOschinaCookies(),
      segmentfault: () => ConfigStore.getSegmentfaultCookies(),
      sohu: () => ConfigStore.getSohuCookies(),
      woshipm: () => ConfigStore.getWoshipmCookies(),
      xueqiu: () => ConfigStore.getYueqiuCookies(), // xueqiu (雪球) uses yueqiu config key
      jianshu: () => ConfigStore.getJianshuCookies(),
      xiaohongshu: () => ConfigStore.getXiaohongshuCookies(),
      toutiao: () => ConfigStore.getToutiaoCookies(),
    }

    const getter = getterMap[configKey]
    if (!getter) {
      console.warn(`[${this.meta.id}] 未知的 Cookie 配置键: ${configKey}`)
      return null
    }

    return getter()
  }

  /**
   * 默认的内容转换（子类可覆盖）
   */
  protected transformContent(content: string): string {
    return content
      .replace(/<img([^>]+)src="([^"]+)"([^>]*)>/gi, '<figure><img$1src="$2"$3></figure>')
      .replace(/\s*data-(?!draft)[a-z-]+="[^"]*"/gi, '')
      .replace(/\s*style="[^"]*"/gi, '')
  }

  /**
   * 默认的通用 HTTP headers
   */
  protected getCommonHeaders(): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
    }
  }

  /**
   * 通用错误处理
   */
  protected createErrorResult(error: string, start?: number): SyncResult {
    return {
      platform: this.meta.id,
      success: false,
      error,
      timestamp: start ? Date.now() - start : 0,
    }
  }

  /**
   * 通用成功结果
   */
  protected createSuccessResult(postId: string, postUrl: string, draftOnly = true, start?: number): SyncResult {
    return {
      platform: this.meta.id,
      success: true,
      postId,
      postUrl,
      draftOnly,
      timestamp: start ? Date.now() - start : 0,
    }
  }
}
