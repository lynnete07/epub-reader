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

GitHub Pages
  └─ 仅托管静态文件；没有业务后端
```

EPUB 内容从用户的文件选择器或拖拽操作进入浏览器，使用 JSZip 在本地解析。书籍二进制优先写入 IndexedDB，设置和进度写入 localStorage；历史 localStorage 分块会在启动时迁移。URL hash 只保存本机书籍 ID，因此链接不能跨设备恢复书籍，也不请求业务服务器。

> 安全边界：章节 HTML 不进入应用 DOM。`displayChapter()` 先净化 HTML、CSS 和 URL，再放入没有 `allow-scripts` 的 sandbox iframe；iframe 内 CSP 禁止默认网络来源与脚本，仅允许本地生成的 `blob:` / `data:` 图片和字体。保留 `allow-same-origin` 只用于父页面处理尺寸、键盘和书内链接，书籍自身没有可执行脚本。不要放宽这条边界；验收见 [`TESTING.md`](TESTING.md)。

## 运行时依赖

- 原生 JavaScript，无框架和打包器。
- `JSZip 3.10.1`：从 cdnjs 加载，用于读取 EPUB ZIP 内容。
- Font Awesome 6.4.0：从 cdnjs 加载，用于图标。
- Node.js：只用于本地 `server.js` 与 GitHub Actions 校验环境。

部署产物就是仓库根目录内的静态文件，而不是 `dist/`；`npm run build` 不会产生新的打包产物。

## 功能代码地图

| 区域 | 主要入口 | 注意点 |
| --- | --- | --- |
| 设置与进度 | `loadSettings`、`saveSettings`、`saveReadingProgress` | 设置和进度存于 localStorage；修改键或数据结构需考虑旧数据兼容 |
| 书籍存储 | `openBookDb`、`storeBookFile`、`getBookFile`、`migrateLegacyBookChunks` | EPUB 二进制优先存 IndexedDB；localStorage 分块仅为旧数据迁移和 IndexedDB 不可用时的回退 |
| EPUB 导入 | `handleDrop`、`handleFileSelect`、`handleEpubFile` | 失败时应保留用户能重新选择文件的路径 |
| ZIP 防护 | `js/zip-safety.js` | 在 JSZip 前限制归档大小、条目数、解压体积、压缩比与解析时间 |
| EPUB 解析 | `getOpfPath`、`parseOpf`、`parseNcx`、`parseNav` | 同时处理 EPUB 2 NCX 与 EPUB 3 nav |
| 阅读渲染 | `displayChapter`、`sanitizeEpubBody`、`createChapterFrameDocument`、`updateActiveTocItem` | 章节只能通过受限 iframe 渲染；避免让章节渲染破坏目录状态和进度 |
| 手势与翻章 | `handleWheelScroll`、`handleTouchStart`、`handleTouchMove` | 需兼顾滚动阈值和移动端行为 |
| URL 恢复 | `updateBookHash`、`handleHashChange`、`restoreBookFromId` | 书籍本体只在同一浏览器 IndexedDB / 回退 localStorage 中，链接不能跨设备共享书籍 |
| PWA | `service-worker.js`、`manifest.json` | 资源表与缓存版本必须一起维护 |

## 当前发布模型

`vercel.json` 保留了其他静态平台的构建与 SPA 回退配置；当前 GitHub Pages 发布不依赖它。

`vercel.json` 于 2025-04-14 加入，并由 `4140c7f` 修正；它仍可作为其他静态平台的回退配置。2026-10-27 的 GitHub 部署状态明确显示 `main` 已自动发布到 GitHub Pages，生产地址为 `https://lynnete07.github.io/epub-reader/`。GitHub Actions 的 Pages 部署状态是当前生产发布与回滚依据。

`DEPLOY.md` 的 `dist/` 部署说明与实际配置不一致，保留它只能作历史参考。维护或部署决策应以 GitHub Actions 部署状态、仓库根目录静态资源和 `package.json` 为准。

`npm run build` 会先执行 `npm test`，再输出静态资源构建提示；它不生成打包产物。`npm test` 是无浏览器的快速质量门，`npm run test:browser` 则固定验证 EPUB 2/3、隔离、恢复、重复导入和基础无障碍。

`.github/workflows/ci.yml` 会在 `main` 推送与 PR 上运行干净安装、静态回归、Playwright 浏览器回归和依赖审计。生产部署后按 [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) 完成一次人工走查。

## 隐私与分析边界

`sid` URL 参数已于 2026-10-19 移除：它每次加载随机生成、从未被读取或上报，不能作为用户或会话标识，用它统计会严重高估独立访客。

统计现状（2026-10-27）：

- 当前 GitHub Pages 版本没有加载第三方统计脚本，也不发送访问或阅读事件。
- `js/epub-reader.js` 仍保留兼容性函数 `trackEvent()`；`window.va` 不存在时它静默跳过，不产生网络请求。
- 绝不发送 EPUB 文件、书名、作者、正文、阅读位置、localStorage 键值或书籍 ID。
- 任何新增统计事件都必须更新本节，并在 `docs/MAINTENANCE_LOG.md` 记录数据采集范围的变化。

## 修改后的验收标准

### 任何代码改动

1. 先按 [`TESTING.md`](TESTING.md) 的静态、功能、安全与 PWA 检查执行。
2. `npm run build` 仅作为脚本健全性检查，不能替代测试。
3. 若改动了静态资源或应用逻辑，验证 Service Worker 更新路径并递增缓存版本。

### 改动发布或分析

1. 审查工作区已有改动，避免混入无关内容。
2. 在分支环境或本地验证，并确认 `main` 的 Pages 部署成功。
3. 上线后用无痕窗口验证首访加载；Network 中不应出现携带书籍内容的出站请求。
4. 回归隐私边界：网络请求中不应含书籍内容或可识别阅读数据。

## 待维护问题

已解决（2026-10-19）：`service-worker.js` 的 `/favicon.ico` 预缓存项已移除并改为逐项容错缓存；`css/styles.css`、`server.js` 的改动已审阅并纳入提交；Git 提交作者已由占位符改为 `lynnete07` + GitHub noreply；Web Analytics 代码已接入。

仍然开放：

1. CDN 依赖（JSZip 3.10.1、Font Awesome 6.4.0）长期未核对版本可用性。
2. 若未来需要访问统计，必须作为独立的隐私与产品决策，不得默认恢复 Vercel Analytics。

维护流程见 [`docs/MAINTENANCE_SOP.md`](MAINTENANCE_SOP.md)，历次维护记录见 [`docs/MAINTENANCE_LOG.md`](MAINTENANCE_LOG.md)。
