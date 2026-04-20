# 平台适配器开发经验总结

## 2026-04-17

---

## 1. 头条号 (Toutiao) 适配器

### 问题：保存失败 (7050 错误)
- **根因**：平台反自动化检测，识别出浏览器为机器人操作
- **错误信息**：`navigator.webdriver = true` 暴露自动化特征

### 解决方案：CDP 深度注入

```typescript
const browser = await chromium.launch({
  headless: false,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-devtools-shm-usage',
    '--no-sandbox',
  ]
})

const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
})

const page = await context.newPage()

// 使用 CDP 隐藏自动化特征
const cdp = await page.context().newCDPSession(page)
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
  `
})
```

### 关键要点
1. `addInitScript` 不够用，必须用 CDP `Page.addScriptToEvaluateOnNewDocument`
2. 需要设置真实的 User-Agent
3. 浏览器启动参数 `--disable-blink-features=AutomationControlled` 很重要
4. 头条号会自动保存草稿，等待即可（可能需要 1-5 分钟）

---

## 2. 小红书 (Xiaohongshu) 适配器

### 问题
1. Cookie 配置后仍然跳转登录页
2. 登录检测严格

### 经验
- 登录 URL 应使用 `https://creator.xiaohongshu.com/` 而非 `https://www.xiaohongshu.com/`
- Cookie 需要设置 `.xiaohongshu.com` 域名
- 小红书有较强的反爬机制，可能需要和头条号类似的反检测措施

### 待解决
- [ ] Cookie 设置后仍然无法自动登录
- [ ] 需要在登录时保持浏览器会话复用
- [ ] 抓包未成功获取保存草稿的 API

---

## 3. 反自动化检测要点

### 检测特征
1. `navigator.webdriver` - 最容易被检测
2. `navigator.plugins` - 自动化浏览器插件列表异常
3. `navigator.languages` - 语言设置异常
4. `window.chrome` - 无头浏览器没有此对象
5. 浏览器指纹 (WebGL, Canvas)
6. 用户行为模式（操作太"完美"）

### 应对措施
1. **CDP 脚本注入** - 最有效
2. **浏览器启动参数** - 基础防护
3. **真实 User-Agent** - 模拟真实浏览器
4. **随机延迟** - 模拟人类操作节奏

---

## 4. API 抓包方法

### 工具
- Playwright 监听 `page.on('request')` 和 `page.on('response')`
- Chrome DevTools Network 面板

### 过滤关键词
```
creator.xiaohongshu.com
edith.xiaohongshu.com
apm-fe.xiaohongshu.com (监控数据，非业务API)
```

### 小红书可能的 API
- `as.xiaohongshu.com/api/p/pj` - 反爬验证
- `as.xiaohongshu.com/api/sec/v1/scripting` - 安全脚本
- `t2.xiaohongshu.com/api/v2/collect` - 数据上报

---

## 5. 下一步计划

### 优先级高
- [ ] 解决小红书 Cookie 登录问题
- [ ] 完善小红书适配器 UI 元素定位
- [ ] 测试小红书发布流程

### 优先级中
- [ ] 其他平台适配器完善
- [ ] 图片上传功能
- [ ] 封面设置

### 平台列表
- [x] 头条号 - 完成
- [ ] 小红书 - 进行中
- [ ] 微博 - 待测试
- [ ] B站 - 待测试
- [ ] 知乎 - 待测试
- [ ] 掘金 - 待测试

---

## 6. CSDN 封面图浏览器上传

### 背景
CSDN 的封面上传没有公开 API，且签名机制复杂。最终采用浏览器自动化方式上传。

### 关键发现

#### 1. 抓包工具的使用
`src/tools/capture.ts` 可以拦截浏览器请求，记录所有 API 调用。
- 运行 `node dist/cli/index.js capture -p csdn --timeout 60000`
- 访问目标页面，操作完成后查看 `temp/capture-csdn-*.json`
- 过滤 `upload`、`obs`、`image` 等关键词

#### 2. 图片尺寸要求
CSDN 对封面图有最小尺寸要求：
- **最小**: 900px 宽
- **建议**: 1200x500 或更大
- 小图片会提示"图片尺寸过小"错误

#### 3. 多步骤按钮流程
CSDN 封面上传需要点击多个按钮：

```
发布按钮 → 弹出框 → 从本地上传按钮 → 选择文件 → 确认上传按钮 → 保存为草稿按钮
```

**完整流程：**
1. 点击"发布"按钮 → 弹出发布设置弹窗
2. 点击"从本地上传"按钮 → 激活文件选择（隐藏的 file input）
3. `setInputFiles()` 设置图片文件 → 图片加载到裁剪弹窗
4. 点击"确认上传"按钮 → 上传到华为云 OBS
5. 点击"保存为草稿"按钮 → 保存封面设置

**关键代码片段：**
```typescript
// 1. 点击"从本地上传"按钮
const uploadBtn = page.locator('.upload-img-box').first()
await uploadBtn.click()

// 2. 设置文件（file input 是隐藏的，但 setInputFiles 可以工作）
await coverInput.setInputFiles(absolutePath)

// 3. 点击"确认上传"
const confirmBtn = page.locator('.vicp-operate-btn:has-text("确认上传")')
await confirmBtn.click()

// 4. 点击"保存为草稿"
const saveDraftBtn = page.locator('button:has-text("保存为草稿")')
await saveDraftBtn.click()
```

#### 4. File Input 特殊性
CSDN 的封面 file input 是隐藏的（`display: none`），但：
- Playwright 的 `setInputFiles()` 可以绕过可见性检查
- `page.setInputFiles()` 比 locator 的更可靠
- 需要先触发 change 事件：`await coverInput.dispatchEvent('change')`

### 调试建议

#### 1. 截图调试
在关键步骤截图，方便观察 UI 状态：
```typescript
await page.screenshot({ path: `temp/csdn-publish-dialog-${Date.now()}.png` })
```

#### 2. 列出所有按钮
如果某个按钮找不到，先列出弹窗中所有按钮：
```typescript
const modalButtons = page.locator('[class*="modal"] button')
const count = await modalButtons.count()
for (let i = 0; i < count; i++) {
  const text = await modalButtons.nth(i).textContent()
  console.log(i + ':', text.trim())
}
```

#### 3. 重试机制
如果 setInputFiles 失败，可以尝试：
- 使用 `page.setInputFiles()` 直接设置
- 通过 `page.evaluate()` 手动触发 file input 的 change 事件
- 使用 filechooser 事件监听：`page.on('filechooser', ...)`

#### 4. 什么时候需要人工协助
- 多次重试后仍然失败
- UI 结构复杂，无法定位元素
- 出现未知的错误提示
- 需要确认某个 UI 元素的具体位置

### 相关文件
- `src/tools/browser-upload.ts` - 浏览器上传实现
- `src/tools/capture.ts` - 抓包工具
- `src/adapters/csdn.ts` - CSDN 适配器，集成浏览器上传

---

## 7. 头条号封面图浏览器上传

### 关键发现

#### 1. 发布流程
头条号的封面上传在"预览并发布"弹窗中进行：
1. 填写标题和内容
2. 点击"预览并发布"按钮 → 弹出预览框
3. 在预览框中选择"单图"
4. 点击封面添加区域 → 触发文件选择
5. 点击"本地上传" → 弹出系统文件选择
6. 选择图片后点击"确定"
7. 等待 5 秒让封面上传保存
8. 点击"继续编辑"关闭弹窗
9. 再次点击发布按钮保存草稿

#### 2. File Chooser 事件
头条号使用系统文件选择器，需要监听 `filechooser` 事件：
```typescript
page.on('filechooser', async (fileChooser) => {
  await fileChooser.setFiles(absolutePath)
})
```

#### 3. 关键选择器
- `.article-cover-add` - 封面添加区域
- `text=单图` - 单图选项
- `text=本地上传` - 本地上传按钮
- `button:has-text("确定")` - 确认按钮
- `button:has-text("继续编辑")` - 关闭弹窗按钮

#### 4. 等待时间
封面上传后需要等待 5 秒让服务器保存，之后可以继续操作。

### 相关文件
- `src/adapters/toutiao.ts` - 头条号适配器，集成封面上传
- `src/tools/toutiao-upload.ts` - 头条号封面上传工具（备用独立工具）
