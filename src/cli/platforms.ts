/**
 * platforms 命令 - 列出支持发布的平台
 */
import type { Command } from 'commander'
import { adapterRegistry, initAdapterRegistry, getLoggedInPlatforms } from '../adapters/index.js'
import { createNodeRuntime } from '../runtime/node-runtime.js'

const PLATFORM_LIST = [
  { id: 'weixin', name: '微信公众号', auth: 'AppID + AppSecret', capabilities: ['article', 'draft', 'image_upload'], note: '文章保存到草稿箱，需手动发布', status: '✅ 已验证' },
  { id: 'toutiao', name: '头条号', auth: 'Cookie', capabilities: ['article', 'draft', 'image_upload'], note: '含封面/正文图上传（2026-08-15 实测）', status: '✅ 已验证' },
  { id: 'zhihu', name: '知乎', auth: 'Cookie', capabilities: ['article', 'draft'], note: '适配器就绪，待实测', status: '🔄 待测试' },
  { id: 'juejin', name: '掘金', auth: 'Cookie', capabilities: ['article', 'draft'], note: '适配器就绪，待实测', status: '🔄 待测试' },
  { id: 'csdn', name: 'CSDN', auth: 'Cookie', capabilities: ['article', 'draft', 'image_upload'], note: '适配器就绪，待实测', status: '🔄 待测试' },
  { id: 'xiaohongshu', name: '小红书', auth: 'Cookie', capabilities: ['article', 'draft'], note: '适配器就绪，待实测', status: '🔄 待测试' },
  { id: 'qq', name: '企鹅号', auth: 'Cookie', capabilities: ['article', 'draft', 'image_upload'], note: '适配器就绪，待实测', status: '🔄 待测试' },
  { id: 'weibo', name: '微博', auth: 'Cookie', capabilities: ['article', 'draft'], note: '适配器就绪，待实测', status: '🔄 待测试' },
  { id: 'bilibili', name: 'B站', auth: 'Cookie', capabilities: ['article', 'draft'], note: '适配器就绪，待实测', status: '🔄 待测试' },
]

export async function runPlatforms(): Promise<void> {
  console.log(`\n🖥️  支持的平台（共 ${PLATFORM_LIST.length} 个）：\n`)
  console.log('状态说明：')
  console.log('  ✅ 已验证 - 登录和发布功能已测试通过')
  console.log('  🔄 待测试 - Cookie 登录支持，但发布功能尚未测试\n')

  for (const p of PLATFORM_LIST) {
    console.log(`  ${p.name} (${p.id}) ${p.status}`)
    console.log(`    认证方式: ${p.auth}`)
    console.log(`    支持功能: ${p.capabilities.join(', ')}`)
    console.log(`    说明: ${p.note}`)
    console.log()
  }
}
