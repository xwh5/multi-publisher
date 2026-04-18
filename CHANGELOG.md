# Changelog

All notable changes will be documented in this file.

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
