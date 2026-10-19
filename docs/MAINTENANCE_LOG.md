# 维护记录

按 `docs/MAINTENANCE_SOP.md` 执行，每次维护追加一条，只写事实与结论。

## 2026-10-19 — 字体面板改为"默认 + 自定义本机字体"，字号与行距优化

**用户决策**
- 面板构成比预置多档更克制：仅"默认 · 无衬线" + "自定义"两项；品味通过自定义栈与提示文案中的示例进入体验。
- 字号上限 24 → 32（无障碍与移动端大字）；行距随字体成套切换（映射表 lineHeight 字段，默认 1.7）。

**关键事实（实现依据）**
- 两支推荐字体均已装在用户 Mac：`~/Library/Fonts/方正屏显雅宋.TTF`（family 名 `方正屏显雅宋简体`，带"简体"后缀）、`iAWriterQuattroS*.ttf`（family 名 `iA Writer Quattro S`）。
- 两支均为商业授权字体，打包进仓库属再分发，不可行；引用字体名合法，未安装设备走默认栈回退。
- 自定义输入支持逗号分隔回退栈：`iA Writer Quattro S, 方正屏显雅宋简体` = 拉丁字形 Quattro S、中文自动回退雅宋。
- 发现死代码：CSS 的响应式字号媒体查询（≥1200px 20px / ≤600px 16px）被 JS 内联样式永久覆盖（settings 首次保存即触发），真实使用中从未生效。暂未处理，待后续决策。

**实现**
- `customStackToCss()`：字体名统一加引号、剥内嵌双引号、尾部追加默认栈兜底；空输入回落默认。
- 面板自定义区：输入即时预览（input 事件），失焦/回车提交（change）；提示文案说明如何查本机字体名（macOS 字体册 / Windows 设置）与多字体语言分工。
- 旧版本遗留 fontFamily 键（serif/song/kai/mono）自动回落默认，无迁移。
- Service Worker 缓存版本 `v4` → `v5`。

**验证**
- 核心逻辑从真实源码抽取跑 12 条用例全过（多字体栈 / 引号规范化 / 空输入 / 注入 / 旧键回落 / 行距字段 / 字号边界）。
- 浏览器端待人工确认：输入 Quattro S + 雅宋后中英文分别生效、输入框即时预览、刷新记忆恢复、字号可到 32。

## 2026-10-19 — 首次完整维护（距上次提交 2025-04-16 约 18 个月）

**修复**
- `service-worker.js`：预缓存列表里的 `/favicon.ico` 已不存在，而 `cache.addAll` 是原子的，一条失败会拖垮整个 install，导致离线与 PWA 全部失效。改为逐项缓存并吞掉单条失败；缓存版本 `v1` → `v2`。
- 提交署名由占位符「您的GitHub用户名」改为 `lynnete07` + GitHub noreply 邮箱。

**移除**
- URL 中的 `?sid=session-xxx`：每次加载随机生成、从未被读取或上报的死代码。它不能用于统计用户，只会让分享链接带上无意义参数。

**新增（数据采集范围变化）**
- `index.html` 引入 Vercel Web Analytics（无 cookie、无指纹）。**必须在 Vercel 后台启用后才会发送数据。**
- `js/epub-reader.js` 新增 `trackEvent()`，埋两个匿名事件：`epub_opened`、`chapter_viewed`。只上报事件名，不含书名、作者、正文、阅读位置或书籍 ID。

**清理**
- `css/styles.css`：删除全项目未被引用的 `.error-message` 等死样式。
- `server.js`：本地开发端口 3500 → 3300。
- 删除已不使用的 `favicon.ico`（图标改由 `index.html` 内联 data URI 提供）。

**文档**
- 新增 `docs/MAINTENANCE_SOP.md`（维护流程）、本文件。

**遗留待办**
- [ ] Vercel 后台 → 项目 → Analytics → 启用（不启用则统计为零）
- [ ] `manifest.json` 声明的 `img/icon-192.png`、`img/icon-512.png` 不存在，"添加到主屏幕"会降级

**决策记录**

- **保留自定义事件代码，暂不升级 Vercel 套餐**（2026-10-19）。理由：Hobby 计划下 `epub_opened`、`chapter_viewed` 只在后台不可见，但代码零副作用——`window.va` 不存在时 `trackEvent()` 静默跳过，不影响阅读、不发送数据。将来若想看"有没有人真的打开书"再升级，代码一行都不用改。当前可见性只到第一层（访客 / 浏览量 / 来源 / 国家 / 设备）。

## 2026-10-19 — 新增正文字体选择功能

**方案（与用户讨论定稿）**
- 字体来源：仅系统字体栈（5 项：默认无衬线 / 衬线 Georgia / 宋体 / 楷体 / 等宽），零下载、零缓存负担；`settings.fontFamily` 存键名，将来加自带字体只需在 `READER_FONTS` 映射表加一项。
- 覆盖策略：`!important` 压过书籍 CSS 元素级声明，`pre/code/kbd/samp` 豁免保留等宽（讨论中否决了"温柔继承"——Calibre 类书几乎每段都带字体声明，温柔继承会让设置在最多的书上失效，用户感知为"功能坏了"）。
- UI：header 字体按钮 + 弹出面板，条目用自身字体渲染名字做预览，点击即生效（CSS 变量切换零重渲染）。

**实现**
- `--reader-font-family` 挂在 viewer 上，作用域限于 `.chapter-content`，界面与目录不受影响。
- 切换字体按 scrollHeight 比例换算滚动位置，防进度漂移。
- Service Worker 缓存版本 `v3` → `v4`（预缓存资源内容变化）。

**验证**
- `node --check` 通过；工作区改动与提交一致性已核验。浏览器端待人工确认：衬线切换立竿见影、代码块等宽保留、刷新后字体记忆恢复。

## 2026-10-19 — 修复章节图片与外链样式表无法显示

**根因（两个 bug 叠加）**
1. `displayChapter()` 在图片替换**之前**就把 `<body>` 序列化成字符串快照，图片循环改的是游离 DOM，最终渲染仍用旧字符串，所有 blob URL 替换被丢弃。本地图片自上线起从未生效。
2. `new URL(src, 'file://' + chapter.href)`：`chapter.href` 无前导斜杠，`OEBPS` 被当作主机名，解析丢掉整个子目录前缀，`zip.file()` 返回 null。只有扁平结构的 EPUB 恰好能过；外链样式表 href 同样中招。

**修复**
- `bodyContent` 序列化移到资源替换之后。
- 新增 `resolveZipPath()`：base 用 `file:///`，结果 `decodeURIComponent`，跳过 `data:` 与 `http(s)://`。
- 覆盖内嵌 SVG `<image href/xlink:href>`；CSS 内 `url()` 背景图替换为 blob URL（以样式表自身路径为基准）。
- 新增 `releaseObjectUrls()`，切章回收 blob URL，防内存增长。
- Service Worker 缓存版本 `v2` → `v3`。

**验证**
- `resolveZipPath` 从真实源码抽取跑 12 条用例全过（子目录 / `../` / `./` / 空格 / 中文 / 扁平 / 外链跳过）。
- 测试 EPUB：`~/Downloads/lightreader-image-test.epub`（含子目录、空格文件名、CSS 背景图、SVG 图），浏览器实读待人工确认。

**未能验证**
- 本次维护所在环境的网络无法直连 Vercel 与外网，线上部署结果需人工在浏览器确认。
