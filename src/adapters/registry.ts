/**
 * 平台适配器注册表
 * 使用注册表模式管理所有平台适配器
 */
import type { IPlatformAdapter, PlatformMeta } from './interface.js'
import { WeixinAdapter } from './weixin.js'
import { ZhihuAdapter } from './zhihu.js'
import { JuejinAdapter } from './juejin.js'
import { CSDNAdapter } from './csdn.js'
import { WeiboAdapter } from './weibo.js'
import { BilibiliAdapter } from './bilibili.js'
import { BaijiahaoAdapter } from './baijiahao.js'
import { CnblogsAdapter } from './cnblogs.js'
import { DoubanAdapter } from './douban.js'
import { EastmoneyAdapter } from './eastmoney.js'
import { ImoocAdapter } from './imooc.js'
import { OschinaAdapter } from './oschina.js'
import { SegmentfaultAdapter } from './segmentfault.js'
import { SohuAdapter } from './sohu.js'
import { WoshipmAdapter } from './woshipm.js'
import { XueqiuAdapter } from './xueqiu.js'
import { YuqueAdapter } from './yuque.js'
import { Cto51Adapter } from './cto51.js'
import { ToutiaoAdapter } from './toutiao.js'
import { XiaohongshuAdapter } from './xiaohongshu.js'
import type { RuntimeInterface } from '../runtime/index.js'

// 适配器构造函数类型
type AdapterConstructor = new () => IPlatformAdapter

// 所有适配器类
const ADAPTER_CLASSES: Record<string, AdapterConstructor> = {
  weixin: WeixinAdapter,
  zhihu: ZhihuAdapter,
  juejin: JuejinAdapter,
  csdn: CSDNAdapter,
  weibo: WeiboAdapter,
  bilibili: BilibiliAdapter,
  baijiahao: BaijiahaoAdapter,
  cnblogs: CnblogsAdapter,
  douban: DoubanAdapter,
  eastmoney: EastmoneyAdapter,
  imooc: ImoocAdapter,
  oschina: OschinaAdapter,
  segmentfault: SegmentfaultAdapter,
  sohu: SohuAdapter,
  woshipm: WoshipmAdapter,
  xueqiu: XueqiuAdapter,
  yuque: YuqueAdapter,
  cto51: Cto51Adapter,
  toutiao: ToutiaoAdapter,
  xiaohongshu: XiaohongshuAdapter,
}

/**
 * 适配器注册表
 */
class AdapterRegistry {
  private adapters: Map<string, IPlatformAdapter> = new Map()
  private runtime!: RuntimeInterface

  setRuntime(runtime: RuntimeInterface): void {
    this.runtime = runtime
  }

  /**
   * 获取所有平台元信息
   */
  getAllMeta(): PlatformMeta[] {
    return Array.from(this.adapters.values()).map(a => a.meta)
  }

  /**
   * 获取已登录的平台列表
   */
  async getLoggedInPlatforms(): Promise<PlatformMeta[]> {
    const loggedIn: PlatformMeta[] = []
    for (const adapter of this.adapters.values()) {
      const auth = await adapter.checkAuth()
      if (auth.isAuthenticated) {
        loggedIn.push(adapter.meta)
      }
    }
    return loggedIn
  }

  /**
   * 获取适配器实例
   */
  get(platformId: string): IPlatformAdapter | undefined {
    return this.adapters.get(platformId)
  }

  /**
   * 注册适配器
   */
  register(AdapterClass: AdapterConstructor): void {
    const adapter = new AdapterClass()
    this.adapters.set(adapter.meta.id, adapter)
  }

  /**
   * 初始化所有适配器
   */
  async initAll(): Promise<void> {
    for (const [id, AdapterClass] of Object.entries(ADAPTER_CLASSES)) {
      const adapter = new AdapterClass()
      await adapter.init(this.runtime)
      this.adapters.set(id, adapter)
    }
  }

  /**
   * 获取所有已注册的适配器
   */
  getAll(): Map<string, IPlatformAdapter> {
    return this.adapters
  }
}

// 全局注册表实例
export const adapterRegistry = new AdapterRegistry()

/**
 * 初始化适配器注册表
 */
export async function initAdapterRegistry(runtime: RuntimeInterface): Promise<void> {
  adapterRegistry.setRuntime(runtime)
  await adapterRegistry.initAll()
}

/**
 * 获取适配器
 */
export function getAdapter(platformId: string): IPlatformAdapter | undefined {
  return adapterRegistry.get(platformId)
}

/**
 * 获取所有已登录的平台
 */
export async function getLoggedInPlatforms(): Promise<PlatformMeta[]> {
  return adapterRegistry.getLoggedInPlatforms()
}

/**
 * 发布到多个平台
 */
export async function publishToPlatforms(
  platformIds: string[],
  article: { title: string; markdown: string; html?: string },
  onProgress?: (platform: string, result: import('./interface.js').SyncResult) => void
): Promise<import('./interface.js').SyncResult[]> {
  const results: import('./interface.js').SyncResult[] = []

  for (const platformId of platformIds) {
    const adapter = adapterRegistry.get(platformId)
    if (!adapter) {
      const errorResult: import('./interface.js').SyncResult = {
        platform: platformId,
        success: false,
        error: `未找到平台适配器: ${platformId}`,
        timestamp: Date.now(),
      }
      results.push(errorResult)
      onProgress?.(platformId, errorResult)
      continue
    }

    const result = await adapter.publish(article)
    results.push(result)
    onProgress?.(platformId, result)
  }

  return results
}
