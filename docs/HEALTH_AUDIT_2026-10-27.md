# LightReader 健康审计（2026-10-27）

## 结论

LightReader 的核心阅读链路可用，本轮整改已按边界闭环：浏览器自动化验证了 EPUB 2/3 导入、NCX/nav 目录、跨章链接、中文书名的刷新恢复、恶意 EPUB 隔离与并发重复导入。PWA 图标、开发服务器资源 404、基础无障碍、ZIP 资源限制和 GitHub Actions CI 均已落地。模块化与更多兼容性扩展明确不纳入本阶段。

| 维度 | 评分 | 判断 |
| --- | --- | --- |
| 核心功能 | 8 / 10 | 浏览器回归通过 EPUB 2 NCX、EPUB 3 nav、跨章链接和中文书名刷新恢复。 |
| 隐私设计 | 7 / 10 | 正常流程不上传书籍内容；章节隔离阻断了 EPUB 读取本地阅读数据的路径。 |
| 安全性 | 8 / 10 | 无脚本沙箱、净化、CSP、恶意 EPUB 浏览器回归和 ZIP 资源预检查均已到位。 |
| 可维护性 | 6 / 10 | 导入/定时器已收束，静态与浏览器回归均已覆盖；单一大型脚本仍待拆分。 |
| 可用性与无障碍 | 7 / 10 | 图标按钮有名称和状态，键盘焦点可见；仍应做更完整的屏幕阅读器与对比度验收。 |
| 工程质量控制 | 8 / 10 | lockfile、资产检查、静态门、5 项浏览器 fixture 与 GitHub Actions CI 已落地。 |

## 已验证的可用功能

- 静态语法检查通过：`js/epub-reader.js`、`server.js`、`service-worker.js`。
- `npm test` 通过：语法、隔离边界、导入单例、可访问性、PWA 图标、本地资源 404 和 lockfile 均被检查。
- `npm run test:browser` 通过 5/5：EPUB 2/3、跨章链接与恢复、恶意样本、并发重复导入、键盘焦点与 ARIA 状态。
- 本地服务器对 `/_vercel/insights/script.js` 返回真实 404，不再把 HTML 当 JavaScript 返回。
- `npm run build` 通过静态质量门；它不产生打包产物。

## 已修复：不可信 EPUB 的同源代码执行

**证据。** [`displayChapter()`](../js/epub-reader.js) 将书籍正文 `htmlDoc.body.innerHTML` 与书籍 CSS 拼接后写入 `viewer.innerHTML`。代码没有删除事件属性、`iframe` / `object` / `embed`、外链资源或危险 CSS。审计样本中的 `<img onerror="document.title='epub-script-ran'">` 成功把应用页面标题改为 `epub-script-ran`。

**影响。** 恶意 EPUB 可在 `lightreader` 同源读取设置、阅读进度和 IndexedDB 中保存的书籍二进制，并将其发往第三方。它也可以篡改阅读器界面、诱导点击或破坏阅读状态。浏览器内解析不等于安全沙箱。

**实施。** 章节改为在不含 `allow-scripts` 的 sandbox iframe 中渲染；在进入 iframe 前，代码移除脚本、事件属性、嵌入标签、危险 URL、外链 CSS 和可执行 CSS 片段，并为 iframe 注入严格 CSP。为保留尺寸同步、键盘操作和书内链接，iframe 使用 `allow-same-origin`，但书籍内容没有任何可执行脚本权限。目录和错误信息改用 DOM API 写入，避免 EPUB 派生文本重新成为应用 DOM 的 HTML sink。

**验证。** 浏览器回归使用提交到仓库的恶意 EPUB：含 `<script>`、`onload` / `onerror`、恶意 iframe、`javascript:` 链接、外链 CSS 与外链样式 URL。应用标题没有被篡改，危险节点与 URL 没有进入章节可访问树，也没有发往 `example.invalid` 的请求。

## 高优先级整改

1. **执行上线人工走查。** CI 绿灯和 Vercel Ready 后，按 [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) 在无痕窗口完成固定 10 分钟检查。
2. **后续不纳入本阶段。** PWA 离线更新自动化、Worker 化的可抢占解析、主脚本拆分和复杂 EPUB 兼容性属于下一轮产品演进。

## 后续优化建议

- 把 2,205 行 [`js/epub-reader.js`](../js/epub-reader.js) 拆成存储、EPUB 解析、渲染隔离、导航和 UI 控制模块；先用行为测试锁住现状，再拆分。
- 用稳定的书籍内容哈希替代“文件名 + 大小 + 修改时间 + 标题”生成的 ID，降低同名书覆盖和元数据变化导致无法恢复的概率。
- 对 ZIP 条目数、解压后总大小、单文件大小和解析时间设置上限，降低 ZIP bomb 与大书卡死的风险。
- 将 CDN 依赖改为受版本和完整性约束的本地静态资产，或至少加入 SRI、可用性检查与离线回归。
- 把外部的“浏览器插件自由扩展”产品承诺写成明确的扩展机制或暂时移除；目前仓库没有对应 API、权限模型或开发文档。

## 本轮限制

- EPUB fixture 是最小结构样本；尚未替代带复杂排版、图片、字体和 DRM 的真实书籍兼容性测试。
- GitHub Pages 曾因仓库设置自动发布，但不是主生产环境；生产部署和 Analytics 开关以 Vercel 管理台为准。生产 Service Worker 状态仍需按上线清单人工确认。
- 审计没有上传或读取任何私人电子书；所有功能和安全验证都使用本地生成的最小样本。
