# ADR-0002：「发布包」由一个 module 拥有契约

- 日期：2026-10-21
- 状态：已决（部分已落地：契约已单一来源，限制值与路径解析待收口）
- 关联：`GLOSSARY.md`（发布包 / 图文帖 / 投递 / 闸门）

## 背景

「发布包」是本仓最新的概念，却同时散在两处：`cli/xhs-package.ts` 的 `PackageMeta`（8 字段）与 `cli/publish.ts` 的 `XhsPackageMeta`（5 字段）是同一契约的两份；20 字上限复制 3 份；外部投递器两种口径（`--package <dir>` 与 `--title/--body/--image/--tag`）指向同一个脚本。编译器不报错 ⇒ 漂移不会被发现。封面字段在整条链路上曾是死的。

## 决策

由一个 package module 拥有：**契约（字段）· 限制值（标题 20 字 / 正文 1000 字）· 路径解析（包目录 → 绝对路径）· 校验 · 投递方式**。出包（`xhs-package`）与投递（`publish --package`）都只跟它说话。

## 理由

- 一个概念一个 module ⇒ locality；限制值只有一处 ⇒ 改上限不会漏。
- 外部投递器统一成一种口径 ⇒ 外部脚本契约稳定（`knowledge/reference/xhs-publish.sh` 已同时支持两种，保留兼容但内部只生成一种）。
- 契约曾两份 ⇒ 这是 seam 缺席的直接证据。

## 影响

- `PackageMeta` 已是单一来源（`xhs-package.ts` 导出，`publish.ts` 复用）。
- 待收口：20 字上限 3 处 → 1 处；cover 路径解析统一到 package module。
