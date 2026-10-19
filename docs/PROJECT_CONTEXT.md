# LightReader 项目上下文

## 一句话说明

LightReader 是一个由原生 HTML、CSS 和 JavaScript 构成的浏览器内 EPUB 阅读器。浏览器直接解析书籍，服务端只负责分发静态文件。

## 架构与数据边界

```text
访问者浏览器
  ├─ index.html + styles.css：界面与样式
  ├─ epub-reader.js：读取、解析并渲染本机选取的 EPUB
  ├─ localStorage：设置、书籍分块、进度
  └─ service-worker.js：静态资源离线缓存

Vercel
  └─ 仅托管静态文件；没有业务后端
```

EPUB 内容从用户的文件选择器或拖拽操作进入浏览器，使用 JSZip 在本地解析。`epub-reader.js` 把书籍分块及阅读状态写入 localStorage，以支持刷新或用 URL hash 恢复阅读。它不请求业务服务器。

## 运行时依赖

- 原生 JavaScript，无框架和打包器。
- `JSZip 3.10.1`：从 cdnjs 加载，用于读取 EPUB ZIP 内容。
- Font Awesome 6.4.0：从 cdnjs 加载，用于图标。
- Node.js：只用于本地 `server.js` 与 Vercel 构建环境。

`npm run build` 当前仅执行占位构建命令；部署产物就是仓库根目录内的静态文件，而不是 `dist/`。

## 功能代码地图

| 区域 | 主要入口 | 注意点 |
| --- | --- | --- |
| 设置与进度 | `loadSettings`、`saveSettings`、`saveReadingProgress` | 数据存储于 localStorage；修改键或数据结构需考虑旧数据兼容 |
| EPUB 导入 | `handleDrop`、`handleFileSelect`、`handleEpubFile` | 失败时应保留用户能重新选择文件的路径 |
| EPUB 解析 | `getOpfPath`、`parseOpf`、`parseNcx`、`parseNav` | 同时处理 EPUB 2 NCX 与 EPUB 3 nav |
| 阅读渲染 | `displayChapter`、`updateActiveTocItem` | 避免让章节渲染破坏目录状态和进度 |
| 手势与翻章 | `handleWheelScroll`、`handleTouchStart`、`handleTouchMove` | 需兼顾滚动阈值和移动端行为 |
| URL 恢复 | `updateBookHash`、`handleHashChange`、`restoreBookFromId` | 书籍本体仍只在同一浏览器 localStorage 中，链接不能跨设备共享书籍 |
| PWA | `service-worker.js`、`manifest.json` | 资源表与缓存版本必须一起维护 |

## 当前发布模型

`vercel.json` 的有效配置是：执行 `npm run build`、输出目录为 `.`，保留真实静态文件，其他路径回退到 `index.html`。

Vercel 配置于 2025-04-14 的提交 `93d55c4` 加入，并由 `4140c7f` 修正。仓库最后提交为 `7eda5be`（2025-04-16）。本机未发现 `.vercel/` 目录、GitHub Actions、Netlify 或 GitHub Pages 配置，因此最可信的发布模型是 GitHub 与 Vercel 的集成发布。Vercel 管理台才是生产分支、部署状态、回滚和域名的权威来源。

`DEPLOY.md` 的 `dist/` 部署说明与实际配置不一致，保留它只能作历史参考。维护或部署决策应以 `vercel.json`、`package.json` 和 Vercel 管理台为准。

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

1. `npm run build` 成功。
2. `node --check js/epub-reader.js` 与 `node --check server.js` 成功。
3. 在本地完成核心阅读流程的手工测试。
4. 若改动了静态资源或应用逻辑，验证 Service Worker 更新路径。

### 改动发布或分析

1. 审查工作区已有改动，避免混入无关内容。
2. 在 Vercel Preview 验证，并确认正式分支规则。
3. 上线后用无痕窗口验证首访加载；统计启用后仅确认出现匿名页面浏览或允许的事件。
4. 回归隐私边界：网络请求中不应含书籍内容或可识别阅读数据。

## 待维护问题

已解决（2026-10-19）：`service-worker.js` 的 `/favicon.ico` 预缓存项已移除并改为逐项容错缓存；`css/styles.css`、`server.js` 的改动已审阅并纳入提交；Git 提交作者已由占位符改为 `lynnete07` + GitHub noreply；Web Analytics 代码已接入。

仍然开放：

1. **Vercel 后台的 Analytics 开关尚未开启**——不开启则访问数据为零，需人工在管理台确认。
2. `manifest.json` 声明了 `img/icon-192.png` 与 `img/icon-512.png`，但 `img/` 目录为空，PWA 图标 404，"添加到主屏幕"体验降级。要么补图标，要么删除这两条声明。
3. 自定义事件在 Hobby 计划后台不可见，需判断是否升级 Vercel 套餐。
4. CDN 依赖（JSZip 3.10.1、Font Awesome 6.4.0）长期未核对版本可用性。

维护流程见 [`docs/MAINTENANCE_SOP.md`](MAINTENANCE_SOP.md)，历次维护记录见 [`docs/MAINTENANCE_LOG.md`](MAINTENANCE_LOG.md)。
