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

export interface IPlatformAdapter {
  readonly meta: PlatformMeta

  init(runtime: RuntimeInterface): Promise<void>
  checkAuth(): Promise<AuthResult>
  publish(article: Article): Promise<SyncResult>
}
