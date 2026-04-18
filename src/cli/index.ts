/**
 * CLI 入口
 */
import { Command } from 'commander'
import pkg from '../../package.json' with { type: 'json' }
import { runPublish } from './publish.js'
import { runRender } from './render.js'
import { runPlatforms } from './platforms.js'
import { runCredential } from './credential.js'
import { runCookie } from './cookie.js'
import { runLogin } from './login.js'
import { runPublishAll } from './publish-all.js'

export function createProgram() {
  const program = new Command()

  program
    .name('mpub')
    .description('Markdown → 多平台（微信公众号/知乎/掘金）CLI 发布工具')
    .version(pkg.version, '-v, --version', '输出版本号')

  // publish 命令
  const publishCmd = program.command('publish')
    .description('渲染 Markdown 并发布到平台')
    .requiredOption('-f, --file <path>', 'Markdown 文件路径（支持本地文件和 URL）')
    .option('-p, --platform <platform>', '目标平台 (weixin|zhihu|juejin|csdn)', 'weixin')
    .option('-t, --theme <theme-id>', '主题 ID', 'default')
    .option('--app-id <appId>', '微信公众号 AppID（可省略，从配置文件读取）')
    .option('--no-mac-style', '禁用 Mac 风格代码块')
    .action(runPublish)

  // render 命令
  const renderCmd = program.command('render')
    .description('渲染 Markdown 到 HTML（输出到 stdout）')
    .option('-f, --file <path>', 'Markdown 文件路径（支持本地文件和 URL）')
    .option('-t, --theme <theme-id>', '主题 ID', 'default')
    .option('-h, --highlight <theme>', '代码高亮主题', 'solarized-light')
    .option('-c, --custom-theme <path>', '自定义 CSS 主题文件路径')
    .option('--mac-style', '启用 Mac 风格代码块', true)
    .option('--no-mac-style', '禁用 Mac 风格代码块')
    .action(runRender)

  // platforms 命令
  program.command('platforms').description('列出支持发布的平台').action(runPlatforms)

  // credential 命令
  const credCmd = program.command('credential')
    .description('管理微信公众号凭据（AppID + AppSecret）')
    .option('-l, --location', '显示凭据存储路径')
    .option('-s, --set', '交互式设置凭据')
    .option('--app-id <appId>', '微信公众号 AppID')
    .option('--app-secret <appSecret>', '微信公众号 AppSecret')
    .action(runCredential)

  // cookie 命令
  const cookieCmd = program.command('cookie')
    .description('设置平台 Cookie（手动方式）')
    .requiredOption('-p, --platform <platform>', '平台名称')
    .option('--set', '交互式设置 Cookie（从浏览器复制）')
    .option('--check', '检查 Cookie 是否有效')
    .action(runCookie)

  // login 命令
  const loginCmd = program.command('login')
    .description('通过浏览器自动登录获取 Cookie')
    .option('-p, --platform <platform>', '平台名称', 'zhihu')
    .action(runLogin)

  // publish-all 命令
  const publishAllCmd = program.command('publish-all')
    .description('一键发布到所有已登录平台')
    .requiredOption('-f, --file <path>', 'Markdown 文件路径（支持本地文件和 URL）')
    .option('-t, --theme <theme-id>', '主题 ID', 'default')
    .option('-h, --highlight <theme>', '代码高亮主题', 'solarized-light')
    .option('--mac-style', '启用 Mac 风格代码块', true)
    .option('--no-mac-style', '禁用 Mac 风格代码块')
    .action(runPublishAll)

  return program
}

const program = createProgram()
program.parse(process.argv)
