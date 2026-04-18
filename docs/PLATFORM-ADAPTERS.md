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
