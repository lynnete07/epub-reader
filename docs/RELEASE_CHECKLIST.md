# LightReader 上线人工走查

自动化通过后，在 Vercel 显示部署 Ready 且 CI 绿灯时执行。本清单只验证用户可感知的线上链路，不重复自动化已覆盖的内部细节。

## 准备

1. 打开 Vercel 本次生产部署 URL；使用无痕窗口或新的浏览器 Profile，避免旧 Service Worker 和旧 IndexedDB 干扰。
2. 预备仓库中的 [`tests/fixtures/epub3-regression.epub`](../tests/fixtures/epub3-regression.epub)。它不含私人内容，书名为中文，能同时验证导入、目录、跨章和刷新恢复。

## 约 10 分钟走查

1. **首访与安装**：页面正常显示图标与上传入口；浏览器 Console 没有 JavaScript 语法错误。若浏览器提供安装入口，确认安装图标正常。
2. **阅读主链路**：上传样本，确认第一章、目录两个条目和第二章链接正常；点击链接后刷新，仍停在第二章。
3. **基础交互**：切换主题、调整字号、打开字体面板；用 Tab 键确认上传入口和顶部按钮有清晰焦点。
4. **移动布局**：在 DevTools 设为 390px 宽度，确认目录可以打开、关闭，正文没有横向滚动。
5. **离线壳页面**：在线打开页面一次后切换离线并刷新，确认应用壳仍能显示。离线不要求首次访问或未缓存的 CDN 资源可用。
6. **隐私抽查**：DevTools 的 Network 中确认上传 EPUB 后没有把书籍文件、书名、正文或阅读位置发到第三方；Vercel Analytics 的匿名请求除外。

## 通过与回滚

全部通过即完成本次项目优化并记录部署 URL。若出现章节无法渲染、刷新恢复失败、页面白屏或书籍内容外发，立即在 Vercel **Deployments** 将上一条正常部署 Promote 为 Production，再保留 Console 与 Network 证据排查。
