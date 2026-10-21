# 架构深化计划（2026-10-21 走查产出）

> 来源：两轮独立走查（主代理 + 子代理，41 个源文件全读）⇒ 7 个候选、7 个确定 bug。已修 5 个 bug（`73ec4ef`、`b481473`），剩 4 个 bug + 6 个候选按下面的票据推进。
> 词汇见 `GLOSSARY.md`；决策见 `docs/adr/`。

## 已完成（2026-10-21）

| # | 内容 | 提交 |
|---|---|---|
| B1 | ESM 里用 `require` ⇒ `mpub login` 不复用已存 cookie、企鹅号封面恒失败（改原生 FormData+Blob） | `73ec4ef` |
| B2 | `loadSavedCookies` 同步返回 Promise | `73ec4ef` |
| B3 | `capabilities` 不诚实（9/9 声明 image_upload，4/9 真做）⇒ 按实际对齐 + 改成从 registry 读（消除手抄漂移） | `73ec4ef` |
| B4 | 死代码 `publishLegacy`（181 行）+ 死模块 3 个（`toutiao-upload`/`imgbb-uploader`/`xiaohongshu-sniffer`，后者顶层直接开浏览器） | `73ec4ef`、`b481473` |
| B5 | 发布包契约两份（`PackageMeta` 单一来源）+ cover 路径没拼 | `73ec4ef` |
| B6 | `publish-all` 手写 front-matter + 丢 `baseDir` ⇒ 改用 parseMarkdown 并传 baseDir | `b481473` |
| B7 | `registry.publishToPlatforms` 的 article 子集类型丢字段 ⇒ 改用完整 `Article` | `b481473` |
| B8 | `firstMediaId` 死字段与死分支（微信外部 URL 封面回退恒不成立） | `b481473` |

## 剩余 bug 票据

| # | 内容 | 位置 | 验收 |
|---|---|---|---|
| **B9** | `firstMediaId` 删除后，微信"外部 URL 图作封面"的回退分支语义要重写（现在只剩 fallback：扫 processedHtml 找 http 图） | `adapters/wechat-publisher.ts` | 明确"外部 URL 图能否作封面"：能 ⇒ 走 `uploadPermanentImageFromUrl`；不能 ⇒ 删掉该 fallback 并在注释写明 |
| **B10** | 反自动化统一：CDP 4 特征 / `addInitScript` 1 特征 / 无 —— 三种实现 | `runtime/browser-runtime.ts`、`tools/cover-fetcher.ts`、`tools/browser-upload.ts` | 一处实现（ADR-0001 的 `stealthScript`），`docs/PLATFORM-ADAPTERS.md:44-48` 的"必须用 CDP"落到代码 |
| **B11** | `capabilities` 仍无人消费（纯声明）——要么消费它，要么删掉这个字段 | `adapters/interface.ts` | 删字段，或在 `platforms`/发布前用它做校验 |
| **B12** | `docs/PLATFORM-ADAPTERS.md` 与 `.agents/skills/mpub-publish/SKILL.md` 内容过时（写 20+ 平台/14 套主题，实际 9 平台/4 主题） | docs / skills | 与代码一致；**单独提交，不混进架构改造** |

## 候选票据（依赖边已标）

### T1 · 浏览器发布栈 → 一个 deep module 【ADR-0001】
**阻塞**：无（可先做）　**被阻塞**：T4
**现状**：`chromium.launch` 6 文件 10 处、CDP 反检测 5 文件 8 处、UA 字面量 10 文件 14 处；`toutiao.ts` 与 `xiaohongshu.ts` 各内嵌一整套（launch → newContext → stealth → addCookies → goto → 填表 → 上传 → 点发布 → 回读 id → close）。
**设计（已定，见 ADR-0001）**：`runtime/browser-publisher.ts` 拥有 启动/UA/视口/反自动化/注入 cookie/登录检测/关闭/回读 id；平台适配器只提供 平台语义（编辑器 URL、选择器、图片上传方式、是否真发布）。
**验收**：① `chromium.launch` 只剩 1 处 ② stealth 只剩 1 处 ③ 两个平台适配器各自只剩平台差异 ④ 行为等价（真机各跑一次对照）⑤ seam 上能放一个假 adapter（为 T5 铺路）

### T2 · 发布包 module 拥有契约 【ADR-0002】
**阻塞**：无　**依赖**：T1（发布包投递会走浏览器发布栈）
**现状**：`PackageMeta`(8 字段) 与 `XhsPackageMeta`(5 字段) 曾各写一遍（已合并为单一来源，但**限制值 20 字仍散在 3 处**）；外部投递器两种口径（`--package <dir>` vs `--title/--body/--image/--tag`）。
**设计**：`cli/xhs-package.ts` 与 `cli/publish.ts` 共同依赖一个 package module：契约 + 限制值 + 路径解析 + 校验 + 投递方式。
**验收**：① 20 字上限只出现 1 次 ② 外部投递器只有 1 种口径 ③ 封面字段在整条链路活着（图文帖第一张图 = 封面）

### T3 · RuntimeInterface：给它第二个 adapter，或删掉它 【ADR-0003】
**阻塞**：无
**现状**：3/4 成员全仓 0 命中；weibo/bilibili 直接用全局 fetch 绕过；4/9 adapter 的 `init()` 不接 runtime；`publish-all.ts` 用 `{fetch,getCookie} as never` 造假。
**两个选项（ADR 里已记录取舍）**：A. 保留 seam，给它两个真 adapter（node / 浏览器）＋ 假实现（测试用）；B. 删掉 interface，adapter 直接用 node 能力。
**验收**：0 个 `as never` 造假 runtime；要么 seam 两侧各有两个实现，要么这个 interface 不存在

### T4 · 平台差异：9 个平行浅 module + 策略泄漏到 CLI
**阻塞**：T1、T3　**被阻塞**：T5
**现状**：新增一个平台要改 ≥7 处（registry / config / PLATFORM_LOGIN_CONFIGS / cli-login switch / cli-cookie 两个 switch / platforms 清单 / base-adapter getterMap）；`publish.ts:52-62` 把"微信锁 wechat 主题、知乎→modern、头条→minimal"硬编码在 CLI。
**验收**：① 新增一个平台的改动点 ≤3 处 ② 平台策略不在 CLI 里 ③ `PlatformMeta` 补上默认主题/认证方式/登录配置三处散落的信息

### T5 · 渲染管道 interface 说谎 + 微信图片链路跨 3 module
**阻塞**：T4
**现状**：`RenderOptions` 7 字段实现只用 4 个（`highlight`/`macStyle`/`footnote` 在 src/core 下 0 命中，但 3 个调用方都在传）⇒ CLI 的 `--mac-style/--no-mac-style` 是纯装饰；微信图片链路同一 `<img src>` 正则 4 处各写一遍，"哪张是 mermaid 产物"靠路径约定判断。
**验收**：① 死参数从 interface 与 CLI 一起删 ② 图片处理收成一处 ③ mermaid 产物的判定不再靠路径字符串

### T6 · 可测面：seam 上的假实现
**阻塞**：T1、T2、T3
**现状**：本仓**无测试脚本**（package.json 只有 build/dev/typecheck/preview），CI 不跑测试，`CLAUDE.md` 的"pnpm test（如果有）"属实。
**设计**：先在 T1 的 seam 上放一个假 adapter（不碰平台），让"发一条图文帖"第一次可测；再按同样方式覆盖 API 类 adapter。**需要先定**：引入测试框架（vitest）＝新增依赖 + CI 变更，属独立决策。
**验收**：① `mpub publish --package` 在离线情况下可断言行为 ② CI 跑测试

## 建议顺序

```
T1 ──→ T2 ──┐
             ├──→ T4 ──→ T5
T3 ─────────┘
                    └──→ T6（需要先定测试框架）
```

## 风险提示

- **本机无法对头条/小红书做真机回归**（需登录态 + 真实发布）⇒ T1 属于"纯搬家"，行为等价性只能靠人工对照；**T1 落地后必须各真机跑一次**（或用 T6 的假 adapter 先锁住行为）。
- 平台侧接口会变：`docs/PLATFORM-ADAPTERS.md` 是经验笔记，不是契约。
