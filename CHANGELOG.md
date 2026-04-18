# Changelog

All notable changes will be documented in this file.

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
