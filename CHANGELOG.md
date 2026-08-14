# Changelog

All notable changes will be documented in this file.

## [1.1.4] - 2026-08-14

### Added

- wechat 主题重做：琥珀编辑风（Tufte 灵感）——重点琥珀高亮、金句引用块、卡片容器
- Markdown 卡片容器语法：`:::tip` / `:::warning` / `:::note` → callout 区块（内部支持完整 Markdown）
- 主题预览生成脚本 `generate-all-themes-preview.ts`（4 套主题 + 卡片示例一键生成）

### Fixed

- 正文相对路径图片按文章目录（baseDir）解析，不再依赖进程 cwd（跨目录发布图片 404）
- 微信图片上传 contentType 按实际扩展名（jpg/gif/webp/png），不再硬编码 png
- 微信摘要 digest 使用 front-matter `summary`（兼容 `description`），不再用标题代替
- 图床 fallback 顺序：Catbox（永久）优先，Litterbox（1 小时过期）降为兜底
- URL 解析（extFromUrl/nameFromUrl）加 try/catch，非法 URL 不再抛异常
- 移除死代码（createReadStream / macStyle / ParsedArticle 未使用）

### Changed

- `.gitattributes` 统一 LF 行尾符（修复 Windows/WSL 跨平台全量 diff）
- `temp/` 加入 .gitignore 并解除跟踪；browser-upload 支持 headless（默认 true）

## [1.1.0] - 2026-04-18

### Added

- 自动封面图生成：根据标题生成精美 SVG 封面，支持随机颜色和装饰风格
- 封面图生成器：8 种预设主题 + 6 种装饰风格，完全本地生成无需网络
- 文章生成技能：tech-blog-writer skill 帮助写出专业有干货的技术博客

### Changed

- 优化发布流程，减少临时文件残留
- 清理项目无关文件

## [0.1.0] - 2026-04-14

### Added

- 微信公众号 AppID + AppSecret API 发布（无需浏览器）
- 多平台 Cookie 认证发布（知乎、掘金等）
- 渲染预览命令 `mpub render`
- Cookie 采集命令 `mpub login`
- 平台列表命令 `mpub platforms`

### Architecture

- 适配器模式：新增平台只需实现对应 Adapter
- 渲染引擎：Markdown → 平台适配 HTML
- 运行时：Node.js 原生 HTTP 服务 + 浏览器自动化
