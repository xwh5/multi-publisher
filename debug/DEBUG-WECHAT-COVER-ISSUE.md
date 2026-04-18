# 微信公众号封面图问题调试记录

> 时间：2026-04-18
> 版本：v1.0.2 → v1.0.3
> 问题：文章无图片时，微信公众号发布失败，提示 `invalid media_id`

---

## 问题现象

使用 `mpub publish -f <纯文字文章.md> -p weixin` 发布时，微信公众号报错：

```
[WechatPublisher] 封面上传失败: 封面图 URL 为空
[WechatPublisher] 没有可用封面，将使用微信默认封面（不传 thumb_media_id）
❌ 发布失败: 发布草稿失败: invalid media_id hint: [o_aWUA021478-5] rid: 69e345c6-21c8f39b-67a48fce
```

文章没有图片（纯文字 + 代码），无法提取封面图。

---

## 问题根因（两个独立的 bug）

### Bug 1：createReadStream + FormData 在 Windows 上传图片失败

在 `src/adapters/wechat-publisher.ts` 中，`uploadImageFromPath` 和 `uploadPermanentImageFromPath` 都使用 `createReadStream` 传给 FormData：

```typescript
// 错误写法 - Windows 上 stream 不被 FormData 正确处理
form.append('media', createReadStream(filePath), filename)

// 正确写法 - 直接传 Buffer
form.append('media', readFileSync(filePath), { filename, contentType: 'image/png' })
```

测试确认：同样一张 PNG（httpbin 的 8090 bytes 测试图），用 buffer 传 FormData → 成功返回 media_id；用 stream 传 → 40113 unsupported file type。

### Bug 2：这个公众号 thumb_media_id 是必填的

排查过程：
- 即使 payload 里完全不传 `thumb_media_id`，也报 40007 invalid media_id
- 上传占位图获取真实 `media_id` 后传入 `draft/add` → **成功**
- 结论：部分公众号账号（特别是订阅号），`thumb_media_id` 对 `draft/add` 接口是必填的，即使文档说可选

---

## 解决方案

1. **修复 stream 问题**：所有 `createReadStream` 改为 `readFileSync` buffer
2. **添加占位图 fallback**：当无封面且正文无图片时，下载 httpbin 测试图作为占位图上传

**新增方法 `uploadPlaceholderCover()`**：

```typescript
async uploadPlaceholderCover(): Promise<string> {
  const token = await this.getAccessToken()
  // 从 httpbin 下载有效 PNG
  const res = await this.runtime.fetch('https://httpbin.org/image/png')
  const buf = await res.arrayBuffer()
  const png = Buffer.from(buf)

  const form = new FormData()
  form.append('media', png, { filename: 'cover.png', contentType: 'image/png' })
  form.append('type', 'image')

  const uploadRes = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
    form,
    { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity }
  )
  const data = uploadRes.data as { media_id?: string; ... }
  if (!data.media_id) throw new Error(...)
  return data.media_id
}
```

**publishToDraft fallback 逻辑**：

```typescript
if (!thumbMediaId) {
  try {
    thumbMediaId = await this.uploadPlaceholderCover()
    console.log('[WechatPublisher] 使用占位图作为封面')
  } catch (err) {
    console.warn('[WechatPublisher] 占位图上传失败，不传 thumb_media_id:', err.message)
  }
}
```

---

## 修复文件

- `src/adapters/wechat-publisher.ts`：
  - import 新增 `readFileSync`
  - `uploadImageFromPath`：stream → buffer
  - `uploadPermanentImageFromPath`：stream → buffer
  - `publishToDraft`：fallback 改用 `uploadPlaceholderCover()`
  - 新增 `uploadPlaceholderCover()` 方法

---

## 调试过程时间线

| 步骤 | 尝试 | 结果 | 发现 |
|------|------|------|------|
| 1 | 发布无图文章 | 40007 invalid media_id | thumb_media_id 相关 |
| 2 | 不传 thumb_media_id | 仍报 40007 | 这个账号 thumb_media_id 必填 |
| 3 | 用 stream 上传 PNG | 40113 unsupported file type | stream 在 Windows 上有问题 |
| 4 | 改用 buffer 上传 | 成功获取 media_id | 修复 stream 问题 |
| 5 | 用真实 media_id 创建草稿 | 成功 | 两个 bug 全部修复 |

---

*Last updated: 2026-04-18*
