# multi-publisher - Technical Specification

## 1. Concept & Vision

**一行命令，Markdown 发布到全网。**

纯 CLI 多平台文章发布工具，无浏览器依赖。输入排版好的 Markdown，输出各平台原生格式（微信公众号 HTML、知乎 Markdown 直发）。适合个人博主、技术写作者，开源免费。

**设计原则：**
- 架构干净：全新实现，不复制参考项目源码
- 配置统一：单一 `config.json`，无分散文件
- 主题可扩展：内置 4 套主题，自定义 CSS 即插即用
- 适配器模式：新增平台只需实现接口，无需改动核心

---

## 2. Architecture

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    CLI (Commander.js)               │
│  publish | render | platforms | credential | cookie │
└──────────┬──────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────┐
│                    RuntimeInterface                  │
│  fetch() | file I/O | config access                 │
└──────────┬──────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────┐
│              Core Rendering Pipeline                │
│  parser → renderer → styler (CSS inline)            │
│  ├── parser.ts     front-matter + Markdown 解析     │
│  ├── renderer.ts   AST → HTML，代码高亮 + LaTeX     │
│  ├── styler.ts     juice CSS 内联                    │
│  ├── theme.ts      主题加载（4 套内置 + 自定义）      │
│  └── mathjax.ts    LaTeX → SVG/PNG                  │
└──────────┬──────────────────────────────────────────┘
           │ HTML + media_id
┌──────────▼──────────────────────────────────────────┐
│              Platform Adapters                       │
│  IPlatformAdapter 接口                               │
│  ├── WeixinAdapter   微信公众号（AppID+AppSecret）   │
│  └── ZhihuAdapter     知乎（Cookie）                  │
│                                                    │
│  wechat-publisher.ts  ← 微信发布核心（适配器调用）     │
└─────────────────────────────────────────────────────┘
           │
           ▼
    Platform APIs
    (微信 / 知乎 / 掘金 ...)
```

### 源码结构

```
src/
├── index.ts                     # CLI 入口，命令注册
├── config.ts                    # 统一配置管理（ConfigStore）
│
├── cli/                         # 命令行接口层
│   ├── index.ts                 # Commander.js 聚合所有子命令
│   ├── publish.ts              # publish 命令
│   ├── render.ts               # render 命令（输出 HTML 到 stdout）
│   ├── platforms.ts            # platforms 命令
│   ├── credential.ts            # credential 命令（微信凭据）
│   └── cookie.ts               # cookie 命令（Cookie 管理）
│
├── core/                        # 核心渲染引擎
│   ├── parser.ts               # Markdown + front-matter 解析
│   ├── renderer.ts             # 渲染管道（Markdown → HTML）
│   ├── styler.ts               # CSS 内联（juice）
│   ├── mathjax.ts              # LaTeX → SVG/PNG 公式
│   └── theme.ts                # 主题管理（4 套内置 + 自定义）
│
├── adapters/                    # 平台适配器
│   ├── interface.ts            # IPlatformAdapter 接口定义
│   ├── index.ts                # 适配器注册表
│   ├── wechat-publisher.ts    # 微信发布核心逻辑（被 weixin.ts 调用）
│   ├── weixin.ts               # 微信公众号适配器
│   └── zhihu.ts                # 知乎适配器
│
└── runtime/                    # 运行时抽象
    ├── index.ts                # RuntimeInterface 接口定义
    └── node-runtime.ts         # Node.js 运行时实现
```

---

## 3. CLI Interface

```bash
mpub <command> [options]
```

### 子命令

| 命令 | 说明 |
|------|------|
| `mpub publish -f <file>` | 发布文章到指定平台 |
| `mpub render -f <file>` | 预览渲染 HTML（输出到 stdout） |
| `mpub platforms` | 列出所有支持平台及能力 |
| `mpub credential --set` | 配置微信 AppID + AppSecret |
| `mpub cookie --platform <p> --set` | 配置平台 Cookie |
| `mpub cookie --platform <p> --check` | 验证 Cookie 状态 |

### 全局选项

| 选项 | 说明 |
|------|------|
| `-f, --file <path>` | Markdown 文件路径（本地文件或 URL） |
| `-c, --custom-theme <path>` | 自定义 CSS 主题文件路径 |

### publish 选项

| 选项 | 说明 |
|------|------|
| `-p, --platform <ids>` | 目标平台，逗号分隔（默认 `weixin`） |
| `-t, --theme <id>` | 渲染主题（默认 `default`） |
| `--mac-style` | Mac 风格代码块（默认开启） |
| `--no-mac-style` | 禁用 Mac 风格代码块 |

### render 选项

| 选项 | 说明 |
|------|------|
| `-t, --theme <id>` | 主题 ID（默认 `default`） |
| `-h, --highlight <theme>` | 代码高亮主题（默认 `solarized-light`） |
| `--mac-style` | Mac 风格代码块（默认开启） |
| `--no-mac-style` | 禁用 Mac 风格代码块 |

---

## 4. Article Format (front-matter)

```markdown
---
title: 文章标题
author: 作者名
cover: https://example.com/cover.jpg    # 封面图 URL（可选）
summary: 文章摘要                         # 微信摘要字段（可选）
source_url: https://original.url        # 原文链接（可选）
tags: [技术, 前端, JavaScript]            # 标签（可选）
---

正文 Markdown 内容，支持：

- 代码高亮
- LaTeX 公式 $E = mc^2$
- 图片
- 表格
```

---

## 5. Adapter Interface

```typescript
interface PlatformMeta {
  id: string
  name: string
  icon: string
  homepage: string
  capabilities: ('article' | 'draft' | 'image_upload')[]
}

interface Article {
  title: string
  markdown: string
  html?: string
  author?: string
  cover?: string
  source_url?: string
  summary?: string
  tags?: string[]
}

interface SyncResult {
  platform: string
  success: boolean
  postId?: string
  postUrl?: string
  draftOnly?: boolean
  error?: string
  timestamp: number
}

interface AuthResult {
  isAuthenticated: boolean
  username?: string
  userId?: string
  avatar?: string
  error?: string
}

interface IPlatformAdapter {
  readonly meta: PlatformMeta
  init(runtime: RuntimeInterface): Promise<void>
  checkAuth(): Promise<AuthResult>
  publish(article: Article): Promise<SyncResult>
}
```

**添加新平台**：实现 `IPlatformAdapter` 接口，注册到 `src/adapters/index.ts`，即可通过 `-p <platform>` 调用。

---

## 6. Weixin Adapter Detail

### 认证流程

```
AppID + AppSecret
       ↓
  GET https://api.weixin.qq.com/cgi-bin/token
       ↓
  access_token（有效期 7200s，缓存到 config.json）
```

### 发布流程

```
Markdown 文件
     ↓
front-matter 解析（title / cover / author）
     ↓
core/renderer → HTML（含代码高亮 + LaTeX）
     ↓
遍历 img 标签：
  下载图片 → 上传到微信 CDN（material/add_material）
  → 替换为 CDN URL（临时素材）
     ↓
封面图 → material/add_material → thumb_media_id（永久素材）
     ↓
cgi-bin/draft/add → 创建草稿
     ↓
返回草稿链接
```

### 关键 API

| 用途 | API |
|------|-----|
| 获取 access_token | `GET /cgi-bin/token` |
| 上传永久素材 | `POST /cgi-bin/material/add_material` |
| 创建草稿 | `POST /cgi-bin/draft/add` |

### 常见错误码

| errcode | 说明 | 处理方式 |
|---------|------|---------|
| 40001 | access_token 无效 | 重新获取 |
| 40164 | IP 未加入白名单 | 在 mp.weixin.qq.com 添加 IP |
| 40007 | media_id 无效 | 封面需用永久素材 |
| 64507 | 内容含外部链接 | 移除文章中外部 URL |
| -206 | 服务过载 | 稍后重试 |

---

## 7. Zhihu Adapter Detail

### 认证流程

```
用户在浏览器登录知乎 → 复制完整 Cookie
       ↓
  mpub cookie --platform zhihu --set
       ↓
  Cookie 解析为 key-value 对象
       ↓
  存储到 config.json（zhihu.cookies）
       ↓
  checkAuth() 请求 www.zhihu.com 验证
```

### 发布流程

```
Markdown 文件
     ↓
front-matter 解析
     ↓
Markdown 内容直接使用（知乎支持 Markdown）
     ↓
POST https://api.zhihu.com/creators/article/zuisao
     ↓
返回文章 URL
```

---

## 8. Rendering Pipeline

```
Markdown + front-matter
        ↓
┌─────────────────────────────────┐
│         parser.ts               │
│  1. front-matter 解析（YAML）    │
│  2. Markdown 解析（marked）      │
│  3. 提取正文 + 标题/作者/封面     │
└───────────────┬─────────────────┘
                ↓
┌─────────────────────────────────┐
│         renderer.ts             │
│  1. marked 解析 Markdown → HTML │
│  2. highlight.js 代码高亮        │
│  3. MathJax LaTeX → SVG         │
└───────────────┬─────────────────┘
                ↓
┌─────────────────────────────────┐
│         theme.ts                │
│  加载主题 CSS（4 套内置 + 自定义）│
└───────────────┬─────────────────┘
                ↓
┌─────────────────────────────────┐
│         styler.ts               │
│  juice.inlineContent            │
│  CSS 内联到 HTML 元素            │
└───────────────┬─────────────────┘
                ↓
         最终 HTML
```

---

## 9. Theme System

### 内置主题

| ID | 名称 | 特征 |
|----|------|------|
| `default` | Default | 简洁朴素，通用场景 |
| `wechat` | Wechat | 仿微信官方样式，左边框引用 |
| `modern` | Modern | 深色代码块 + 蓝色调，技术文章 |
| `minimal` | Minimal | 大量留白，简约阅读 |

### 主题加载优先级

1. `--custom-theme <path>` 自定义 CSS 文件（优先）
2. `themes/<id>.css` 内置主题文件
3. 内置主题 CSS 字符串（编译在代码中）

### 自定义主题

只需提供覆盖默认样式的 CSS 片段，无需完整定义：

```css
/* my-theme.css */
h1 { color: #e74c3c; }       /* 覆盖标题颜色 */
pre { border-radius: 12px; } /* 代码块圆角 */
```

---

## 10. Configuration

### 文件位置

| OS | 路径 |
|----|------|
| Linux/macOS | `~/.config/multi-publisher/config.json` |
| Windows | `%APPDATA%\multi-publisher\config.json` |

### 配置结构

```json
{
  "version": 1,
  "weixin": {
    "appId": "wx...",
    "appSecret": "...",
    "access_token": "...",
    "token_expires_at": 1746000000000
  },
  "zhihu": {
    "cookies": {
      "z_c0": "...",
      "token": "...",
      "..."
    }
  }
}
```

### 迁移策略

首次启动检测旧版分散文件（`credential.json`、`token.json`、`cookies/`）自动合并到 `config.json`，合并后删除旧文件。

---

## 11. Dependencies

```json
{
  "commander": "^14.0.0",
  "marked": "^15.0.0",
  "marked-highlight": "^2.2.0",
  "highlight.js": "^11.10.0",
  "juice": "^10.0.0",
  "jsdom": "^27.0.0",
  "mathjax-full": "^3.2.0",
  "front-matter": "^4.0.0",
  "form-data": "^4.0.0",
  "@inquirer/input": "^5.0.0",
  "axios": "^1.7.0",
  "os": "^0.1.2"
}
```

### 运行时依赖

- Node.js ≥ 18（使用 `node:` 协议 imports）
- 无 native bindings，纯 JavaScript

---

## 12. Project Files

```
multi-publisher/
├── README.md                    # 用户文档（使用指南）
├── LICENSE                      # MIT License
├── package.json
├── tsconfig.json
├── SPEC.md                      # 本文档（技术规格）
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── cli/
│   │   ├── index.ts
│   │   ├── publish.ts
│   │   ├── render.ts
│   │   ├── platforms.ts
│   │   ├── credential.ts
│   │   └── cookie.ts
│   ├── core/
│   │   ├── parser.ts
│   │   ├── renderer.ts
│   │   ├── styler.ts
│   │   ├── mathjax.ts
│   │   └── theme.ts
│   ├── adapters/
│   │   ├── interface.ts
│   │   ├── index.ts
│   │   ├── wechat-publisher.ts
│   │   ├── weixin.ts
│   │   └── zhihu.ts
│   └── runtime/
│       ├── index.ts
│       └── node-runtime.ts
└── themes/
    ├── wechat.css
    ├── modern.css
    └── minimal.css
```

---

## 13. Out of Scope

以下功能明确不在当前版本范围内：

- **浏览器自动化登录**（用户手动提供 Cookie/AppSecret）
- **文章更新 / 删除**（仅支持新增发布）
- **定时发布**
- **图片 CDN 服务**（依赖各平台自带 CDN）
- **多账号管理**（同一平台一个账号）

---

## 14. Revision History

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-04-15 | 初始版本，支持微信公众号 + 知乎 |
