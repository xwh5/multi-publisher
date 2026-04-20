5
# 我在发布 npm 包时踩的 8 个坑

发布一个 npm 包到 GitHub Packages 听起来很简单——`npm publish` 嘛。但当你把它接进 GitHub Actions 的时候，事情就开始变得诡异了。OIDC 认证失败、Token 权限不够、Windows 上命令不执行……这些问题单独搜都搜不到，凑在一起能让你debug 到凌晨三点。

我前后折腾了三周，踩遍了能踩的坑。今天把这些整理出来，希望你别再重蹈覆辙。

---

## 先说背景：为什么 npm 发布会这么复杂？

传统的 npm 发布很简单——你登录 npm账号，`npm publish`，完事。但当你需要**自动化发布**（比如每次 merge 到 main 就发一个版本），就需要处理认证、权限、Action 配置等一系列问题。尤其是当你把包发布到 GitHub Packages 而不是 npmjs 的时候，涉及 GitHub Actions、OIDC、Granular Token 等一堆概念，每个环节都有潜在的坑。

下面这 8 个坑，每一个都耗费了我数小时到数天不等。

---

## 坑 1：workflow 文件名不一致

**问题描述**

GitHub Actions 的 workflow 文件放`.github/workflows/`目录下，文件名随便起，看起来没什么讲究。但如果你同时有多个项目或者多个 workflow，这点看似无关紧要的小差异会在某天让你突然懵掉。

比如你有两个包：

```
.github/workflows/release-package-a.yml
.github/workflows/release-package-b.yml
```

或者更隐蔽的：

```
.github/workflows/release.yml  （大写开头）
.github/workflows/release-package.yml  （小写）
```

在 macOS/Linux 上文件系统不区分大小写，所以本地测试没问题，但 CI 跑的时候 GitHub 服务器上的路径解析可能出问题。更烦的是，某些自动化工具（比如 `gh` CLI）在引用 workflow 的时候会按文件名匹配，大小写不对就找不到。

**解决**

workflow 文件名统一用**小写 + 中划线**的命名方式，并且包含语义：

```
.github/workflows/publish-package-a.yml
.github/workflows/publish-package-b.yml
```

不要用驼峰、不要用大写开头。一开始就规范，比后面改一堆引用要省事得多。

---

## 坑 2：NODE_AUTH_TOKEN 干扰 OIDC 认证

**问题描述**

这是最坑的一个。

GitHub Actions 从 2023 年开始推荐使用 **OIDC（OpenID Connect）** 来代替传统的 `NODE_AUTH_TOKEN`。OIDC 的好处是不需要长期保存密钥，CI 运行时会动态请求临时 Token，安全得多。

但问题来了——如果你同时配置了 `NODE_AUTH_TOKEN` 和 OIDC，Actions 可能会优先使用 `NODE_AUTH_TOKEN`，导致 OIDC 配置形同虚设。更诡异的是，某些 npm 指令在有 `NODE_AUTH_TOKEN` 存在时行为不一致，比如 `npm config set` 的优先级会被影响。

我花了三天时间才定位到这个问题——CI 日志显示 Token 一直在用，但明明 OIDC 已经配置好了，为什么还要用那个长时效的密钥？

**解决**

在使用 OIDC 的 workflow 中，**完全移除** `NODE_AUTH_TOKEN` 相关配置：

```yaml
# 错误配置 - 不要同时使用
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    registry-url: 'https://npm.pkg.github.com'
    # 下面这个会干扰 OIDC
    # NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# 正确配置 - 只用 OIDC
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    registry-url: 'https://npm.pkg.github.com'
```

OIDC 配置通常在 workflow 顶层（如果你用了 `actions/upload-artifact` 等标准 Action，OIDC 通常是隐式启用的）。但记住一个原则：**不要两个认证方式混用**。

---

## 坑 3：npm 版本太低

**问题描述**

Node.js 18 以上的版本需要 npm 9+ 才能正确处理某些特性。但 GitHub Actions 的 `actions/setup-node` 默认安装的 npm 版本有时候偏低，尤其当你用 `node-version: '20'` 时。

低版本的 npm 在处理 GitHub Packages 的认证时可能会有问题，比如：

- `npm login` 失败但没有清晰的错误信息
- `npm publish` 时报 `403 Forbidden`，但 Token 明明是对的
- registry URL 正确但认证头发送有问题

更隐蔽的是，低版本 npm 可能在 Windows 和 Linux 上的行为不一致——你在本地 Mac 上发布成功，CI 上的 Ubuntu 镜像却失败。

**解决**

在 workflow 中显式安装指定版本的 npm：

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'

- name: Install npm with correct version
  run: npm install -g npm@10

- name: Verify npm version
  run: npm --version  # 确保是 10.x
```

---

## 坑 4：repository 字段缺失

**问题描述**

`package.json` 里有一个 `repository` 字段，看起来是可选的，但如果你的包要发布到 GitHub Packages，这个字段**必须有**，而且格式必须正确。

npm 在发布时会读取 `repository` 字段来关联包的源代码地址。如果这个字段缺失，发布可能成功，但 GitHub Packages 不会正确关联你的包到代码仓库。

**解决**

确保 `package.json` 包含正确格式的 `repository` 字段：

```json
{
  "name": "@your-org/your-package",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-org/your-package.git"
  },
  "version": "1.0.0"
}
```

---

## 坑 5：permissions.id-token 权限不够

**问题描述**

使用 OIDC 认证时，workflow 需要声明 `permissions` 来允许请求 OIDC Token。标准配置通常是：

```yaml
permissions:
  contents: read
  id-token: write  # 这个必须有
```

但我一开始只写了 `permissions: contents: read`，忘了 `id-token: write`，结果 OIDC Token 请求一直失败。

**解决**

在使用 OIDC 的 workflow 中，明确声明所有需要的权限：

```yaml
permissions:
  contents: read      # checkout 需要
  id-token: write     # OIDC Token 请求必须
  packages: write     # GitHub Packages 发布需要
```

---

## 坑 6：Granular Token 的 2FA 问题

**问题描述**

GitHub 推荐的 Fine-grained Personal Access Tokens（Granular Token）比传统的 Classic Token 更安全，但 **Granular Token 不能用于需要 2FA 验证的操作**。

更麻烦的是，错误信息不一定是 "2FA required"，有时候就是 `403 Forbidden`。

**解决**

对于自动化发布场景，使用 **GitHub App Token**：

```yaml
- name: Generate token
  id: generate-token
  uses: actions/create-github-app-token@v1
  with:
    app-id: ${{ secrets.APP_ID }}
    private-key: ${{ secrets.APP_PRIVATE_KEY }}
```

---

## 坑 7：Recovery Token 不能用于发布

**问题描述**

GitHub 的 Account Recovery Tokens 是你设置 2FA 时生成的备用码。这些码**不能用于 API 认证**。

更坑的是，如果你把这些 Recovery Token 配置成了 GitHub Secrets，然后在 workflow 里用，CI 会一直失败。

**解决**

Recovery Token 只用于账号恢复场景。自动化发布使用 GitHub App Token 或 Classic PAT。

---

## 坑 8：Windows 上 CLI 命令打开文件而非执行

**问题描述**

在 Windows 上，GitHub Actions 默认用 PowerShell 作为 shell。某些 CLI 命令可能被当作文件名处理。

**解决**

显式指定使用 bash 而不是 PowerShell：

```yaml
- name: Install and publish
  shell: bash
  run: |
    npm install
    npm run build
    npm publish
```

---

## 可用的完整配置

把上面的坑都填上之后，一个能用的 workflow 大概是这样的：

```yaml
name: Publish Package

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write
  packages: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://npm.pkg.github.com'

      - name: Install npm@10
        run: npm install -g npm@10

      - name: Install dependencies
        shell: bash
        run: npm install

      - name: Build
        shell: bash
        run: npm run build

      - name: Publish
        shell: bash
        run: npm publish
```

对应的 `package.json`：

```json
{
  "name": "@your-org/your-package",
  "version": "1.0.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-org/your-package.git"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

---

## 总结

| 坑 | 核心问题 | 关键修复 |
|---|---|---|
| 1. 文件名不一致 | 大小写/命名混乱 | 统一 `publish-xxx.yml` 小写命名 |
| 2. NODE_AUTH_TOKEN 干扰 OIDC | 两个认证方式混用 | 移除 `NODE_AUTH_TOKEN`，只用 OIDC |
| 3. npm 版本太低 | 默认版本不匹配 | 显式安装 `npm@10` |
| 4. repository 字段缺失 | 包和仓库关联失败 | 补全完整的 `repository` URL |
| 5. id-token 权限不够 | OIDC Token 请求被拒 | 添加 `id-token: write` |
| 6. Granular Token 2FA | Token 类型不支持 | 用 GitHub App Token 代替 |
| 7. Recovery Token | 不能用于 API | 换成 App Token 或 Classic PAT |
| 8. Windows 路径问题 | PowerShell 行为不同 | 显式指定 `shell: bash` |

每个坑看起来都不大，但组合在一起能让你 debug 到怀疑人生。希望这份清单能帮你省下那三天。

如果你也踩过其他奇怪的 npm 发布坑，欢迎分享出来。