# LightReader 项目上下文

## 一句话说明

LightReader 是一个由原生 HTML、CSS 和 JavaScript 构成的浏览器内 EPUB 阅读器。浏览器直接解析书籍，服务端只负责分发静态文件。

## 架构与数据边界

```text
访问者浏览器
  ├─ index.html + styles.css：界面与样式
  ├─ epub-reader.js：读取、解析并渲染本机选取的 EPUB
  ├─ IndexedDB：EPUB 二进制（主存储）
  ├─ localStorage：设置与阅读进度；旧版书籍分块仅作迁移和回退
  └─ service-worker.js：静态资源离线缓存

Vercel
  └─ 仅托管静态文件；没有业务后端
```

EPUB 内容从用户的文件选择器或拖拽操作进入浏览器，使用 JSZip 在本地解析。书籍二进制优先写入 IndexedDB，设置和进度写入 localStorage；历史 localStorage 分块会在启动时迁移。URL hash 只保存本机书籍 ID，因此链接不能跨设备恢复书籍，也不请求业务服务器。

> 安全边界：章节 HTML 不进入应用 DOM。`displayChapter()` 先净化 HTML、CSS 和 URL，再放入没有 `allow-scripts` 的 sandbox iframe；iframe 内 CSP 禁止默认网络来源与脚本，仅允许本地生成的 `blob:` / `data:` 图片和字体。保留 `allow-same-origin` 只用于父页面处理尺寸、键盘和书内链接，书籍自身没有可执行脚本。不要放宽这条边界；验收见 [`TESTING.md`](TESTING.md)。

## 运行时依赖

- 原生 JavaScript，无框架和打包器。
- `JSZip 3.10.1`：从 cdnjs 加载，用于读取 EPUB ZIP 内容。
- Font Awesome 6.4.0：从 cdnjs 加载，用于图标。
- Node.js：只用于本地 `server.js` 与 Vercel 构建环境。

部署产物就是仓库根目录内的静态文件，而不是 `dist/`；`npm run build` 不会产生新的打包产物。

## 功能代码地图

| 区域 | 主要入口 | 注意点 |
| --- | --- | --- |
| 设置与进度 | `loadSettings`、`saveSettings`、`saveReadingProgress` | 设置和进度存于 localStorage；修改键或数据结构需考虑旧数据兼容 |
| 书籍存储 | `openBookDb`、`storeBookFile`、`getBookFile`、`migrateLegacyBookChunks` | EPUB 二进制优先存 IndexedDB；localStorage 分块仅为旧数据迁移和 IndexedDB 不可用时的回退 |
| EPUB 导入 | `handleDrop`、`handleFileSelect`、`handleEpubFile` | 失败时应保留用户能重新选择文件的路径 |
| EPUB 解析 | `getOpfPath`、`parseOpf`、`parseNcx`、`parseNav` | 同时处理 EPUB 2 NCX 与 EPUB 3 nav |
| 阅读渲染 | `displayChapter`、`sanitizeEpubBody`、`createChapterFrameDocument`、`updateActiveTocItem` | 章节只能通过受限 iframe 渲染；避免让章节渲染破坏目录状态和进度 |
| 手势与翻章 | `handleWheelScroll`、`handleTouchStart`、`handleTouchMove` | 需兼顾滚动阈值和移动端行为 |
| URL 恢复 | `updateBookHash`、`handleHashChange`、`restoreBookFromId` | 书籍本体只在同一浏览器 IndexedDB / 回退 localStorage 中，链接不能跨设备共享书籍 |
| PWA | `service-worker.js`、`manifest.json` | 资源表与缓存版本必须一起维护 |

## 当前发布模型

`vercel.json` 的有效配置是：执行 `npm run build`、输出目录为 `.`，保留真实静态文件，其他路径回退到 `index.html`。

Vercel 配置于 2025-04-14 的提交 `93d55c4` 加入，并由 `4140c7f` 修正。仓库在 2026-10-20 仍有功能维护提交；不要再把 2025-04 的提交视作当前基线。本机未发现 `.vercel/` 目录、GitHub Actions、Netlify 或 GitHub Pages 配置，因此最可信的发布模型是 GitHub 与 Vercel 的集成发布。Vercel 管理台才是生产分支、部署状态、回滚和域名的权威来源。

`DEPLOY.md` 的 `dist/` 部署说明与实际配置不一致，保留它只能作历史参考。维护或部署决策应以 `vercel.json`、`package.json` 和 Vercel 管理台为准。

`npm run build` 会先执行 `npm test`，再输出静态资源构建提示；它不生成打包产物。`npm test` 是无浏览器的快速质量门，`npm run test:browser` 则固定验证 EPUB 2/3、隔离、恢复、重复导入和基础无障碍。

## 隐私与分析边界

`sid` URL 参数已于 2026-10-19 移除：它每次加载随机生成、从未被读取或上报，不能作为用户或会话标识，用它统计会严重高估独立访客。

统计现状（2026-10-19 接入）：

- `index.html` 引入 Vercel Web Analytics：`<script defer src="/_vercel/insights/script.js"></script>`。无 cookie、无指纹。**必须在 Vercel 后台为该项目启用 Analytics 后才会真正发送数据。**
- `js/epub-reader.js` 中的 `trackEvent()` 上报两个匿名事件：`epub_opened`（书籍成功打开）、`chapter_viewed`（章节成功渲染）。只含事件名。
- 自定义事件仅在 Vercel Pro / Enterprise 计划的 Events 面板可见；Hobby 计划后台看不到，但代码无副作用。
- 绝不发送 EPUB 文件、书名、作者、正文、阅读位置、localStorage 键值或书籍 ID。
- 任何新增统计事件都必须更新本节，并在 `docs/MAINTENANCE_LOG.md` 记录数据采集范围的变化。

## 修改后的验收标准

### 任何代码改动

1. 先按 [`TESTING.md`](TESTING.md) 的静态、功能、安全与 PWA 检查执行。
2. `npm run build` 仅作为脚本健全性检查，不能替代测试。
3. 若改动了静态资源或应用逻辑，验证 Service Worker 更新路径并递增缓存版本。

### 改动发布或分析

1. 审查工作区已有改动，避免混入无关内容。
2. 在 Vercel Preview 验证，并确认正式分支规则。
3. 上线后用无痕窗口验证首访加载；统计启用后仅确认出现匿名页面浏览或允许的事件。
4. 回归隐私边界：网络请求中不应含书籍内容或可识别阅读数据。

## 待维护问题

已解决（2026-10-19）：`service-worker.js` 的 `/favicon.ico` 预缓存项已移除并改为逐项容错缓存；`css/styles.css`、`server.js` 的改动已审阅并纳入提交；Git 提交作者已由占位符改为 `lynnete07` + GitHub noreply；Web Analytics 代码已接入。

仍然开放：

1. **Vercel 后台的 Analytics 开关可能尚未开启**——不开启则访问数据为零，需人工在管理台确认。
2. 自定义事件在 Hobby 计划后台不可见。已决定保留代码、暂不升级套餐（2026-10-19）：`window.va` 不存在时 `trackEvent()` 静默跳过，零副作用；升级后可直接在 Events 面板看到，无需改代码。
3. CDN 依赖（JSZip 3.10.1、Font Awesome 6.4.0）长期未核对版本可用性。

维护流程见 [`docs/MAINTENANCE_SOP.md`](MAINTENANCE_SOP.md)，历次维护记录见 [`docs/MAINTENANCE_LOG.md`](MAINTENANCE_LOG.md)。
