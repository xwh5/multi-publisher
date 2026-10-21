# ADR-0001：浏览器发布栈收成一个 deep module

- 日期：2026-10-21
- 状态：已决（待实现，见 `docs/architecture-plan.md` T1）
- 关联：`GLOSSARY.md`（发布 / 草稿箱 / 反自动化）

## 背景

`chromium.launch` 散在 6 个文件 10 处、CDP 反检测散在 5 个文件 8 处、UA 字面量 10 个文件 14 处。`toutiao.ts` 与 `xiaohongshu.ts` 各自内嵌一整套：launch → newContext → stealth → addCookies → goto 编辑器 → 填表 → 上传 → 点发布 → 回读 id → close。反自动化有 3 种不一致实现，而 `docs/PLATFORM-ADAPTERS.md:44-48` 早已写明"必须用 CDP"——知识在文档里没落到代码。git log 里连续三次浏览器修复（filechooser 超时未消费、封面 filechooser、正文图改自家图床）每次只改一个平台。

## 决策

新建 `runtime/browser-publisher.ts`，它**拥有**：浏览器启动、UA、视口、反自动化脚本、cookie 注入、登录态检测、页面关闭、结果回读。平台适配器**只保留平台语义**：编辑器 URL、选择器、图片上传方式、是否真发布。

## 理由

- 变���点 ≥7 ⇒ seam 是真的（"one adapter = hypothetical seam, two = real"），现在位置错了。
- 浏览器怪癖集中 ⇒ locality；新平台只写差异 ⇒ leverage。
- 现在 `runtime/browser-runtime.ts` 只做 login 侧，publish 侧无边界 ⇒ 两侧不对称。

## 影响

- 行为必须等价：这是**纯搬家**，不改语义；落地后需对头条/小红书各真机跑一次对照（见架构计划的风险提示）。
- 为可测面铺路：seam 稳住后，才可能在 seam 上放一个假 adapter（ADR-0003 的同款逻辑）。
- 已知取舍：平台适配器仍需知道选择器（这部分**不**藏进 module——那是平台差异，藏进去反而丢 locality）。
