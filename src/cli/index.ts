#!/usr/bin/env node
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
import { runCapture } from './capture.js'
import { runXhsPackage } from './xhs-package.js'
import { runDoctor } from './doctor.js'
import { runList } from './list.js'
import { runPublishDraft } from './publish-draft.js'
import { runUpdateDraft, runPublishWeixinDraft, publishWeixinViaBackend } from './weixin-draft.js'
import { runDeleteDraft } from './delete-draft.js'
import { runXhs, runXhsPublish } from './xhs.js'
import { runMetrics } from './metrics.js'
import { runDaily } from './daily.js'

export function createProgram() {
  const program = new Command()

  /** 收集可重复的 -i/--image 参数 */
  const collectImages = (value: string, previous: string[]): string[] => [...previous, value]
  /** 收集可重复的 --tag 参数 */
  const collectTags = (value: string, previous: string[]): string[] => [...previous, value]

  program
    .name('mpub')
    .description('Markdown → 多平台（微信公众号/知乎/掘金）CLI 发布工具')
    .version(pkg.version, '-v, --version', '输出版本号')

  // publish 命令
  const publishCmd = program.command('publish')
    .description('渲染 Markdown 并发布到平台')
    .option('-f, --file <path>', 'Markdown 文件路径（支持本地文件和 URL）；图文包用 --package')
    .option('-p, --platform <platform>', '目标平台 (weixin|zhihu|juejin|csdn)', 'weixin')
    .option('-t, --theme <theme-id>', '主题 ID', 'default')
    .option('-m, --cover-mode <mode>', '封面模式 (sharp|network|auto)', 'auto')
    .option('--app-id <appId>', '微信公众号 AppID（可省略，从配置文件读取）')
    .option('--no-mac-style', '禁用 Mac 风格代码块')
    .option('--auto-cover', '当文章无封面图时，根据标题自动从网络获取封面')
    .option('--package <dir>', '图文包目录（小红书等图文平台；配合 mpub xhs-package 产出）')
    .option('--via-script <path>', '外部投递脚本：把发布交给带闸门的脚本执行（如查重/检查/回查）')
    .option('--publish-now', '图文包路径：真发布（默认只存草稿；小红书发布不可撤销）')
    .option('--json', '输出 JSON（{ok,data}）')
    .option('--no-first-claim', '不声明「头条首发」（内容若已在别的平台发过，必须关掉，否则是假声明）')
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

  // xhs-package 命令
  const xhsCmd = program.command('xhs-package')
    .description('把 Markdown 转成小红书发布包（图集+短标题+短正文+标签），不直接投递')
    .requiredOption('-f, --file <path>', 'Markdown 文件路径')
    .option('-o, --out <dir>', '输出目录（默认 dist/xhs/<文件名>）')
    .option('-i, --image <path>', '图集图片（可重复指定）', collectImages, [])
    .option('-c, --cover <path>', '封面图')
    .action(runXhsPackage)

  // publish-all 命令
  const publishAllCmd = program.command('publish-all')
    .description('一键发布到所有已登录平台')
    .option('-f, --file <path>', 'Markdown 文件路径（支持本地文件和 URL）；图文包用 --package')
    .option('-t, --theme <theme-id>', '主题 ID', 'default')
    .option('-h, --highlight <theme>', '代码高亮主题', 'solarized-light')
    .option('--mac-style', '启用 Mac 风格代码块', true)
    .option('--no-mac-style', '禁用 Mac 风格代码块')
    .action(runPublishAll)

  // doctor 命令：平台凭据/能力体检（凭据存在 ≠ 可用，必须发真实请求）
  program
    .command('doctor')
    .description('体检各平台凭据与可用性（真实请求探测，不看本地配置）')
    .option('--json', '输出 JSON（{ok,data}）')
    .option('-p, --platform <platform>', '只查指定平台')
    .action(runDoctor)

  // list 命令：回读平台状态（草稿 / 粉丝）
  const listCmd = program
    .command('list')
    .description('回读平台状态')
    .argument('<what>', '要回读什么：drafts（草稿）| fans（粉丝）')
    .option('-p, --platform <platform>', '平台 (toutiao|weixin)', 'toutiao')
    .option('-n, --count <number>', '条数', '20')
    .option('--backend', '走平台后台读（公众号粉丝数：API 无权限，只能读后台）')
    .option('--json', '输出 JSON（{ok,data}）')
    .action((what: string, opts) => runList(what, opts))

  // publish-draft 命令：发表已有草稿（不重渲染，发表后可回查）
  program
    .command('publish-draft')
    .description('发表草稿箱里已有的一篇（按标题定位；草稿会从箱里消失）')
    .requiredOption('-t, --title <title>', '草稿标题（可给前 10 字）')
    .option('-p, --platform <platform>', '平台', 'toutiao')
    .option('--json', '输出 JSON（{ok,data}）')
    .action(runPublishDraft)

  // delete-draft 命令：删草稿（公众号）
  program
    .command('delete-draft')
    .description('删除草稿（公众号按 media_id，头条按标题；小红书无删除接口）')
    .option('--media-id <id>', '草稿 media_id（公众号）')
    .option('-t, --title <title>', '草稿标题（头条号，按标题定位）')
    .option('-p, --platform <platform>', '平台 (weixin|toutiao|xiaohongshu)', 'weixin')
    .option('--json', '输出 JSON（{ok,data}）')
    .action(runDeleteDraft)

  // update-draft 命令：改草稿内容（改完仍在箱里，发表仍需人工点）
  program
    .command('update-draft')
    .description('用新的 Markdown 更新草稿内容（保留原封面）')
    .requiredOption('--media-id <id>', '草稿 media_id')
    .requiredOption('-f, --file <path>', '新的 Markdown 文件')
    .option('--json', '输出 JSON（{ok,data}）')
    .action(runUpdateDraft)

  // publish-weixin 命令：调发表 API（订阅号通常无权限→如实报错给人工路径）
  program
    .command('publish-weixin')
    .description('发表公众号草稿：默认走 API（订阅号 48001）；--backend 走后台 UI 点发表')
    .option('--media-id <id>', '草稿 media_id（API 模式）')
    .option('-t, --title <title>', '草稿标题（后台模式）')
    .option('--backend', '走公众号后台 UI 点「发表」（需先 mpub login -p weixin 扫码）')
    .option('--yes', '确认发表（对外动作，后台模式必须加）')
    .option('--open', '顺便把编辑页在浏览器里打开（默认只给直达链接）')
    .option('--json', '输出 JSON（{ok,data}）')
    .action((opts) => {
      if (opts.backend) return publishWeixinViaBackend(opts)
      return runPublishWeixinDraft(opts)
    })

  // xhs 命令：小红书 MCP 工具直通（mpub 当 MCP 客户端）
  const xhsToolsCmd = program
    .command('xhs')
    .description('小红书：直连本地 xiaohongshu-mcp 的工具（status / tools / call）')
    .argument('<what>', 'status（登录与健康）| tools（工具清单）| call（调用某个工具）')
    .argument('[tool]', 'call 时指定工具名')
    .option('--args <json>', '工具参数（JSON 字符串）')
    .option('--yes', '写操作确认（发布/评论/点赞/收藏等不可撤销的写操作必须加）')
    .option('--json', '输出 JSON（{ok,data}）')
    .action((what: string, tool: string | undefined, opts) => runXhs(what, tool, opts))

  // metrics 命令：一次拉齐三平台运营数字（只读）
  program
    .command('metrics')
    .description('一次拉齐三平台运营数字（粉丝/草稿/笔记数，只读）')
    .option('--json', '输出 JSON（{ok,data}）')
    .action(runMetrics)

  // daily 命令：每天的运营动作一条命令（体检→今日待发→拉数→回填→报告）
  program
    .command('daily')
    .description('每天的运营动作：读排期、拉三平台数字、回填 metrics、报异常')
    .option('--plan <file>', '排期 JSON（{date,items:[{time,platform,title,action}]}）')
    .option('--metrics <file>', '要回填的 metrics.csv')
    .option('--date <YYYY-MM-DD>', '按哪一天看（默认今天）')
    .option('--json', '输出 JSON（{ok,data}）')
    .action(runDaily)

  // xhs publish 子命令：发小红书图文 + 发布后回查
  const xhsPublish = xhsToolsCmd
    .command('publish')
    .description('发一篇小红书图文（发完自动回查主页；笔记不可删，务必确认后再发）')
    .requiredOption('--title <title>', '标题（≤20 字）')
    .option('--body-file <path>', '正文文件（≤1000 字）')
    .option('--body <text>', '正文（直接给）')
    .option('-i, --image <path>', '图片（可重复，至少 1 张）', collectImages, [])
    .option('--tag <tag>', '话题标签（可重复）', collectTags, [])
    .option('--visibility <v>', '可见范围（公开可见/仅自己可见/仅互关好友可见）')
    .option('--is-original', '声明原创')
    .option('--yes', '确认发表（不可撤销）')
    .option('--json', '输出 JSON（{ok,data}）')
    .action((opts) => runXhsPublish(opts));

  // capture 命令
  const captureCmd = program.command('capture')
    .description('抓包工具 - 打开浏览器并拦截上传请求')
    .option('-p, --platform <platform>', '平台名称 (csdn|juejin|zhihu|toutiao|weibo)', 'csdn')
    .option('-t, --timeout <seconds>', '超时时间（秒）', '60')
    .action(runCapture)

  return program
}

const program = createProgram()
program.parse(process.argv)
