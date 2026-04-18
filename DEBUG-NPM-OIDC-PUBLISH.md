# multi-publisher CI/CD 发布流水线调试全记录

> 从开发完成到 GitHub Actions + npm OIDC Trusted Publishing 成功发布，完整记录所有踩坑过程。

---

## 项目信息

- **项目**: multi-publisher
- **GitHub**: https://github.com/xwh5/multi-publisher
- **npm**: https://www.npmjs.com/package/multi-publisher
- **npm 账号**: xwh7351
- **最终发布方式**: OIDC Trusted Publishing（无 token）

---

## 目标

通过 GitHub Actions 推送 `v*` tag 时，自动构建并发布 npm 包到 https://www.npmjs.com/package/multi-publisher，使用 **OIDC Trusted Publishing**（无需在 GitHub Secrets 中存储任何 npm token）。

---

## 最终成功的配置

### package.json

```json
{
  "name": "multi-publisher",
  "version": "1.0.1",
  "description": "Markdown → 微信公众号 / 知乎 / 掘金等多平台 CLI 发布工具",
  "type": "module",
  "repository": {
    "type": "git",
    "url": "https://github.com/xwh5/multi-publisher"
  },
  "bin": {
    "mpub": "./dist/cli/index.js"
  },
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli/index.ts",
    "typecheck": "tsc --noEmit",
    "preview": "npx serve themes"
  },
  ...
}
```

**关键**：`repository` 字段必须完整对象格式（不能为空字符串），值必须匹配 GitHub 仓库地址。

### .github/workflows/publish.yml

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write  # 核心：允许 GitHub 向 npm 请求 OIDC token

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'  # 必须是 Node 24，自带 npm 11+
          registry-url: 'https://registry.npmjs.org'  # 核心：激活 OIDC 认证
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          CI: true

      - name: Type check
        run: npm run typecheck
        env:
          CI: true

      - name: Publish to npm
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          echo "Publishing multi-publisher@$VERSION"
          npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ''  # 核心：清空 GitHub 自动注入的 token，防止干扰 OIDC

  create-release:
    runs-on: ubuntu-latest
    needs: publish
    permissions:
      contents: write
    steps:
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref }}
          name: Release ${{ github.ref }}
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### npm Trusted Publisher 配置

在 https://www.npmjs.com/package/multi-publisher/settings/access 中添加：

- **Owner**: `xwh5`
- **Repository name**: `multi-publisher`
- **Workflow filename**: `publish.yml`
- **Environment name**: （留空）

---

## 踩坑全记录

### 坑 1：workflow 文件名不一致

- **现象**：npm 后台配置的 Trusted Publisher 一直不生效
- **原因**：workflow 文件名拼写错误（`publish.yml` vs `publish.yaml`）
- **解决**：确保 npm 后台填写的文件名与 `.github/workflows/` 下的实际文件名完全一致

### 坑 2：NPM_TOKEN secret 冲突

- **现象**：`npm whoami` 返回 `E401 Unauthorized`
- **原因**：GitHub Actions 自动将 `GITHUB_TOKEN` 映射为 `NODE_AUTH_TOKEN` 环境变量，这个 token 干扰了 OIDC 认证流程。npm CLI 优先使用 `NODE_AUTH_TOKEN`，导致 OIDC 交换的 session token 被忽略
- **错误日志**：
  ```
  npm error code ENEEDAUTH
  npm error need auth This command requires you to be logged in.
  ```
- **解决**：在 `npm publish` step 的 env 块中显式设置 `NODE_AUTH_TOKEN: ''`

### 坑 3：npm 版本过低（核心拦路虎）

- **现象**：
  - `npm whoami` 返回 `E401`
  - `npm publish` 返回 `404 Not Found`（实际是权限问题被误报为 404）
  - provenance 签名显示成功，但发布请求被拒
- **原因**：Node.js 20 自带 npm 10.9.7，**npm < 11.5.0 不完全支持 OIDC Trusted Publishing**。虽然 sigstore 客户端能生成签名，但 npm CLI 的 OIDC token 交换流程有 bug，导致 session token 无效
- **尝试的解决方案**：
  ```yaml
  # 方案1：npx npm@latest install -g
  # 结果：只安装了 1 个包，npm 版本未变（10.9.7）
  
  # 方案2：npm install -g npm@11
  # 结果：MODULE_NOT_FOUND error (promise-retry 模块缺失)
  ```
- **最终解决**：使用 `node-version: '24'`，Node 24 自带 npm 11.11.0

### 坑 4：repository 字段缺失

- **现象**：`npm publish` 返回 `E422 Unprocessable Entity`
- **错误日志**：
  ```
  Error verifying sigstore provenance bundle: Failed to validate repository information:
  package.json: "repository.url" is "", expected to match "https://github.com/xwh5/multi-publisher"
  ```
- **原因**：使用 `--provenance` 时，npm 会验证 `package.json` 中的 `repository.url` 必须与 provenance 中声明的 GitHub 仓库地址完全一致
- **解决**：在 `package.json` 中添加：
  ```json
  "repository": {
    "type": "git",
    "url": "https://github.com/xwh5/multi-publisher"
  }
  ```

### 坑 5：GitHub Secrets 中残留 NPM_TOKEN

- **现象**：OIDC 认证一直失败，提示 `need auth`
- **原因**：在早期调试时添加了 `NPM_TOKEN` secret，后来虽然删除了代码中的引用，但可能 GitHub Actions 的某些版本缓存了 secret
- **解决**：确认 GitHub 仓库 Settings → Secrets and variables → Actions 中完全删除 `NPM_TOKEN` secret

### 坑 6：permissions.contents 权限不足

- **现象**：OIDC token 请求失败
- **原因**：最初设置了 `permissions.contents: read`，但 npm OIDC 需要 `write` 权限
- **解决**：改为 `permissions.contents: write`

### 坑 7：npm 包版本号冲突

- **现象**：本地发布 1.0.0 后，CI 尝试发布也用 1.0.0，npm 拒绝重复版本
- **原因**：`package.json` 中 `version` 字段未更新
- **解决**：本地先 `npm version 1.0.1`，让 package.json 与 npm 上已存在的版本错开

---

## 调试过程时间线

| 时间 | 尝试 | 结果 | 关键发现 |
|------|------|------|----------|
| 最初 | 使用 `NODE_AUTH_TOKEN` + `NPM_TOKEN` secret | ❌ ENEEDAUTH | token 权限不足 |
| 第2次 | 添加 `NPM_TOKEN` secret（Granular token） | ❌ E403 2FA required | Granular token 未勾选 2FA bypass |
| 第3次 | 使用 Recovery token | ❌ E403 | Recovery token 不能用于发布 |
| 第4次 | 本地手动发布 1.0.0 成功 | ✅ | npm 包名占用完成 |
| 第5次 | 切换 OIDC，删除 NPM_TOKEN secret | ❌ ENEEDAUTH | NODE_AUTH_TOKEN 干扰 + npm 版本旧 |
| 第6次 | 添加 `NODE_AUTH_TOKEN: ''` | ❌ 401 | npm 版本问题仍然存在 |
| 第7次 | `node-version: '22'` + `npx npm@latest install -g` | ❌ npm 仍为 10.9.7 | 升级命令未生效 |
| 第8次 | `node-version: '24'` | ❌ E422 | repository 字段缺失 |
| 第9次 | 添加 `repository` 字段 | ✅ **成功** | 所有问题解决 |

---

## OIDC Trusted Publishing 核心原理

### 传统方式（需存储 token）
```
GitHub Secrets (NPM_TOKEN) → GitHub Actions env → npm publish
```
**缺点**：token 可能泄露，2FA 用户需要 OTP

### OIDC 方式（无需 token）
```
GitHub (id-token: write) → GitHub OIDC Endpoint → npm OIDC Endpoint → 临时 session token → npm publish
```
**优点**：无需存储任何 secret，npm 自动验证 GitHub 身份

**关键要求**：
1. GitHub: `permissions.id-token: write` + `permissions.contents: write`
2. npm: 在 Trusted Publishers 中配置 GitHub 仓库信任关系
3. npm CLI: >= 11.5.0（建议用 Node 24）
4. `package.json`: `repository.url` 必须匹配 GitHub 仓库地址
5. `NODE_AUTH_TOKEN` 必须清空，避免干扰

---

## 经验总结

1. **Node 24 是关键**：不要尝试在 CI 中升级 npm，直接用 Node 24 自带的 npm 11+
2. **NODE_AUTH_TOKEN 必须清空**：GitHub Actions 自动注入的这个环境变量会干扰 OIDC
3. **repository 字段不能少**：使用 `--provenance` 时必须提供
4. **Granular token + 2FA bypass**：如果不用 OIDC，用 token 方式发布，需要创建 Granular Access Token 并勾选 "Allow 2FA bypass for CI/CD"
5. **Trusted Publisher 配置只需一次**：配置好后，OIDC 完全自动，无需任何手动维护

---

## 快速参考：下次如何发布新版本

```bash
# 1. 更新 package.json 中的 version
npm version 1.0.2 --no-git-tag-version

# 2. 提交并推送
git add package.json
git commit -m "chore: bump version to 1.0.2"
git push

# 3. 打 tag 推送，自动触发 GitHub Actions
git tag v1.0.2
git push origin v1.0.2

# 4. 查看发布状态
gh run list --repo xwh5/multi-publisher

# 5. 验证 npm 包
npm view multi-publisher versions
```

---

*Last updated: 2026-04-18*
