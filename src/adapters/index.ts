/**
 * 适配器统一导出
 */
export type { IPlatformAdapter, PlatformMeta, Article, SyncResult, AuthResult, PlatformCapability } from './interface.js'
export { BaseAdapter } from './base-adapter.js'
export { WeixinAdapter } from './weixin.js'
export { ZhihuAdapter } from './zhihu.js'
export { JuejinAdapter } from './juejin.js'
export { CSDNAdapter } from './csdn.js'
export { WeiboAdapter } from './weibo.js'
export { BilibiliAdapter } from './bilibili.js'
export { ToutiaoAdapter } from './toutiao.js'
export { XiaohongshuAdapter } from './xiaohongshu.js'
export { adapterRegistry, initAdapterRegistry, getAdapter, getLoggedInPlatforms, publishToPlatforms } from './registry.js'
