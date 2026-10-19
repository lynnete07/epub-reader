# 维护记录

按 `docs/MAINTENANCE_SOP.md` 执行，每次维护追加一条，只写事实与结论。

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

**未能验证**
- 本次维护所在环境的网络无法直连 Vercel 与外网，线上部署结果需人工在浏览器确认。
