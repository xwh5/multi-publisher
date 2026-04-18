/**
 * platforms 命令 - 列出支持发布的平台
 */
import type { Command } from 'commander'

export async function runPlatforms(): Promise<void> {
  const platforms = [
    {
      id: 'weixin',
      name: '微信公众号',
      auth: 'AppID + AppSecret',
      capabilities: ['article', 'draft', 'image_upload'],
      note: '文章保存到草稿箱，需手动发布',
    },
    {
      id: 'zhihu',
      name: '知乎',
      auth: 'Cookie',
      capabilities: ['article', 'draft'],
      note: '支持 Markdown 直接发布',
    },
    {
      id: 'juejin',
      name: '掘金',
      auth: 'Cookie',
      capabilities: ['article', 'draft'],
      note: '支持 Markdown 直接发布',
    },
    {
      id: 'csdn',
      name: 'CSDN',
      auth: 'Cookie',
      capabilities: ['article', 'draft', 'image_upload'],
      note: '支持 Markdown 直接发布',
    },
  ]

  console.log('\n🖥️  支持的平台：\n')
  for (const p of platforms) {
    console.log(`  ${p.name} (${p.id})`)
    console.log(`    认证方式: ${p.auth}`)
    console.log(`    支持功能: ${p.capabilities.join(', ')}`)
    console.log(`    说明: ${p.note}`)
    console.log()
  }
}
