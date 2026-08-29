# Obsession Radar

你的电气科研与技术雷达。页面会抓取 Hacker News、GitHub、arXiv 和 Semantic Scholar，生成默认 AI 雷达、自定义主题今日雷达、科研论文推荐和 Markdown 日报。它还包含本地“我的论文库”、精读队列、笔记和 BibTeX 导出。

## 手动运行

```powershell
node .\run-demo.mjs
```

输出文件：

- `daily-radar.json`
- `daily-radar.md`
- `demo-data.js`

打开 `index.html` 查看结果，也可以在页面点击“刷新今日雷达”从浏览器重新抓取。

## 今日雷达主题

页面里的“今日雷达主题”支持任意主题，例如 `robotics`、`quantum computing`、`bioinformatics`。填写主题后点击“刷新今日雷达”，主推荐和候选池会切换到该主题；留空则恢复默认 AI 雷达。

- 可选来源：Hacker News、GitHub、arXiv、Semantic Scholar。
- “保存主题”会写入当前浏览器 `localStorage`，最多保留 5 个。
- 保存主题只是快捷入口，真正刷新由“刷新今日雷达”触发。
- 每个主题提供 Google Scholar 外链，方便人工核对。

## API 设置

右上角“API 设置”可选配置 OpenAI-compatible 中转站，用于增强中文内容介绍、推荐理由和论文精读提示：

- `base_url`
- `api_key`
- `model`
- `responses` 或 `chat_completions`

这些配置只保存在当前浏览器 `localStorage`，不会写入 `daily-radar.json`、`daily-radar.md`、`demo-data.js`，也不会提交或部署。未配置或调用失败时，页面会自动回退到规则摘要。

## Cloudflare Pages 部署

本项目可以用 Cloudflare Pages 托管静态页面，并用 Pages Functions 代理 Semantic Scholar 与 arXiv，减少浏览器端 CORS 和上游限流缓存问题。请部署 `.cloudflare-pages` 干净目录，不要把项目根目录整体上传。部署前先同步发布目录，避免本地日报已更新但线上仍显示旧数据。

同步发布目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-cloudflare-pages.ps1
```

本地预览：

```powershell
npx.cmd wrangler pages dev .\.cloudflare-pages --port 8788 --ip 127.0.0.1
```

部署到默认项目名：

```powershell
npx.cmd wrangler pages deploy .\.cloudflare-pages --project-name=obsession-radar
```

如果 `obsession-radar` 被占用：

```powershell
npx.cmd wrangler pages deploy .\.cloudflare-pages --project-name=obsession-lab-radar
```

验证代理：

```powershell
Invoke-RestMethod "http://localhost:8788/api/semantic-scholar?query=robotics&limit=1"
Invoke-WebRequest "http://localhost:8788/api/arxiv?query=all:%22robotics%22&limit=1"
```

可选环境变量：

- `SEMANTIC_SCHOLAR_API_KEY`

不要把 OpenAI、中转站或 Semantic Scholar API Key 写入前端文件。用户自己的 AI API Key 只通过页面设置保存在浏览器本地。

## Cloudflare 与 Vercel 取舍

Cloudflare Pages 的优点：

- 免费 `*.pages.dev` 域名适合做 `obsession-radar.pages.dev`。
- 静态资源走 Cloudflare 全球网络，轻量仪表盘加载快。
- Pages Functions 可以替代当前 Vercel 的 Semantic Scholar 代理。
- Workers Free 每日请求额度适合当前轻量 API 代理。

需要注意：

- Vercel API Route 不能原样搬到 Cloudflare，需要使用 `functions/api/semantic-scholar.js`。
- 带 `functions` 目录时建议用 Wrangler 部署。
- Cloudflare Direct Upload 之后不能直接切到 Git integration；如果以后要 Git 自动部署，建议新建项目。
- Cloudflare 不会自动运行本地 `run-demo.mjs`，每日自动更新仍保留 Windows 计划任务；以后可另做 Worker Cron + KV/R2。

当前 Vercel 站点可以保留作备用，Cloudflare 验证稳定后再作为主站。

## 学术来源说明

- 自动抓取使用 arXiv API 和 Semantic Scholar Graph API。
- Google Scholar 不做自动抓取，只提供一键搜索外链，避免验证码、反爬和部署失败。
- Vercel 部署时浏览器会调用同源 `/api/semantic-scholar` 和 `/api/arxiv` 代理。
- Cloudflare Pages 部署时 `/api/semantic-scholar` 和 `/api/arxiv` 由 Pages Functions 处理。
- Semantic Scholar 只缓存 `200` 成功响应；`429/5xx` 不缓存，避免把限流错误留太久。

## 每日自动更新

安装 Windows 每日计划任务，默认每天 `08:30` 运行并打开本地页面：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-daily-task.ps1
```

指定运行时间：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-daily-task.ps1 -At 09:00
```

只更新数据，不自动打开页面：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-daily-task.ps1 -NoOpen
```

卸载计划任务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-daily-task.ps1
```

查看任务：

```powershell
Get-ScheduledTask -TaskName "AI Radar Lite Daily Update"
```

## 本地运行脚本

不安装计划任务，只运行一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-daily-radar.ps1 -NoOpen
```

脚本会：

- 调用 `node .\run-demo.mjs`
- 写入 `logs\YYYY-MM-DD.log`
- 写入 `last-run.json` 和 `last-run-data.js`
- 验证主榜 `30/5` 和论文榜 `15/5`
- 成功后同步 `.cloudflare-pages`，方便直接部署最新日报
- 失败时恢复旧的 `daily-radar.json`、`daily-radar.md`、`demo-data.js`

## 网络失败排查

自动任务需要访问：

- Hacker News Algolia API
- GitHub Search API
- arXiv API
- Semantic Scholar Graph API

如果任务失败，先查看：

```powershell
Get-Content .\last-run.json
Get-Content .\logs\$(Get-Date -Format yyyy-MM-dd).log
```

常见原因：

- 当前网络无法访问 GitHub、HN、arXiv 或 Semantic Scholar。
- GitHub 公共 API 限流。
- arXiv 或 Semantic Scholar 公共 API 限流。
- `node` 不在计划任务运行环境的 `PATH` 中。

## 验证

```powershell
node --test .\paper-library.test.mjs .\topic-radar.test.mjs .\arxiv-atom.test.mjs .\radar-core.test.mjs .\page-metadata.test.mjs .\api-config.test.mjs .\functions-api.test.mjs
node --check .\functions\_middleware.js .\functions\api\semantic-scholar.js .\functions\api\arxiv.js .\api\semantic-scholar.js .\api\arxiv.js .\run-demo.mjs .\radar-core.mjs .\radar-core.browser.js .\radar-fetchers.browser.js .\app.js .\ai-api-config.mjs .\ai-api-config.browser.js
rg -n "<mojibake-pattern>" . --glob "!logs/**"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-daily-radar.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-cloudflare-pages.ps1 -WhatIf
```
