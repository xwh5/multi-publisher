---
title: AI 写完文章，一键发布全网
author: xwh5
summary: 我做了一个 CLI 工具，把 Markdown 一键发布到微信公众号、知乎、掘金、CSDN 等 20+ 平台，支持 AI 对接，全程不需要开浏览器。
tags: [技术, CLI, 效率工具, TypeScript, AI]
---

# AI 写完文章，一键发布全网

写技术博客的人大概都有过这种体验：花了大半天把文章写好、排版舒服了，然后开始逐个平台复制粘贴——微信公众号、知乎、掘金、CSDN……每个平台的富文本编辑器规则不一样，代码块样式要调，图片要手动上传，一套下来一小时没了。

这个痛点早就有人注意到了。

---

## 市面上已有的方案

**Wechatsync** 是我了解到最接近的东西。这是一个浏览器插件，连接各大平台后可以同步文章。它的思路是自动填充表单——打开目标平台的编辑器，它帮你把内容填进去。

但这个方案有个问题：依赖浏览器。如果要和 AI 对接，目前主流做法是通过 MCP（Model Context Protocol）操作浏览器插件。这意味着 AI 发一篇文章，背后要经历：AI → MCP Server → 浏览器插件 → 平台页面。这个链条不稳定，浏览器要开着，页面不能崩，网络不能抖。一次两次可以，靠它日常发布总觉得差点意思。

**wenyan-cli** 是另一个工具，专注于微信公众号，命令行方式，做得挺扎实。但只支持一个平台，排版能力也有限。

市面上的工具多少都有这个或那个局限。我不知道是不是还有我没了解到的方案，如果你在用类似的工具，欢迎推荐。

---

## 我的做法

我的需求是：**和 AI 对接，让 AI 帮我写文章、发布文章，全程不需要开浏览器。**

要对接 AI，CLI 是最自然的方式。AI 调用命令行，命令行调用平台 API，没有浏览器这一层，稳定性靠得住。

所以有了 [multi-publisher](https://www.npmjs.com/package/multi-publisher)：一个命令行工具，输入 Markdown，输出各个平台可直接发布的富文本。支持微信公众号、知乎、掘金、CSDN 等 20+ 平台。

---

## 技术方案

TypeScript + Node.js，没用什么特殊技术。`tsc` 编译，直接输出 ES Modules，不打包、不合并、不压缩。透明，也简单。

### 核心设计：适配器模式

每个平台是一个 adapter，实现统一接口：

```typescript
interface IPlatformAdapter {
  readonly meta: PlatformMeta
  init(runtime: RuntimeInterface): Promise<void>
  checkAuth(): Promise<AuthResult>
  publish(article: Article): Promise<SyncResult>
}
```

新增一个平台，只要实现这个接口，注册到适配器注册表里就行。适配器之间互不干扰，调试一个平台不影响其他平台。

### 渲染管道

```
Markdown 文件
    │
    ▼
┌──────────────┐    ┌──────────────┐    ┌────────────┐
│  parser.ts   │───▶│ renderer.ts  │───▶│ styler.ts  │
│  front-matter│    │ AST → HTML   │    │ CSS 内联    │
│  Markdown解析│    │ 代码高亮/LaTeX│    │ 主题应用    │
└──────────────┘    └──────────────┘    └────────────┘
```

用 `marked` 解析 Markdown，`highlight.js` 做代码高亮，`juice` 做 CSS 内联，`mathjax-full` 处理 LaTeX 公式。渲染完的结果，根据各平台 API 的要求做转换——比如微信公众号要把图片上传到微信服务器换成 `media_id`。

主题系统做了 14 套 CSS，渲染时用 `-t` 参数指定。`default`、`wechat`、`cyberpunk`、`nord`、`brutalism`……各有风格。

---

## 认证方案：各平台的坑比想象中多

跨平台发布最麻烦的不是排版，是**认证**。

### 微信公众号：唯一有官方开发者 API 的平台

微信公众号有完整的开发者接口，配置好 AppID + AppSecret 就能调用 `access_token`，发布草稿、上传图片都有对应 API。这是所有平台里最规范的，接入成本最低。

### 其他平台：没有官方 API，只能用 Cookie

知乎、掘金、CSDN……这些平台都没有开放"通过开发者账号发布文章"的接口。它们面向的是普通用户，没有开放 OAuth 或 token 认证方式。

但它们都有 Cookie 认证——登录后浏览器里带着的 Cookie，服务器认这个。所以方案是：

1. **Playwright 驱动浏览器自动登录**，让用户扫码/输入账号，Playwright 把登录态的 Cookie 抓出来
2. **Cookie 存到本地**，后续发布时带上这些 Cookie 调用平台 API
3. Cookie 过期了就重新跑一次登录流程

这个方案不优雅，但目前是唯一可行的路。

### Playwright 自动登录怎么做的

以知乎为例：

```
运行 mpub login -p zhihu
    │
    ▼
Playwright 启动一个 Chrome 窗口（headless: false，用户可见）
    │
    ▼
打开知乎登录页 zhihu.com
    │
    ▼
用户扫码/输入账号登录
    │
    ▼
检测到登录成功（URL 变化或指定 Cookie 出现）
    │
    ▼
抓取当前域名的所有 Cookie
    │
    ▼
保存到 ~/.config/multi-publisher/config.json
```

每个平台的登录检测逻辑不同，有的靠 URL 跳转判断，有的靠特定 Cookie 出现，有的靠 DOM 元素。各个平台各自适配。

### 凭据怎么存

所有平台的凭据存在一个文件里：

```
~/.config/multi-publisher/config.json
```

Windows 上相当于 `C:\Users\<user>\.config\multi-publisher\config.json`。

文件结构：

```json
{
  "version": 1,
  "weixin": {
    "appId": "wx...",
    "appSecret": "...",
    "access_token": "...",
    "token_expires_at": 1745000000000
  },
  "zhihu": {
    "cookies": {
      "z_c0": "...",
      "uid_tt": "..."
    }
  },
  "juejin": {
    "cookies": { "uid_tt": "...", "tt_author_token": "..." }
  }
}
```

微信公众号特殊一点，有 `access_token` 和过期时间，token 过期了会自动刷新。其他平台就是纯 Cookie，Cookie 过期了就重新 `mpub login -p xxx`。

---

## 发布到 npm 踩的 8 个坑

工具做完了，接下来发到 npm。这个过程折腾了两天，踩了 8 个坑，记录下来供参考。

### 坑 1：workflow 文件名不一致

最早的 workflow 叫 `publish.yaml`，npm 后台 Trusted Publisher 配置填的是 `publish.yml`。差了一个字母，OIDC 验证一直失败。npm 那边根本不告诉你哪里对不上，只会说"认证失败"。最后对着文件名一个个字母核对才发现。

### 坑 2：NODE_AUTH_TOKEN 干扰 OIDC 认证

我想用 OIDC 方式发布（不需要手动存 token），但 GitHub Actions 会自动把 `GITHUB_TOKEN` 映射为 `NODE_AUTH_TOKEN` 环境变量。npm CLI 优先使用这个变量，OIDC 交换出来的 session token 就被忽略了，报 `ENEEDAUTH`。

解决：显式清空这个变量。

```yaml
env:
  NODE_AUTH_TOKEN: ''  # 关键：清空自动注入的 token
```

### 坑 3：npm 版本太低（最费时间的一个）

最开始用 `node-version: '20'`，自带 npm 10.9.7。这个版本的 npm 声称支持 OIDC，但 token 交换流程有 bug——sigstore 签名生成成功，npm 却返回 401。

尝试在 CI 里升级 npm：
- `npx npm@latest install -g`：只装了 1 个包，npm 版本没变
- `npm install -g npm@11`：报错 `MODULE_NOT_FOUND`，promise-retry 在 Runner 镜像里找不到

最后发现只能**直接用 Node 24**，自带 npm 11.11.0，OIDC 才真正工作。Node 20/22 都不行。

### 坑 4：repository 字段缺失

OIDC 发布必须加 `--provenance`，npm 会验证 `package.json` 里的 `repository.url` 是否和实际 GitHub 仓库匹配。我一开始这个字段是空的，报错：

```
package.json: "repository.url" is "",
expected to match "https://github.com/xwh5/multi-publisher"
```

解决：

```json
"repository": {
  "type": "git",
  "url": "https://github.com/xwh5/multi-publisher"
}
```

必须是完整对象格式，不能是空字符串。

### 坑 5：permissions.id-token 权限不够

最初写了 `permissions.contents: read`，OIDC token 请求直接失败。需要 `id-token: write` 才能向 npm 的 OIDC Provider 请求身份 token。

### 坑 6：Granular Token 的 2FA 问题

没用 OIDC 之前试过 npm Token 方式发布。创建了 Granular Access Token，但发布时报 403：需要 2FA。

需要在 npm 后台创建 Token 时勾选 "Allow 2FA bypass for CI/CD"，否则每次发布都要 OTP。

### 坑 7：Recovery Token 不能用于发布

Recovery Token 设计上就不能用于 API 发布操作，只能做账户恢复。

### 坑 8：Windows 上 CLI 命令打开文件而非执行

npm 包发上去后，用户反映 `mpub --version` 没有输出版本号，而是打开了 `index.js` 源码文件。

TypeScript 编译输出的 `dist/cli/index.js` 第一行是 `/**` 注释，不是 shebang。Windows 系统看到 `.js` 文件没有 shebang，不知道要用 `node` 执行，就把它当成普通文本打开。

解决：在 `src/cli/index.ts` 顶部加一行 shebang，TypeScript 编译后会原样保留。

```typescript
#!/usr/bin/env node
/**
 * CLI 入口
 */
```

---

## 最终可用的配置

### GitHub Actions workflow

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Publish to npm
        run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ''

  create-release:
    runs-on: ubuntu-latest
    needs: publish
    permissions:
      contents: write
    steps:
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref }}
          generate_release_notes: true
```

配置好之后，只要推送 `v*` 标签，就会自动构建、发布，全程不需要手动 token 操作。

### npm Trusted Publisher 配置

在 npm 后台 Settings → Access → Trusted Publishers 添加：

- Owner: 你的 npm 用户名
- Repository name: `multi-publisher`
- Workflow filename: `publish.yml`
- Environment name：（留空）

---

## 怎么用

```bash
# 安装
npm install -g multi-publisher

# 配置微信公众号凭据（首次需要）
mpub credential --app-id <your-app-id> --app-secret <your-app-secret>

# 发布文章（默认到微信公众号草稿箱）
mpub publish -f article.md

# 指定平台
mpub publish -f article.md -p zhihu
mpub publish -f article.md -p juejin

# 指定主题
mpub publish -f article.md -t cyberpunk

# 渲染预览（不发布）
mpub render -f article.md -t wechat

# 查看所有支持平台
mpub platforms
```

文章格式用 front-matter：

```markdown
---
title: 文章标题
author: 作者名
cover: https://example.com/cover.jpg
summary: 文章摘要
tags: [技术, 前端, JavaScript]
---

正文内容，支持 Markdown + 代码高亮 + LaTeX 公式
```

---

## 配合 AI 使用

这个工具已经做成了 Claude Code Skill。装好后，直接和 AI 说"帮我发布文章到微信公众号"，AI 调用 `mpub` 完成操作。AI 写完文章、直接发布，全流程一个对话里搞定。

---

## 最后

工具已经发到 npm：[multi-publisher](https://www.npmjs.com/package/multi-publisher)。

支持 20+ 平台，但说实话项目刚起步。很多平台目前只打通了登录（Cookie 获取），实际发布到草稿箱的功能还需要在各个平台上逐个验证。如果你在使用中遇到某个平台发布失败，欢迎提 Issue，也可以直接提交 PR——适配器接口已经搭好了，加一个新平台不算难。

也欢迎推荐你用过的类似工具，做之前我没来得及把所有方案都了解一遍，如果有更好的，欢迎告诉我。

- npm: https://www.npmjs.com/package/multi-publisher
- GitHub: https://github.com/xwh5/multi-publisher
