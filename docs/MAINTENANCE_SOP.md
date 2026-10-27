# LightReader 维护 SOP

面向"一个人 + AI 辅助"维护一个线上静态站点的可执行流程。配套文档：`AGENTS.md`（给 AI 的约束）、`docs/PROJECT_CONTEXT.md`（代码地图）、`docs/MAINTENANCE_LOG.md`（每次维护的记录）。

## 0. 先记住这三条

1. **它是静态托管，不是服务。** EPUB 永远在用户浏览器里解析，Vercel 只分发 HTML/CSS/JS。任何"加个后端记点什么"的想法，都会把零运维的成本变成真运维。
2. **`main` 就是生产。** 推到 `main` 后一分钟内自动上线，中间没有人工确认环节。所以每次推 `main` 都当作发布动作来做。
3. **隐私是产品的核心卖点，不是附加项。** 新增任何数据采集前，先过第 5 节的隐私闸门。

## 1. 每次改动：必做流程

### 1.1 开工前

```bash
cd ~/epub_reader
git status --short        # 必须干净；有遗留改动先处理或问清楚再动
git switch -c feat/xxx    # 永远不要在 main 上直接改
```

### 1.2 改完后本地验证

命令（四行，十秒）：

```bash
npm run build
npm test
npm run test:browser
npm start                 # 打开 http://localhost:3300
```

手工清单（浏览器里跑，别省）：

- [ ] 拖入 EPUB，正文渲染正常
- [ ] EPUB 2（NCX）与 EPUB 3（nav）目录都能解析出来
- [ ] 翻章 / 滚动切章
- [ ] 主题切换、字号加减
- [ ] 刷新后进度恢复
- [ ] 窄窗口（移动宽度）下目录抽屉
- [ ] **断网后仍能打开页面**（PWA 离线）——这一项最容易悄悄坏掉且没人发现

### 1.3 凡是动过静态资源或阅读逻辑，必须递增缓存版本

`service-worker.js` 里的 `CACHE_NAME = 'lightreader-cache-vN'` → `vN+1`。

忘了这一步，老用户会一直跑旧代码，症状是"我改了但用户说没变"或"功能莫名缺失"。

### 1.4 提交与发布

1. commit message 写清**改了什么 + 为什么**（不是"更新代码"）。
2. `git push -u origin feat/xxx` → 开 PR → Vercel 自动给出 Preview URL。
3. 在 Preview URL 上至少跑一遍 1.2 的核心阅读流程。
4. 合并到 `main` → 自动上线。
5. 上线后用**无痕窗口**打开生产域名，F12 Console 确认无报错。

## 2. 月度巡检（约 15 分钟，建议每月第一个周一）

1. Vercel 后台 → 项目 → **Analytics**：访客、浏览量、来源、国家、设备。
2. Vercel 后台 → **Deployments**：最近部署是否全绿，有无失败记录。
3. GitHub 仓库 → **Security / Dependabot alerts**。
4. 无痕窗口打开生产站点，跑一遍核心阅读流程（CDN 依赖可能悄悄失效）。
5. 在 `docs/MAINTENANCE_LOG.md` 追加一行记录。

## 3. 季度巡检（约 1 小时）

1. **CDN 依赖**：`index.html` 里的 JSZip 3.10.1 与 Font Awesome 6.4.0。确认版本仍可用，考虑是否需要升级；升级后必须走一遍第 1 节全流程并递增 SW 缓存版本。
2. **隐私回归**：DevTools → Network，打开一本书，检查所有出站请求，确认没有请求体携带书名、正文、文件内容或 localStorage 键值。
3. **回滚演练**：Vercel → Deployments → 任选一个历史部署 → 熟悉"Promote to Production"在哪。别等线上出事再找按钮。

## 4. 线上故障应急

1. **先止血**：Vercel → Deployments → 找到最近一个已知良好的部署 → Promote to Production。（或在 `main` 上 `git revert` 后 push。）
2. **再定位**：静态站没有服务端日志，主要看浏览器 Console 与 Vercel 的部署日志。
3. **后修复**：本地复现 → 走第 1 节流程重新上线。

原则：**先回滚，后调查。** 不要在坏版本上原地改。

## 5. 可见性：怎么知道有没有人用

### 5.1 已接入的统计

`index.html` 已加入 Vercel Web Analytics：

```html
<script defer src="/_vercel/insights/script.js"></script>
```

**你必须先做一次这件事**：Vercel 后台 → 项目 → Analytics → 启用。不开这个开关，脚本什么也不会发送。

启用后能看到：访客数、浏览量、来源、国家、设备、浏览器。这回答"有没有人来"。

代码里还埋了两个匿名事件：`epub_opened`（成功打开一本书）、`chapter_viewed`（成功渲染一章）。它们不带任何书籍或用户数据。

> **已知限制**：Vercel 官方规定自定义事件仅在 Pro / Enterprise 计划的后台 Events 面板可见。免费 Hobby 计划看不到这两个事件，但代码无害——升级后自动生效，不升级也不影响功能。
>
> **当前决定（2026-10-19）**：保留代码，暂不升级套餐。`window.va` 不存在时 `trackEvent()` 静默跳过，不发送数据、不影响阅读。将来想看第二层数据再升级，代码无需改动。

### 5.2 三层判断法：别只看 PV

| 层次 | 指标 | 怎么看 |
| --- | --- | --- |
| 来了没 | Visitors / Pageviews | Analytics 首页，最低标准 |
| 用了没 | `epub_opened` | **打开首页 ≠ 用上了**；必须有人真的打开书 |
| 读下去没 | `chapter_viewed` ÷ `epub_opened` | 比值越高，说明读得越深 |

只看 PV 会自欺欺人：别人点开首页发现要自己传文件就走了，PV 有了，产品没被用过。

注意 `chapter_viewed` 每次渲染一章都会触发（含刷新恢复），它是**活跃度**指标，不是"读了多少章"的精确计数。

### 5.3 不要做的事

- **不要用 `sid` 统计用户。** 它每次页面加载随机生成、从未上报、也不持久化。拿它统计会严重高估独立访客数。该参数已于 2026-10-19 从代码中移除。
- **不要用 GA4 这类 cookie 统计。** 它会破坏"隐私优先"这个卖点，还得挂 cookie 同意横幅。
- **不要为了统计引入后端。** 见第 0 节第 1 条。

### 5.4 其他信号渠道

- **GitHub 仓库 → Insights → Traffic**：看有多少人来看源码（和站点访客通常是两拨人）。
- **Google Search Console**：想知道别人怎么搜到你，就把 `sitemap.xml` 提交进去。

## 6. 让 AI 改代码时的约定

- AI 动手前必须先读 `AGENTS.md` 和本文档；AI 提交前先跑第 1.2 节验证。
- 不授权时，AI 不得 push 到 `main`、不得执行 `vercel --prod`、不得 `git push --force`。
- 涉及数据采集范围的变更（新增/修改统计事件），必须在 commit message 和 `MAINTENANCE_LOG.md` 中明确说明。
