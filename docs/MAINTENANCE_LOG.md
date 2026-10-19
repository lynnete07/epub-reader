# 维护记录

按 `docs/MAINTENANCE_SOP.md` 执行，每次维护追加一条，只写事实与结论。

## 2026-10-19 — 刷新后书籍消失（存储配额）+ 字体面板改二选一

**现象**
自定义字体粘贴后仍无变化；且刷新页面后书籍一起消失、回到初始上传界面。

**根因：书籍二进制存在 localStorage，配额必然不够**
EPUB 被转成 base64 分块写进 localStorage 的 `<bookId>_chunk_N`。问题是：

- localStorage 配额约 5MB，且**按 UTF-16 字符计费**（1 个字符 ≈ 2 字节）；
- base64 又让体积膨胀约 33%；
- 两者叠加后，**约 1.9MB 以上的书就写不下**——而带图的 EPUB 普遍超过这个量级。

后果是双重的：

1. 分块写不全 → `restoreBookFromId()` 发现缺块 → 返回 false → 回到首页（"书籍消失"）；
2. 配额被分块占满 → `saveSettings()` 抛 `QuotaExceededError`（原先无 try/catch，异常直接抛给调用方）→ **字体设置与阅读进度都写不进去**（"字体不生效/记不住"）。

即便 `settings.readingProgress[bookId]` 存在，恢复也会因缺块失败——两个现象同一个源头。

**修复**
- 书籍二进制改存 **IndexedDB**（`lightreader-books` / `files` 库），直接存 `ArrayBuffer`，不转 base64，容量不再受限。localStorage 分块仅作 IndexedDB 不可用时的回落，`fileInfo.storage` 如实记录去向。
- `restoreBookFromId()` 改为先查 IndexedDB，查不到再试历史 localStorage 分块。
- 新增 `migrateLegacyBookChunks()`：启动时把历史遗留的 localStorage 分块搬进 IndexedDB，**只有 IndexedDB 写入成功才删除原分块**（避免两头丢失），把被占满的配额还给设置存储。
- `saveSettings()` 加容错：绝不向外抛异常；配额不足时精简为只保留当前书籍进度再重试一次。
- 恢复流程等迁移完成再执行，避免读到半迁移状态。

**字体面板交互（用户反馈"二选一不明确"）**
- 两项改为单选语义：每项前置圆点指示器，任何时候只有一项高亮。
- 自定义区改为「使用本机字体（自定义）」按钮 + 输入框 + 「应用」/「清除」按钮；未填内容点按钮会聚焦输入框而不是静默无反应。
- 面板底部新增状态行「当前生效：…」，切换后立即可见。
- 不再自动关闭面板，方便看到选择结果。

**验证**
- 存储层从真实源码抽取，用 stub 的 localStorage / IndexedDB 跑 12 条用例全过：分块往返字节一致、缺块返回 null、IndexedDB 往返一致、迁移后数据完整且 localStorage 释放、**IndexedDB 不可用时分块必须保留**（防数据两头丢）。
- 字体逻辑回归 8/8 通过。`node --check` 全过。
- Service Worker 缓存版本 `v6` → `v7`。

**未能验证**：沙箱无法访问 vercel.app（curl/WebFetch/Chrome CDP 均被拦截），浏览器端实际渲染与刷新恢复需人工确认。

## 2026-10-19 — 修复自定义字体输入后完全不生效

**现象**
用户粘贴 `iA Writer Quattro S, 方正屏显雅宋简体` 后正文无任何变化；刷新也不恢复。

**根因（决定性，单一）**
`applyFontFamily()` 中的合法性校验把自定义键当成非法键清掉了：

```js
if (key === CUSTOM_FONT_KEY && !(settings.customFontStack || '').trim()) key = DEFAULT_FONT_KEY;
if (!READER_FONTS[key]) key = DEFAULT_FONT_KEY;   // ← READER_FONTS 现在只有 sans，custom 必被回落
```

面板精简为两项后，`READER_FONTS` 表里只剩 `sans` 一项，`custom` 不在表中，于是**任何**自定义输入都会被静默降级为默认无衬线。更糟的是随后 `settings.fontFamily = key` 会把 `sans` 持久化进 localStorage，因此刷新恢复路径同样失效。

**修复**
- `applyFontFamily()` 引入 `useCustom` 判定先行放行自定义键：`!useCustom && !READER_FONTS[key]` 才回落默认；自定义栈为空时仍回落。
- 自定义字体沿用默认档行距（`READER_FONTS[DEFAULT_FONT_KEY].lineHeight`），不再依赖表里不存在的条目。
- 交互补全：自定义输入框回车立即提交并关闭面板（`change` 虽会触发，但面板不关，用户易误判为没生效）。

**为何上轮的 12 条测试没抓到**
上轮测试只覆盖了 `getFontStack()` / `customStackToCss()` 的栈转换，未覆盖 `applyFontFamily()` 的**键归一化**这一步——bug 恰好住在这一层。教训：测试要覆盖到"设置真正落到 DOM"的那一层，而不是只测纯函数。

**已知副作用（不做自动迁移）**
缺陷版本已把 `fontFamily: "sans"` 与用户输入的 `customFontStack` 一起写入 localStorage。修复后刷新不会自动恢复自定义字体——需要用户重新粘贴一次（或清空输入框重填）。不写自动迁移的原因：无法区分"用户显式点回默认"与"缺陷版本写入的 sans"，强行迁移会让"默认 · 无衬线"永远无法选中。

**验证**
- 从真实源码抽取 `applyFontFamily` + `customStackToCss` + `getFontStack`，注入 stub DOM 跑 8 条用例：修复前 3 条失败（应用值 / fontFamily 保持 custom / 刷新恢复路径），修复后 8/8 通过。
- 再次确认两款字体在本机的真实 family 名：`iA Writer Quattro S`、`方正屏显雅宋简体`（带"简体"后缀，PostScript 名 `FZPingXianYaSongS-R-GB`）。
- Service Worker 缓存版本 `v5` → `v6`。

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
