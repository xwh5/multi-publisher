# GLOSSARY — mpub 领域词表

> 规则：写文档/代码注释时用**这里的词**，不要用"组件/服务/接口层"替换。词形约定见文末。
> 建立：2026-10-21（架构走查副产品）。

## 一等概念

| 词 | 含义 | 边界（什么算 / 什么不算） |
|---|---|---|
| **文章**（Article） | 一篇带 front-matter 的 Markdown 文档 | front-matter 必填 `title`；解析后是 `core/parser.ts` 的 `ParsedArticle`（meta + body + html）。**不含**"渲染后"或"发布后"的形态 |
| **front-matter** | 文章头部的 YAML 元信息块 | 由 `front-matter` 库解析。已知键：`title`(必填)/`author`/`cover`/`summary`/`description`/`source_url`/`tags`；小红书另有专属块 `xhs:`（`title`/`body`/`tags`） |
| **渲染管道** | Markdown → HTML 的转换链 | `core/renderer.ts`：parse → 数学公式 → 主题 CSS → juice 内联 → 微信 section 包裹 → 自动封面。**不含 Mermaid**（已外移到平台适配器） |
| **渲染结果**（RenderResult） | 渲染管道的产物 | 与"文章"是源与派生物的关系 |
| **主题**（Theme） | 一整套 CSS，决定排版观感 | 4 套内置：`default`/`wechat`/`modern`/`minimal`。**不等于平台**——微信是锁死的特例，其余可 `-t` 覆盖 |
| **平台适配器**（Platform Adapter） | 一个平台在 mpub 里的实现 | 9 个，注册在 `adapters/registry.ts`。它是 **seam 上的一个 adapter**，不是 seam 本身；seam 在 `adapters/interface.ts` |
| **平台元信息**（PlatformMeta） | 适配器自述的身份 | `id`/`name`/`icon`/`homepage`/`capabilities`。**当前不含**默认主题/认证方式/登录配置——这三项目前散在别处 |
| **草稿箱**（draft） | 平台的暂存区，发布前的状态 | `SyncResult.draftOnly: true` = 只存草稿、需人工去平台确认。**mpub 的一切发布默认只到草稿箱**，唯一例外是小红书的 `--publish-now` |
| **图文帖**（ImagePost） | 小红书形态：图集 + 短标题 + 短正文 + 标签 | `adapters/interface.ts` 的 `ImagePost`，是**内存里**要投递给平台的形态 |
| **发布包**（Package） | 图文帖在磁盘上的序列化 | 目录 `dist/xhs/<slug>/`：`post.md` + `meta.json` + `images/`。**与"图文帖"不是同一个东西**：包是帖子的序列化 |
| **闸门**（gate） | 投递前后的检查环节：查重 + AI 腔检查 + 发布后回查 | **实现在仓库外**（`knowledge/reference/xhs-publish.sh`），mpub 只做编排（`--via-script`）。理由：小红书笔记发出去不能删除，误发/双发不可回收 |
| **封面**（cover） | 平台文章的头图 | 来源三种：front-matter `cover`、自动生成（SVG）、网络抓取 |
| **自动封面**（autoCover） | 无封面时按标题生成/抓取一张 | 产物是临时文件，用完需清理 |
| **正文图** / **封面图** | 正文里的插图 / 文章头图 | **处理路径不同**：正文图要先上传到平台图床再替换 `src`；封面图多数平台要求独立上传 |
| **图集** | 图文帖的多张图 | 只在图文帖语境使用 |
| **反自动化**（anti-automation） | 伪装成真人浏览器 | CDP `Page.addScriptToEvaluateOnNewDocument` 注入 webdriver/plugins/languages/window.chrome 四个特征 |
| **平台 HTTP 接口** | 平台的第三方 HTTP 端点 | 例：`api.weixin.qq.com`、`zhuanlan.zhihu.com/api/articles/drafts`、`mp.toutiao.com/spice/image`。**注意与 module 的 interface 区分**——这是外部系统的接口 |
| **配置**（config） | `~/.config/multi-publisher/config.json` | 单一文件，含微信凭据 + 各平台 cookie |
| **登录**（login） | 打开可见浏览器让用户扫码，人工完成 | 与"发布"是两件事；除微信外各平台一律靠 cookie |
| **凭据**（credential） | 微信公众号的 AppID + AppSecret | **只微信需要**，走 `mpub credential`；其余平台一律 cookie |
| **抓包**（capture） | 逆向平台上传接口的开发期动作 | `tools/capture.ts`；**只用于开发，不是发布链路** |
| **临时素材** / **永久素材** | 微信素材接口的两类 | `media/upload`（临时）vs `material/add_material`（永久）。**封面必须用永久素材** |

## 易混边界（写文档时必须显式区分）

| A | B | 区分点 |
|---|---|---|
| **文章** | **渲染结果** | 文章是源（Markdown + front-matter），渲染结果是派生物 |
| **发布包** | **图文帖** | 发布包是磁盘目录（外部脚本可读），图文帖是内存里的 `ImagePost` |
| **发布** | **投递** | 发布 = 交给平台（`adapter.publish`）；投递 = 把包交给外部脚本（`--via-script`）。mpub 在图文链路里**只做编排** |
| **平台适配器** | **平台** | 适配器是 mpub 里的实现，平台是外部系统。**mpub 有 9 个适配器 ≠ 9 个平台**（历史上有 22 个壳适配器，2026-08 移除 13 个） |
| **默认主题** | **锁定主题** | 微信是"锁定"（无视 `-t`），其余是"默认"（可覆盖） |

## 词形约定

- **平台适配器** = 实现；**适配器 interface** = `IPlatformAdapter` 本身。不要让"适配器接口"同时指两样。
- **发布包**写全称，不要单写"包"（另有 `package.json` 的包、npm 包）。
- 图只用两个词：**正文图 / 封面图**；"图集"仅在图文帖语境使用。
- **Mermaid 转换不在渲染管道内**（属于"内容准备"）——后来者容易搞错。
