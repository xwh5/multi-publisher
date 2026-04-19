# multi-publisher 开发指南

## 项目概述

一行命令，Markdown 发布到全网。支持微信公众号、知乎、掘金、CSDN 等 20+ 平台。

## 技术栈

- **Runtime**: Node.js ≥ 18
- **CLI**: Commander.js
- **渲染**: marked (Markdown) + juice (CSS 内联)
- **AI 集成**: 多平台适配器架构，支持自动封面图生成
- **发布**: 各平台官方 API

## 开发流程

### 1. 规范遵循

**每次代码变更前，先加载技能：**
- `/andrej-karpathy-skills:karpathy-guidelines` - 减少 LLM 常见编码错误
- `/context7` - 查询最新文档（React、npm 包等）

### 2. 开发步骤

```
1. 需求分析 → 确认假设，避免隐藏的歧义
2. 最小实现 → 不要过度设计，只写解决当前问题所需的代码
3. 增量修改 → 只改必须改的地方，不随意"优化"周围代码
4. 验证目标 → 定义可验证的成功标准
```

### 3. 提交前检查

```bash
pnpm build        # 构建
pnpm typecheck    # 类型检查（生产环境禁止 any）
pnpm test         # 测试（如果有）
```

**禁止：**
- `any` 类型
- `// @ts-ignore`
- 生产环境 `console.log`

### 4. Git 提交

```bash
# 提交代码（不打标签）
git add .
git commit -m "描述改动"
git push origin master

# 打标签发布 npm（需要 CI）
git tag v.x.x.x
git push origin v.x.x.x
```

**标签会自动触发 CI：**
1. `npm ci` - 安装依赖
2. `npm run build` - 构建
3. `npm run typecheck` - 类型检查
4. `npm publish` - 发布到 npm
5. `softprops/action-gh-release` - 创建 GitHub Release

---

## 项目结构

```
multi-publisher/
├── src/
│   ├── index.ts              # CLI 入口，命令注册
│   ├── config.ts             # 统一配置管理
│   │
│   ├── cli/                  # 命令行接口
│   │   ├── publish.ts        # 发布命令
│   │   ├── render.ts         # 渲染预览
│   │   ├── credential.ts      # 微信凭据管理
│   │   ├── cookie.ts         # Cookie 管理
│   │   ├── login.ts          # 浏览器自动登录
│   │   └── platforms.ts      # 平台列表
│   │
│   ├── core/                 # 核心渲染引擎
│   │   ├── parser.ts         # Markdown + front-matter 解析
│   │   ├── renderer.ts       # 渲染管道
│   │   ├── styler.ts        # CSS 内联
│   │   ├── mathjax.ts        # LaTeX 公式
│   │   └── theme.ts          # 主题系统
│   │
│   ├── adapters/             # 平台适配器
│   │   ├── interface.ts      # IPlatformAdapter 接口
│   │   ├── registry.ts      # 平台注册
│   │   ├── weixin.ts        # 微信公众号
│   │   ├── wechat-publisher.ts  # 微信公众号核心发布逻辑
│   │   ├── zhihu.ts         # 知乎
│   │   ├── juejin.ts        # 掘金
│   │   └── ...
│   │
│   ├── runtime/             # 运行时抽象
│   │   ├── node-runtime.ts   # Node.js 运行时
│   │   └── browser-runtime.ts # Playwright 浏览器运行时
│   │
│   └── tools/               # 工具脚本
│       ├── cover-generator.ts # AI 封面图生成
│       └── cover-fetcher.ts   # 封面图下载
│
├── skills/                  # 技能文档（供参考）
│   └── blog-writer.md      # 博客写作技能
│
└── .github/workflows/      # CI/CD
    └── publish.yml          # npm 发布流程
```

---

## 核心概念

### 适配器模式

每个平台是一个独立的 `Adapter`，实现统一接口：

```typescript
interface IPlatformAdapter {
  readonly meta: PlatformMeta
  init(runtime: RuntimeInterface): Promise<void>
  checkAuth(): Promise<AuthResult>
  publish(article: Article): Promise<SyncResult>
}
```

新增平台：创建 `adapters/<platform>.ts` → 在 `registry.ts` 注册

### 渲染管道

```
Markdown → parser → HTML → styler(CSS内联) → platform adapter → 发布
```

### front-matter 必填

**重要**：文章必须包含 front-matter，否则标题显示"无标题"，内容可能为空：

```markdown
---
title: 文章标题        # 必填
author: 作者名         # 必填
description: 描述     # 可选
cover: url            # 可选，有 --auto-cover 可省略
---

正文...
```

---

## 常用命令

```bash
# 开发
pnpm build              # 构建
pnpm typecheck          # 类型检查
pnpm dev                # 开发模式

# 发布
pnpm publish            # 发布到 npm（需打标签）

# 本地测试
node dist/cli/index.js publish -f article.md -p weixin --auto-cover
node dist/cli/index.js render -f article.md -t cyberpunk
```

---

## 微信发布调试

调试微信公众号发布时，可添加临时日志：

```typescript
// src/adapters/wechat-publisher.ts
console.log(`[WechatPublisher] content 长度: ${content.length}`)
```

构建后测试，**完成后记得删除调试代码**。
