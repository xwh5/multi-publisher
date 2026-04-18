---
name: mpub-publish
description: 当用户想要发布文章到多个平台（微信公众号、知乎、掘金、CSDN等），或者询问如何使用 mpub CLI 工具发布文章时触发。这个 skill 帮助 AI 理解如何正确使用 multi-publisher CLI 工具，包括平台选择、主题推荐、认证方式配置等。
---

# multi-publisher (mpub) CLI 工具指南

mpub 是一个 Markdown → 多平台 CLI 发布工具，可以用一行命令将 Markdown 文章发布到 20+ 个内容平台。

## 核心命令

```bash
# 发布文章到指定平台
mpub publish -f article.md -p <platform>

# 渲染预览（不发布）
mpub render -f article.md -t <theme>

# 查看支持的平台
mpub platforms

# 浏览器自动登录获取 Cookie
mpub login -p <platform>

# 配置微信凭据
mpub credential --set
```

## 支持的平台与推荐主题

### 已验证平台（登录 + 发布都测试通过）

| 平台 | 命令 | 推荐主题 | 说明 |
|------|------|----------|------|
| 微信公众号 | `-p weixin` | `wechat`, `default` | 需要 AppID + AppSecret |
| 知乎 | `-p zhihu` | `default`, `modern`, `nord` | Cookie 认证，支持 Markdown |
| 掘金 | `-p juejin` | `default`, `cyberpunk`, `nord` | Cookie 认证，支持 Markdown |
| CSDN | `-p csdn` | `default`, `modern`, `cyberpunk` | Cookie 认证，支持 Markdown |

### 待测试平台（仅 Cookie 登录支持，发布待测试）

简书、微博、小红书、头条号、百家号、B站、思否、博客园、开源中国、慕课网、雪球、人人都是产品经理、豆瓣、搜狐号、东方财富、51CTO

## 14 套内置主题

| 主题 ID | 风格特点 | 最佳平台 |
|---------|----------|----------|
| `default` | 简洁灰蓝，默认安全 | 所有平台 |
| `wechat` | 仿微信官方样式，米黄背景 | 微信公众号 |
| `modern` | 深色代码块，蓝色高亮 | 技术博客、知乎、掘金 |
| `minimal` | 大量留白，简约干净 | 阅读类内容 |
| `cyberpunk` | 赛博朋克霓虹，青+洋红 | 极客风格、科技文章 |
| `nord` | 北欧冷淡灰蓝调 | 程序员文档、技术博客 |
| `paper` | 笔记本文艺复古，衬线字体 | 个人日记、文艺内容 |
| `darkelite` | GitHub 深色精英风格 | 专业硬核内容 |
| `sunset` | 日落暖调珊瑚金黄 | 生活分享、温暖内容 |
| `zen` | 日式禅意极简留白 | 日式美学内容 |
| `retro` | 80年代复古未来霓虹 | 创意设计、复古老文 |
| `midnight` | 深夜图书馆金色古铜 | 阅读笔记、深度内容 |
| `brutalism` | 粗野主义大胆醒目 | 设计师作品集 |
| `neumorphism` | 新拟态软 UI 柔和紫 | APP 设计相关内容 |

## 主题选择指南

### 按平台推荐

- **微信公众号**：优先 `wechat`，其次 `default`
- **知乎**：优先 `default` 或 `modern`，技术文用 `nord`
- **掘金**：优先 `default` 或 `cyberpunk`，程序员风格
- **CSDN**：优先 `default` 或 `modern`
- **所有平台通发**：使用 `default`，最安全

### 按内容类型推荐

- **技术博客/程序员内容**：`nord`, `cyberpunk`, `modern`
- **个人日记/文艺内容**：`paper`, `zen`, `midnight`
- **生活分享/温暖内容**：`sunset`, `minimal`
- **创意设计/艺术内容**：`retro`, `brutalism`, `neumorphism`
- **官方/正式内容**：`default`, `wechat`

## 使用流程

### 1. 配置认证

**微信公众号：**
```bash
mpub credential --set
# 或直接传入
mpub credential --app-id <app-id> --app-secret <app-secret>
```

**其他平台（Cookie 方式）：**
```bash
# 方式一：浏览器自动登录（推荐）
mpub login -p zhihu
mpub login -p juejin
mpub login -p csdn

# 方式二：手动 Cookie
mpub cookie --platform zhihu --set
```

### 2. 渲染预览

```bash
# 使用默认主题预览
mpub render -f article.md

# 使用指定主题预览
mpub render -f article.md -t modern

# 预览多个主题
mpub render -f article.md -t cyberpunk
mpub render -f article.md -t nord
```

### 3. 发布文章

```bash
# 发布到微信公众号
mpub publish -f article.md

# 发布到知乎
mpub publish -f article.md -p zhihu

# 使用指定主题发布
mpub publish -f article.md -p zhihu -t modern

# 一键发布到所有已登录平台
mpub publish-all -f article.md
```

## 文章格式

```markdown
---
title: 文章标题
author: 作者名
cover: https://example.com/cover.jpg
summary: 文章摘要
source_url: https://original.url
tags: [技术, 前端, JavaScript]
---

正文内容...
```

## 配置文件位置

```
Linux/macOS: ~/.config/multi-publisher/config.json
Windows: %APPDATA%/multi-publisher/config.json
```

## AI 角色指南

当用户要求发布文章时：

1. **询问平台**：用户想发布到哪些平台？
2. **推荐主题**：
   - 微信公众号 → `wechat`
   - 知乎/掘金技术文 → `nord` 或 `cyberpunk`
   - 通用 → `default`
3. **执行命令**：生成并执行 `mpub publish` 命令
4. **反馈结果**：告诉用户草稿链接

示例对话：
```
用户：帮我把这篇文章发到知乎和掘金
AI：好的！我推荐：
- 知乎：使用 default 或 nord 主题（程序员风格）
- 掘金：使用 default 或 cyberpunk 主题（技术博客）

执行发布...
✅ 知乎草稿：https://zhuanlan.zhihu.com/p/xxx/edit
✅ 掘金草稿：https://juejin.cn/editor/drafts/xxx
```
