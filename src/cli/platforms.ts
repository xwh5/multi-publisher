/**
 * platforms 命令 - 列出支持发布的平台
 */
import type { Command } from 'commander'
import { adapterRegistry, initAdapterRegistry, getLoggedInPlatforms } from '../adapters/index.js'
import { createNodeRuntime } from '../runtime/node-runtime.js'

const PLATFORM_LIST = [
  { id: 'weixin', name: '微信公众号', auth: 'AppID + AppSecret', capabilities: ['article', 'draft', 'image_upload'], note: '文章保存到草稿箱，需手动发布', status: '✅ 已验证' },
  { id: 'zhihu', name: '知乎', auth: 'Cookie', capabilities: ['article', 'draft'], note: '支持 Markdown 直接发布', status: '✅ 已验证' },
  { id: 'juejin', name: '掘金', auth: 'Cookie', capabilities: ['article', 'draft'], note: '支持 Markdown 直接发布', status: '✅ 已验证' },
  { id: 'csdn', name: 'CSDN', auth: 'Cookie', capabilities: ['article', 'draft', 'image_upload'], note: '支持 Markdown 直接发布', status: '✅ 已验证' },
  { id: 'jianshu', name: '简书', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'weibo', name: '微博', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'xiaohongshu', name: '小红书', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'toutiao', name: '头条号', auth: 'Cookie', capabilities: ['article', 'draft'], note: '有反爬机制', status: '🔄 待测试' },
  { id: 'baijiahao', name: '百家号', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'bilibili', name: 'B站', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'segmentfault', name: '思否', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'cnblogs', name: '博客园', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'oschina', name: '开源中国', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'imooc', name: '慕课网', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'xueqiu', name: '雪球', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'woshipm', name: '人人都是产品经理', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'douban', name: '豆瓣', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'sohu', name: '搜狐号', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'eastmoney', name: '东方财富', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
  { id: 'cto51', name: '51CTO', auth: 'Cookie', capabilities: ['article', 'draft'], note: 'Cookie 登录支持', status: '🔄 待测试' },
]

export async function runPlatforms(): Promise<void> {
  console.log('\n🖥️  支持的平台（共 20 个）：\n')
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
