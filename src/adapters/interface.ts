/**
 * 平台适配器接口
 */
import type { RuntimeInterface } from '../runtime/index.js'

export type PlatformCapability = 'article' | 'draft' | 'image_upload' | 'image_post'

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
  /** Markdown 文件所在目录，用于解析相对路径图片 */
  baseDir?: string
  /**
   * 真发表（不可逆）而不是只进草稿箱。
   * 仅在 CLI 显式 --publish-now 时为 true；适配器仍须先保存草稿（可回退）再发表。
   */
  publishNow?: boolean
}

/** 图文帖（小红书形态）：标题 + 图集 + 短正文 + 标签 */
export interface ImagePost {
  title: string
  body: string
  tags: string[]
  images: string[]
  cover?: string
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

  /**
   * 可选钩子：发布图文帖（小红书形态）。
   * 只有 capabilities 含 'image_post' 的平台才实现；默认只存草稿，
   * 真发布要显式传 publishNow（不可撤销的平台需要这道闸门）。
   */
  publishImagePost?(post: ImagePost, options?: { publishNow?: boolean }): Promise<SyncResult>
  /**
   * 发表**已有草稿**（按标题定位），不重新渲染、不重复入库。
   * 用途：草稿已在箱里（人工或前一次命令放进去的），要真发表时用这条路径。
   * 成功判定必须可回查（例：草稿箱里这篇消失了）。
   */
  publishDraftByTitle?(title: string): Promise<SyncResult>
}
