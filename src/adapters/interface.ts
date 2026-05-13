/**
 * 平台适配器接口
 */
import type { RuntimeInterface } from '../runtime/index.js'

export type PlatformCapability = 'article' | 'draft' | 'image_upload'

export interface PlatformMeta {
  id: string
  name: string
  icon: string
  homepage: string
  capabilities: PlatformCapability[]
}

export interface Article {
  title: string
  markdown: string
  html?: string
  author?: string
  cover?: string
  source_url?: string
  summary?: string
  tags?: string[]
}

export interface SyncResult {
  platform: string
  success: boolean
  postId?: string
  postUrl?: string
  draftOnly?: boolean
  error?: string
  timestamp: number
}

export interface AuthResult {
  isAuthenticated: boolean
  username?: string
  userId?: string
  avatar?: string
  error?: string
}

export interface MermaidProcessResult {
  html: string
  tempFiles: string[]
}

export interface IPlatformAdapter {
  readonly meta: PlatformMeta

  init(runtime: RuntimeInterface): Promise<void>
  checkAuth(): Promise<AuthResult>

  /**
   * 可选钩子：自定义处理 Mermaid 代码块
   * 如果平台不支持原生 Mermaid 渲染，实现此方法进行转换
   * 返回处理后的 HTML 和需要清理的临时文件路径
   */
  processMermaid?(html: string): Promise<MermaidProcessResult>

  publish(article: Article): Promise<SyncResult>
}
