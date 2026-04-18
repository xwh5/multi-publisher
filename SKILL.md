# multi-publisher CLI 工具技能

## 触发场景

当用户询问以下问题时激活：
- "怎么发布文章到微信公众号"
- "mpub 怎么用"
- "multi-publisher 使用方法"
- "如何发布到知乎"
- "如何配置微信凭据"
- "文章发布工具"

## 工具基本信息

**命令**：`mpub`（需先 `npm install -g multi-publisher`）
**npm**：`https://www.npmjs.com/package/multi-publisher`
**文档**：`README.md` / `SPEC.md`

## 核心命令速查

### 发布文章
```bash
mpub publish -f <文章.md> -p <平台>
```
- `-p weixin` — 微信公众号（默认）
- `-p zhihu` — 知乎
- `-p weixin,zhihu` — 同时发布到多个平台
- `-t <theme>` — 指定主题（default/wechat/modern/minimal）

### 预览渲染
```bash
mpub render -f <文章.md> -t <主题>
```
直接输出 HTML 到终端，可重定向到文件查看效果。

### 列出平台
```bash
mpub platforms
```

### 配置微信凭据
```bash
mpub credential --set
# 或直接传入
mpub credential --app-id <id> --app-secret <secret>
```

### 配置平台 Cookie（知乎等）
```bash
mpub cookie --platform zhihu --set
mpub cookie --platform zhihu --check
```

## 快速工作流

### 首次使用（微信公众号）

```bash
# 1. 配置凭据（一次性）
mpub credential --app-id <your-app-id> --app-secret <your-app-secret>

# 2. 预览效果
mpub render -f article.md -t wechat > preview.html

# 3. 发布到草稿箱
mpub publish -f article.md -p weixin
```

### 知乎发布

```bash
# 1. 获取 Cookie 后配置
mpub cookie --platform zhihu --set

# 2. 发布
mpub publish -f article.md -p zhihu
```

## 主题使用指南

| 主题 | 场景 | 命令示例 |
|------|------|---------|
| `default` | 通用 | `mpub render -f a.md -t default` |
| `wechat` | 微信公众号 | `mpub render -f a.md -t wechat` |
| `modern` | 技术文章 | `mpub render -f a.md -t modern` |
| `minimal` | 简约阅读 | `mpub render -f a.md -t minimal` |

自定义主题：`mpub render -f a.md -c ./my-theme.css`

## 文章格式

```markdown
---
title: 文章标题
author: 作者名
cover: https://example.com/cover.jpg   # 封面图 URL
summary: 文章摘要                     # 微信摘要
source_url: https://original.url       # 原文链接
tags: [技术, 前端]
---

正文内容，支持 Markdown + 代码高亮 + LaTeX 公式
```

## 常见错误处理

### 微信 40164（IP 未加入白名单）
**错误**：`{"errcode":40164,"errmsg":"ip xxx not in whitelist"}`
**解决**：登录 mp.weixin.qq.com → 开发 → 基本配置 → IP白名单 → 添加当前 IP

### 微信 40007（media_id 无效）
**错误**：draft/add 返回 40007
**原因**：封面图用了临时素材，需用永久素材
**解决**：确认 `wechat-publisher.ts` 中 `uploadCover()` 使用 `material/add_material`（已修复）

### access_token 过期
**原因**：token 有效期 2 小时
**解决**：`mpub credential --app-id <id> --app-secret <secret>` 重新配置，或删除 `config.json` 重新来过

### 知乎 Cookie 无效
**解决**：重新在浏览器登录知乎，复制新的 Cookie

## 配置位置

```
~/.config/multi-publisher/config.json
```

查看路径：`mpub credential --location`

## 本地开发测试

```bash
cd C:\Users\Administrator\.openclaw\workspace\projects\multi-publisher

npm install      # 安装依赖
npm run build    # 编译 TypeScript

# 链接到全局（需先 npm install -g multi-publisher）
npm link
mpub platforms  # 测试
```

## 添加新平台

1. 实现 `IPlatformAdapter` 接口（见 `SPEC.md`）
2. 在 `src/adapters/index.ts` 注册
3. 即可通过 `-p <platform>` 调用

## 关键文件索引

| 文件 | 作用 |
|------|------|
| `src/adapters/interface.ts` | 平台适配器接口定义 |
| `src/adapters/weixin.ts` | 微信公众号适配器 |
| `src/adapters/zhihu.ts` | 知乎适配器 |
| `src/core/theme.ts` | 主题管理 |
| `src/config.ts` | 统一配置管理 |
| `themes/*.css` | 主题样式文件 |
