# LightReader 测试与发布验收

## 结论

项目提供两层回归：`npm test` 快速检查语法、隔离边界、导入单例、无障碍、PWA 资产和本地服务器路由；`npm run test:browser` 用提交到仓库的 EPUB fixture 实际验证 EPUB 2 NCX、EPUB 3 nav、跨章链接、刷新恢复、恶意内容隔离、重复导入和基础键盘操作。

## 现有验证命令

```bash
npm ci
npm test
npm run test:browser
npm run audit
npm run build
npm start
```

`npm test` 不启动浏览器，可在本地和 CI 中快速执行。`npm run test:browser` 在本机复用已安装的 Chrome；CI 应在它之前执行 `npx playwright install chromium`。`npm run audit` 固定使用 npm 官方 registry。`npm run build` 会先运行静态检查，但不替代浏览器回归。

本地用 `npm start` 时，`/_vercel/insights/script.js` 会返回明确的 404，而不是 SPA HTML；因此不会再出现 `Unexpected token '<'`。Analytics 脚本本身的网络 404 在未运行 Vercel 环境时是预期行为。

## 每次改动的最小回归

1. 运行 `npm test && npm run test:browser`。
2. 在桌面和 390px 宽度各检查一次：目录打开/关闭、主题、字号、字体面板和重新选书。
3. 断网后刷新已访问页面：确认 Service Worker 能提供壳页面和已缓存资源。
4. 改动静态资源或阅读逻辑时：递增 `service-worker.js` 的 `CACHE_NAME`，再用无痕窗口检查更新路径。

## 发布阻断安全回归

在合并任何 EPUB 渲染改动前，必须用恶意测试 EPUB 证明以下条件全部成立：

- 章节中的 `<script>`、所有 `on*` 事件属性、`iframe`、`object`、`embed` 和危险 URL 均不能执行。
- 章节内容无法读取 LightReader 的 localStorage、IndexedDB 或调用同源 API。
- 书籍 CSS 不能加载外部网络资源，也不能覆盖应用壳的关键界面。
- 页面具备与净化策略匹配的 CSP；不得为方便渲染而放宽 `script-src`。

通过标准是：恶意 EPUB 既不能改变应用页面状态，也没有额外的网络请求或阅读器 Console 错误。iframe 因 CSP / sandbox 对书内恶意资源的拦截不应被视为阅读器错误。

## 下一阶段自动化目标

1. 建立 CI：至少运行 `npm ci`、静态回归、浏览器 fixture 回归、资产存在性检查、Service Worker 缓存清单检查和审计。
2. 扩展安全 fixture：畸形 XML、超大 ZIP、ZIP 条目数与解压后体积上限。
3. 补 PWA 离线更新、390px 移动抽屉和辅助技术的端到端回归。
