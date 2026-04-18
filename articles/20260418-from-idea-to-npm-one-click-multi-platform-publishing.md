# 我用 TypeScript 写了一个 CLI 工具，把 Markdown 一键发布到全网平台

写技术博客的人大概都有过这种体验：花了大半天把文章写好、排版舒服了，然后开始逐个平台复制粘贴——微信公众号、知乎、掘金、CSDN……每个平台的富文本编辑器规则还不一样，代码块样式要调，图片要手动上传，一套下来一小时没了。

我想解决这个问题。

于是有了 [multi-publisher](https://www.npmjs.com/package/multi-publisher)：一个命令行工具，输入 Markdown，输出各个平台可直接发布的富文本。目前支持微信公众号、知乎、掘金、CSDN 等 20+ 平台。

这篇文章说说这个工具是怎么做出来的，以及发布到 npm 过程中踩的 8 个坑。

---

## 痛点驱动：复制粘贴的苦力活

内容创作者跨平台分发是个老问题了。各个平台工具链不同，没有统一入口：

- 微信公众号有独立的图文编辑器，不支持 Markdown
- 知乎和掘金是另一种风格，代码高亮要单独处理
- 每次换平台都要重新处理格式、图片、链接

很多人选择"首发微信公众号，其他平台直接放链接"。这对 SEO 不友好，读者也不一定愿意跳转。

我的需求很简单：**写好一篇 Markdown，在各个平台都能一键发布，草稿箱里待审，不用每次重新排版。**

---

## 怎么做：TypeScript + ESM + 适配器模式

技术选型上没什么花活，就是 TypeScript + Node.js，用了这些年最顺手的组合。

### 编译方式

`tsc` 编译，直接输出 ES Modules。没有 webpack、没有 rollup、没有 esbuild，就是最朴素的 TypeScript 编译器。每个 `.ts` 源文件对应一个 `.js` 编译产物，不打包、不合并、不压缩。

这样做的好处是透明——用户装完包能看到所有源码；坏处是没有 tree-shaking，不过一个 CLI 工具本来也没多大，无所谓。

### 整体架构

```
Markdown 文件
    │
    ▼
┌──────────────┐    ┌──────────────┐    ┌────────────┐
│  parser.ts   │───▶│ renderer.ts  │───▶│ styler.ts  │
│  front-matter│    │ AST → HTML   │    │ CSS 内联    │
│  Markdown解析│    │ 代码高亮/LaTeX│    │ 主题应用    │
└──────────────┘    └──────────────┘    └────────────┘
                                            │
                   ┌────────────────────────┘
                   ▼
          ┌───────────────┐    ┌─────────────────────┐
          │ wechat-publish│    │  platform adapter   │
          │ 图片上传→media_id│    │  调用平台 API 发布    │
          └───────────────┘    └─────────────────────┘
```

核心是**适配器模式**。每个平台是一个独立的 adapter，实现统一接口：

```typescript
interface IPlatformAdapter {
  readonly meta: PlatformMeta
  init(runtime: RuntimeInterface): Promise<void>
  checkAuth(): Promise<AuthResult>
  publish(article: Article): Promise<SyncResult>
}
```

新增一个平台，不需要动核心代码，只要实现这个接口，注册到适配器注册表里就行。十几个平台适配器，结构完全一致，维护成本可控。

### 渲染管道

Markdown 解析用了 `marked`，代码高亮用了 `highlight.js`，LaTeX 公式用了 `mathjax-full`，CSS 内联用了 `juice`。这几个库组合起来，把 Markdown 转成带样式的 HTML，然后根据各平台 API 的要求做适当转换——比如微信公众号要把图片转成 `media_id` 上传到微信服务器。

主题系统做了 14 套 CSS，渲染时指定 `-t` 参数切换。`default`、`wechat`、`cyberpunk`、`nord`、`brutalism`……各取所需。

---

## 发布到 npm：8 个坑的完整记录

工具写完了，接下来要发布到 npm。听起来简单：`npm publish` 就完了。但实际折腾了两天，踩了 8 个坑才发成功。逐个说一下，也许你能用上。

### 坑 1：workflow 文件名不一致

最早的 workflow 叫 `publish.yaml`，npm 后台 Trusted Publisher 配置里填的也是 `publish.yml`。差了一个字母，OIDC 验证一直失败。npm 那边根本不告诉你哪里对不上，只会说"认证失败"。最后对着文件名一个个字母核对才发现。

**教训**：npm 后台填的 workflow 文件名要和实际文件名完全一致，包括后缀。

### 坑 2：GitHub Actions 自动注入的 NODE_AUTH_TOKEN

GitHub Actions 会自动把 `GITHUB_TOKEN` 映射为 `NODE_AUTH_TOKEN` 环境变量。我本来想用 OIDC 方式发布（不需要手动存 token），但 npm CLI 优先使用 `NODE_AUTH_TOKEN`，导致 OIDC 交换出来的 session token 被忽略，报 `ENEEDAUTH`。

解决方法是显式清空这个变量：

```yaml
- name: Publish to npm
  run: npm publish --access public --provenance
  env:
    NODE_AUTH_TOKEN: ''  # 关键：清空自动注入的 token
```

### 坑 3：npm 版本太低（最坑的一个）

最开始用 `node-version: '20'`，自带的 npm 是 10.9.7。这个版本的 npm 声称支持 OIDC，但实际 token 交换流程有 bug——sigstore 签名生成成功，npm 却返回 401。

我试过在 CI 里手动升级 npm：
- `npx npm@latest install -g`：只装了 1 个包，npm 版本纹丝不动
- `npm install -g npm@11`：报错 `MODULE_NOT_FOUND`，promise-retry 模块在 Runner 镜像里不存在

最后发现唯一的解法是**直接用 Node 24**，自带 npm 11.11.0，OIDC 才真正工作。Node 20/22 都不行。

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '24'  # 不是 20，不是 22，必须是 24
```

### 坑 4：repository 字段缺失

OIDC 方式发布必须加 `--provenance` 参数，这会让 npm 验证 `package.json` 里的 `repository.url` 是否和实际 GitHub 仓库匹配。

我一开始 `repository` 字段是空的，报错：

```
Error verifying sigstore provenance bundle:
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

必须是完整的对象格式，不能是字符串。

### 坑 5：permissions.id-token 权限不够

最初 workflow 里的 permissions 写了 `contents: read`，OIDC token 请求直接失败。OIDC 方式需要 `id-token: write`，这个权限专门用于向外部 OIDC Provider（这里是 npm）请求身份 token。

```yaml
permissions:
  contents: write
  id-token: write  # 关键
```

### 坑 6：npm Granular Token 的 2FA 问题

一开始没用 OIDC，试过用 npm Token 发布。创建了一个 Granular Access Token，但发布时报 403：`2FA required`。

原因：Granular Token 默认不带 2FA bypass 权限。需要在 npm 后台创建 Token 时勾选 "Allow 2FA bypass for CI/CD"，或者使用 Classic Token（但 Classic Token 安全策略更严格）。

### 坑 7：Recovery Token 不能用于发布

折腾 OIDC 的时候试过用 Linked Accounts 里那个 Recovery Token，结果同样报 403——Recovery Token 设计上就不能用于 API 发布操作，只能用于账户恢复。

### 坑 8：Windows 上 CLI 命令打开文件而非执行

npm 包发上去后，用户反映 `mpub --version` 没有输出版本号，而是打开了 `index.js` 源码文件。

原因是 TypeScript 编译输出的 `dist/cli/index.js` 第一行是 `/**` 注释，Windows 系统看到 `.js` 文件没有 shebang，不知道要用 `node` 执行，就把它当成普通文本打开（关联到了 VS Code）。

解决：在 `src/cli/index.ts` 顶部加一行 shebang：

```typescript
#!/usr/bin/env node
/**
 * CLI 入口
 */
```

TypeScript 编译后会原样保留这行到编译产物里。

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
        env:
          CI: true

      - name: Type check
        run: npm run typecheck
        env:
          CI: true

      - name: Publish to npm
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          npm publish --access public --provenance
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

### npm Trusted Publisher 配置

在 npm 后台 Settings → Access → Trusted Publishers 添加：

- Owner: `xwh5`
- Repository name: `multi-publisher`
- Workflow filename: `publish.yml`
- Environment name：（留空）

配置好之后，只要往 GitHub 推送 `v*` 标签，就会自动构建、发布到 npm，全程不需要任何手动 token 操作。

---

## 怎么用

```bash
# 安装
npm install -g multi-publisher

# 配置微信公众号凭据（首次需要）
mpub credential --app-id <your-app-id> --app-secret <your-app-secret>

# 发布文章（默认发到微信公众号草稿箱）
mpub publish -f article.md

# 指定平台
mpub publish -f article.md -p zhihu
mpub publish -f article.md -p juejin

# 指定渲染主题
mpub publish -f article.md -t cyberpunk

# 渲染预览（不发布）
mpub render -f article.md -t wechat

# 查看所有支持平台
mpub platforms
```

文章格式用 front-matter 写元数据：

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

这个工具已经做成了 Claude Code Skill，装好后直接跟 AI 说"帮我发布文章到微信公众号"，AI 会调用 `mpub` 完成操作。从写到发，全流程可以在一个对话里搞定。

---

## 最后

multi-publisher 目前已发布到 npm（[multi-publisher](https://www.npmjs.com/package/multi-publisher)），支持 20+ 平台，核心发布能力（微信公众号、知乎、掘金、CSDN）已验证可用。

如果对你有用，欢迎试用。有问题可以在 GitHub 提 Issue。

- npm: https://www.npmjs.com/package/multi-publisher
- GitHub: https://github.com/xwh5/multi-publisher
