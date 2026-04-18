---
title: 我做了个 CLI 工具，把文章一键发布到 20+ 平台
author: xwh5
summary: 写完文章还要手动登录各平台、复制到排版工具、再复制到各个编辑器——这套流程折磨了我大半年。今天把这个问题解决了。
tags: [技术, CLI, 效率工具, TypeScript]
---

# 我做了个 CLI 工具，把文章一键发布到 20+ 平台

写完一篇技术博客，你以为最耗时间的部分是写？

不是。是你终于写完了，坐下来想休息一下，然后发现——还有 20 个平台等着你发布。

微信公众号、知乎、掘金、CSDN、今日头条……每个平台都要打开浏览器、登录账号、找到编辑入口、把 Markdown 复制进去。代码块要调格式、图片要重新上传、标题摘要要逐个平台适配。这套流程我重复了大半年，每次都觉得自己在浪费时间，但一直没有动力去解决它。

直到我开始用 AI 帮我写文章。

---

## 痛苦的根源：发布是创作的反义词

我每周写一篇技术博客，内容创作本身其实不费时间。但每次写完，脑子里刚完成一件大事的正反馈，就被"还要再发 20 个平台"的念头抵消掉了。

更烦的是，这个过程完全是机械的、不需要思考的：
- 打开浏览器
- 登录各个平台
- 复制 Markdown 到在线排版工具
- 调整格式
- 复制到平台的富文本编辑器
- 上传图片

每一步都在打断你。你明明刚写完一篇文章，正处于"输出完毕"的满足感中，结果接下来半小时在做机械劳动。

**创作需要专注，发布需要的是自动化。** 这两件事不应该混在一起。

---

## 市面上的方案，我找了很久

在动手做之前，我调研了现有的解决方案。

**Wechatsync** 是一个浏览器插件，连接各大平台后可以同步文章。它的思路是自动填充表单——打开目标平台的编辑器，它帮你把内容填进去。

这个方案的问题在于：**依赖浏览器**。如果你的 CI/CD 流程或者 AI 工作流要和它对接，目前主流做法是通过 MCP（Model Context Protocol）操作浏览器插件。这意味着 AI 发一篇文章，背后要经历：AI → MCP Server → 浏览器插件 → 平台页面。这个链条不稳定，浏览器要开着，页面不能崩，网络不能抖。

**wenyan-cli** 是另一个工具，专注于微信公众号，命令行方式，做得挺扎实。但只支持一个平台，排版能力也有限。

我需要的是一个命令行工具，输入 Markdown，输出可以直接发布的富文本。不需要浏览器，不需要打开任何页面。

---

## 我的做法：CLI + 平台 API

我的需求是：**和 AI 对接，让 AI 帮我写文章、发布文章，全程不需要开浏览器。**

CLI 是最自然的方式。AI 调用命令行，命令行调用平台 API，没有浏览器这一层，稳定性靠得住。

所以有了 [multi-publisher](https://www.npmjs.com/package/multi-publisher)。

核心流程：

```
Markdown 文件
    │
    ▼
┌──────────────┐
│  CLI 工具    │  ← AI 直接调用
└──────────────┘
    │
    ▼
平台 API（微信公众号、知乎、掘金...）
```

每个平台是一个 adapter，接入方式不同：

- **微信公众号**：有官方 API，直接调 `access_token`，发布草稿、上传图片
- **其他平台**（知乎、掘金等）：没有官方发布 API，用登录态的 Cookie 请求

技术细节不多说了。重点是：这套工具做出来之后，我的工作流变成了这样。

---

## 现在的流程：坐在电脑前，告诉 AI "帮我发布"

我现在写文章用的是 Claude Code，或者直接通过飞书和 AI 对话。

文章写完之后，我只需要说一句话：

```
"帮我把这篇文章发布到微信公众号和知乎"
```

AI 调用 `mpub publish -f article.md`，工具自动完成：
1. 渲染 Markdown，得到适合微信的 HTML
2. 上传图片到微信服务器，换成 `media_id`
3. 创建草稿箱

三分钟后，草稿已经在各个平台的编辑器里了。我只需要打开草稿，检查一下排版，点发布。

**这半小时的机械劳动，变成了三分钟的自动化。**

---

## npm 发布踩的几个坑

工具做完了，发到 npm。这个过程折腾了两天，记录几个值得说的。

### 坑 1：workflow 文件名大小写

最早的 workflow 叫 `publish.yml`，npm 后台 Trusted Publisher 配置填的是 `publish.yml`，但实际 GitHub Actions 的文件名是 `publish.yaml`。OIDC 验证一直失败，错误信息根本不告诉你哪里对不上。最后是文件名一个个字母核对的。

### 坑 2：NODE_AUTH_TOKEN 干扰 OIDC

没用 OIDC 之前试过 npm Token 方式发布。后来切到 OIDC，发现 `NODE_AUTH_TOKEN` 这个环境变量会自动被 GitHub Actions 注入，导致 OIDC 交换出来的 session token 被忽略。解决是显式清空它：

```yaml
env:
  NODE_AUTH_TOKEN: ''
```

### 坑 3：npm 版本太低

GitHub Actions 的 `ubuntu-latest` 自带的 npm 是 10.9.7，这个版本的 npm 声称支持 OIDC，但 sigstore 签名流程有 bug，交换出来的 token 返回 401。只能直接用 Node 24，自带 npm 11.11.0，OIDC 才真正工作。

### 坑 4：Windows 上 CLI 命令打开文件

Windows 系统看到 `.js` 文件没有 shebang，不知道要用 `node` 执行，就把它当成普通文本打开。解决是在 `src/cli/index.ts` 顶部加一行 shebang：

```typescript
#!/usr/bin/env node
/**
 * CLI 入口
 */
```

---

## 怎么用

```bash
# 安装
npm install -g multi-publisher

# 配置微信公众号凭据（首次需要）
mpub credential --app-id <your-app-id> --app-secret <your-app-secret>

# 发布文章
mpub publish -f article.md

# 指定平台
mpub publish -f article.md -p zhihu
mpub publish -f article.md -p juejin
```

文章格式用 front-matter：

```markdown
---
title: 文章标题
author: 作者名
cover: https://example.com/cover.jpg
summary: 文章摘要
---

正文内容，支持 Markdown + 代码高亮 + LaTeX 公式
```

---

## 结尾

工具已经发到 npm：[multi-publisher](https://www.npmjs.com/package/multi-publisher)。

支持 20+ 平台，但项目刚起步。很多平台目前只打通了登录，实际发布功能还需要逐个验证。如果你在使用中遇到某个平台发布失败，欢迎提 Issue。

也欢迎推荐你用过的类似工具，做之前我没来得及把所有方案都了解一遍。

- npm: https://www.npmjs.com/package/multi-publisher
- GitHub: https://github.com/xwh5/multi-publisher