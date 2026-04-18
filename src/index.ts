/**
 * Multi-Publisher CLI - 主入口
 */
export { createProgram } from './cli/index.js'
export { renderMarkdown } from './core/renderer.js'
export type { RenderOptions, RenderResult } from './core/renderer.js'
export { WeixinAdapter } from './adapters/weixin.js'
export { ZhihuAdapter } from './adapters/zhihu.js'
