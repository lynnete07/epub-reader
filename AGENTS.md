# AGENTS.md — LightReader 项目上下文

## 项目目标

LightReader 是部署在 Vercel 的纯静态 EPUB 阅读器。它让用户在浏览器本地打开 EPUB、阅读章节，并保存主题、字号和阅读进度。

这个项目没有后端、数据库、登录系统或业务 API。不要为普通维护擅自引入服务端、用户账户或内容上传。

详细的代码地图、发布链路和已知风险见 [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md)。

## 开始工作前

1. 阅读本文件和 `docs/PROJECT_CONTEXT.md`。
2. 运行 `git status --short`，识别用户已有的未提交改动。
3. 不覆盖、丢弃或格式化无关的用户改动。
4. 涉及部署或分析时，先核对 `vercel.json`、`package.json` 和 `service-worker.js`。

## 核心约束

- **隐私优先**：EPUB 文件、书名、正文、阅读位置和 localStorage 内容不得上传、记录或作为统计事件属性。
- **本地优先**：阅读状态保存在浏览器 localStorage，书籍本体不跨设备共享。URL 中已无 `sid` 参数（2026-10-19 作为死代码移除），不要重新引入任何形式的会话或用户标识。
- **兼容性优先**：优先支持桌面和移动浏览器、EPUB 2 NCX 与 EPUB 3 nav 目录。
- **PWA 缓存是发布的一部分**：改动静态资源或阅读逻辑后，应评估是否需要递增 `service-worker.js` 的 `CACHE_NAME`。
- **不直接生产发布**：除非用户明确授权，不运行 `git push`、`vercel --prod` 或其他会改变线上状态的命令。

## 文件地图

| 文件 | 作用 |
| --- | --- |
| `index.html` | 单页入口、用户界面骨架、CDN 依赖 |
| `js/epub-reader.js` | EPUB 解析、阅读、目录、进度、本地存储与交互 |
| `css/styles.css` | 所有页面样式与响应式布局 |
| `service-worker.js` | PWA 预缓存与离线策略 |
| `manifest.json` | PWA 元数据与图标 |
| `server.js` | 仅本地开发用静态服务器 |
| `vercel.json` | Vercel 静态部署与 SPA 回退规则 |
| `README.md` | 面向使用者的基本介绍 |
| `DEPLOY.md` | 历史通用部署文档；其中 `dist/` 说明已过时，不能当作当前发布依据 |
| `docs/MAINTENANCE_SOP.md` | 维护流程：每次改动、月度与季度巡检、应急回滚、可见性方案 |
| `docs/MAINTENANCE_LOG.md` | 历次维护记录，追加写入 |
| `docs/TESTING.md` | 当前测试边界、回归矩阵与发布前验收 |
| `docs/RELEASE_CHECKLIST.md` | 生产上线后的 10 分钟人工走查 |
| `docs/HEALTH_AUDIT_2026-10-27.md` | 最近一次健康审计、证据与整改优先级 |
| `.github/workflows/ci.yml` | main 与 PR 的静态、浏览器和审计质量门 |

## 本地验证

最小检查：

```bash
npm run build
npm test
npm run test:browser
node --check js/epub-reader.js
node --check server.js
node --check service-worker.js
npm start
```

在本地浏览器至少验证：打开 EPUB、EPUB 2/3 目录、翻章或滚动切章、主题、字号、刷新后进度恢复、新窗口打开、移动端目录，以及断网后仍能打开页面。

## 发布模型

代码仓库远端为 `https://github.com/lynnete07/epub-reader.git`。项目已配置为 Vercel 静态站点：`npm run build` 后发布项目根目录，所有未匹配路径回退到 `index.html`。

日常假设是 GitHub `main` 为生产分支、Vercel 通过 Git 集成自动部署。进入 Vercel 项目 **Settings → Git** 和 **Deployments** 后才能确认或更改这个假设。

## 分步工作原则

1. 先诊断并写清影响范围。
2. 先在本地验证，再提交可审阅的改动。
3. 在分支的 Vercel Preview 验证通过后，才建议合并到 `main`。
4. 线上异常时，先从 Vercel Deployments 回滚到最近成功版本，再调查问题。

## 当前已知风险

- **EPUB 内容隔离是不可回退的安全边界。** `displayChapter()` 必须继续在不含 `allow-scripts` 的 sandbox iframe 中渲染章节，并保留 HTML / CSS / URL 净化和 iframe 内 CSP。不要把书籍正文重新写入应用 DOM，也不要为了兼容性放开脚本权限。每次改动阅读渲染都运行 `docs/TESTING.md` 的安全 fixture 回归。
- **Vercel 后台的 Analytics 开关可能尚未开启。** 代码已就绪，但开关不开则访问数据为零；涉及"有没有人用"的判断前，先提醒用户在管理台确认。
- 浏览器回归依赖本机 Chrome；CI 使用 Playwright Chromium 前先执行 `npx playwright install chromium`。
- EPUB 导入有压缩包、条目、解压体积、压缩比和解析时间上限。修改 `js/zip-safety.js` 时必须同步更新单元测试和用户提示，不能绕过预检查直接交给 JSZip。
- 自定义事件 `epub_opened`、`chapter_viewed` 仅在 Vercel Pro / Enterprise 后台可见；Hobby 计划下不要承诺能在面板里看到它们。
- CDN 依赖（JSZip 3.10.1、Font Awesome 6.4.0）长期未核对；改动 `index.html` 的依赖版本必须走完整验证流程。

完整流程见 [`docs/MAINTENANCE_SOP.md`](docs/MAINTENANCE_SOP.md)。
