# ADR-0003：RuntimeInterface 给它第二个 adapter，或删掉它

- 日期：2026-10-21
- 状态：已决方向，实现待定（见 `docs/architecture-plan.md` T3）

## 背景

`RuntimeInterface` 是本仓声称的第二个 seam，但：3/4 成员（readFile / readFileBuffer / getConfigDir）全仓 0 命中；`weibo.ts`/`bilibili.ts` 直接用全局 `fetch` 绕过；4/9 适配器的 `init()` 根本不接 runtime；`cli/publish-all.ts` 用 `{fetch,getCookie} as never` 造了一个假 runtime。deletion test：删掉它复杂度**消失**而不是分散 ⇒ 浅 module。而真正难测的浏览器链路它一个都替换不了。

## 决策

二选一，**不保留现状**：
- **A（保留 seam）**：给它两个真 adapter —— node 运行时 + 浏览器运行时 —— 并在浏览器侧放一个假实现供测试替换。
- **B（删掉）**：删掉这个 interface，适配器直接依赖 node 能力；测试改在更高层的 seam（平台适配器 / 发布包 module）上做。

## 理由

- "one adapter = hypothetical seam, two = real"：现在 0 个变化点 ⇒ 这个 seam 目前是假的。
- 假 seam 比没有 seam 更糟：它让人以为替换 runtime 就能测，实际不能。

## 影响

- 若选 A，seam 的第二个实现就是 ADR-0001 的浏览器发布栈 ⇒ **T1 与 T3 应一起做**。
- 若选 B，需清理 `as never` 造假点与 4 处绕过。
- 两者都不影响外部命令行为（`mpub publish` 的 interface 不变）。
