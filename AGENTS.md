# AGENTS.md

## 范围

本文件是仓库根目录的全局 Agent 指南；子目录若有更近的 `AGENTS.md`，以更近者为准。

项目是本地账号风格内容工作台：采集 B 站 / 抖音内容，维护转写稿、账号 / 项目风格、写作草稿、评论 / 弹幕、封面资产和毛利数据维护监控。核心资产在本地文件系统，尤其是 `style-library`；删除、迁移、批量重写和打包带数据必须保守。

## 接手

先跑：

```bash
git status --short
rg --files
```

优先读 `README.md`、`src/lib/types.ts`、`src/lib/storage.ts`、`src/lib/client.ts`，再读当前任务相关的 `src/lib/*`、`src/app/api/**/route.ts`、页面 / 组件 / hook / CSS。

工作树可能已有用户或其他 Agent 改动。不要回滚无关改动；只编辑当前任务相关文件。

## 技术与命令

- Next.js 15 App Router、React 19、TypeScript strict、ESLint 9、`zod`、`undici`、`lucide-react`、`docx`
- `opencli`：采集 / 搜索 / 字幕 / 下载 / 飞书 / 部分毛利数据刷新
- `ffmpeg` + 火山 ASR：无字幕视频转写
- Next.js standalone：本地交付包和 Windows 专用包

常用脚本见 `package.json`。高频命令：

```bash
npm run dev
npm run dev:daemon
npm run lint
npm run typecheck
npm run check:library
npm run build
npm run package:release
```

本地地址 `http://localhost:3000`，后台日志 `.dev-server/next-dev.log`。开发服务器运行时不要同时 `npm run build`；若样式 / 脚本异常，先清 `.next` 再重启 dev server。

环境变量以 `.env.example` 为准。模型未配置允许本地模板 fallback；图片模型未配置只影响封面；毛利维护 / 监控不依赖大模型。

打包交付看 `README.md`。默认不要把完整 `style-library` 打进包；用户明确要求才用 `--include-library`。毛利 Windows 包只携带 `style-library/gross-margin`。

## 入口

- 页面：`/library`、`/project-workbench`、`/writer`、`/assets`、`/gross-margin`、`/gross-margin/monitor`
- 首页按 `APP_MODE` 重定向到 `/library` 或 `/gross-margin`
- `APP_MODE=gross-margin` 时 middleware + `AppModeGuard` 只开放毛利页面
- API 以 `src/app/api/**/route.ts` 为准；新增前端可见 API 时同步 `src/lib/client.ts`
- 样式由 `src/app/globals.css` 引入 `src/app/styles/**`

## 存储

默认根目录是 `STYLE_LIBRARY_DIR` 或 `./style-library`。主要目录：

```text
style-library/
  bilibili/<account-slug>/
  douyin/<account-slug>/
  projects/<project-slug>/
  copy-tools/sources/
  engagement/
  jobs/
  gross-margin/
```

规则：

- 改 `src/lib/storage.ts` 前先读现有函数，优先复用。
- JSON 写入保持临时文件 + `rename` 原子落盘。
- `style.md`、转写稿、`<draft-id>.assets` 是用户资产，不要无意义重排或重写。
- 删除账号同步项目 `sourceAccountIds`；删除视频同步删转写稿并清理草稿 `styleRef.videoIds`。
- `copy-tools/sources` 的 `.json` / `.txt` 成对维护，并同步项目 `sourceMaterialIds` 与草稿引用。
- `engagement` 是评论 / 弹幕历史和 `.docx` 导出来源；生成失败或 fallback 不等于存储错误。
- `jobs` 是后台任务记录，重启会把运行中任务标为 `interrupted`。
- `gross-margin` 是毛利交付核心数据；毛利包不要携带其他账号库、草稿和素材。

存储或引用联动改动后跑 `npm run check:library`。

## 分层与链路

- 页面负责交互展示；`src/lib/client.ts` 负责前端请求和流式读取。
- API 负责 `zod` 入参校验、流程编排和中文错误；涉及本地文件、环境变量、`opencli`、`ffmpeg`、模型服务时用 Node.js runtime。
- 复杂业务下沉到 `src/lib/*`；长耗时动作优先接入 `src/lib/jobs.ts` 和任务中心。
- 采集：`opencli.ts`；转写：`transcription.ts`、`batch-transcribe.ts`；模型 / 写作 / 风格：`ai.ts`
- 项目素材：`source-transcription.ts`、`source-extraction.ts`、`material-analysis.ts`
- 评论 / 弹幕：`engagement.ts`、`engagement-export.ts`；封面：`cover.ts`；飞书：`feishu.ts`
- 毛利：`src/app/gross-margin/**`、`src/app/api/gross-margin/route.ts`、`gross-margin-monitor-template.ts`、`storage.ts`

涉及 `opencli`、`ffmpeg`、火山、模型、图片模型、飞书或本地文件时，保留清晰中文错误和 fallback。

## 前端

UI 是浅色本地工作台 / 控制台风格，强调信息密度、可编辑性和操作效率。新增页面或区块沿用现有变量、按钮、面板、表单、状态、任务中心、弹窗和空态样式，兼顾桌面端与移动端。

库页、项目工作台、写作台和资产页依赖 `useLibrary()`、`getLibraryOverview()` 和客户端缓存。改 `/api/library`、`/api/library/overview`、`LibraryState`、`LibraryOverview` 或核心写入接口后检查页面联动。B 站统计通过 `/api/videos/hydrate` 二次补全，不要误删。

## 流程与检查

跨层、存储结构、模型 / 图片模型 / 采集 / 转写 / 任务 / 毛利链路改造时，先写清目标、输入输出、用户可见行为、边界和是否影响既有 `style-library`，再按小步实现与验证。

中等及以上代码改动至少跑：

```bash
npm run lint
npm run typecheck
```

存储或引用联动补 `npm run check:library`。影响构建、路由、SSR 或服务端行为时再补 `npm run build`，前提是没有正在运行的 dev server。纯文档改动通常不需要完整检查。

## Token 控制

- `AGENTS.md` 只放稳定高优先级规则；细节放 `README.md`、`.env.example` 或源码。
- 用 `rg` 定位后只读相关片段，避免整文件、整目录展开。
- 路由、环境变量、目录结构只保留分组，少列易变明细。
- 回答用户只给结论、改动点和验证结果；长日志只摘要关键行。
- 大任务先读最短关键链路，需要时再渐进读取相关文件。

## 何时更新

核心页面 / API / 平台 / 脚本、存储结构、运行方式、关键环境变量、全局 UI 规则或素材库一致性规则变化时，同步更新本文件。
