/**
 * credential 命令 - 管理微信公众号凭据
 */
import { ConfigStore } from '../config.js'

export async function runCredential(options: {
  location?: boolean
  set?: boolean
  appId?: string
  appSecret?: string
}): Promise<void> {
  try {
    if (options.location) {
      console.log(ConfigStore.getDir() + '/config.json')
      return
    }

    if (options.set || options.appId) {
      const appId = options.appId ?? ''
      const appSecret = options.appSecret ?? ''
      if (!appId || !appSecret) {
        console.error('请提供 --app-id 和 --app-secret')
        process.exit(1)
      }
      await ConfigStore.setWeixin({ appId: appId.trim(), appSecret: appSecret.trim() })
      console.log('✅ 微信公众号凭据已保存到 config.json！')
      return
    }

    // 无参数时显示帮助
    console.log('用法:')
    console.log('  mpub credential --location                      显示配置文件路径')
    console.log('  mpub credential --set                           交互式设置凭据')
    console.log('  mpub credential --app-id <id> --app-secret <secret>  直接设置凭据')
  } catch (err) {
    console.error('[credential]', (err as Error).message)
    process.exit(1)
  }
}
