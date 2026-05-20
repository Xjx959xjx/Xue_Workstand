# AGENTS.md

## 适用范围

本文件是仓库根目录的全局 Agent 指南，适用于整个项目。若子目录出现更近的 `AGENTS.md`，以更近的文件为准。

本项目是本地运行的账号风格内容工作台，用来采集 B 站 / 抖音爆款内容、维护转写稿、沉淀账号和项目风格卡，并在写作台生成文案。它不是数据库型系统，核心资产都在本地文件系统，尤其是 `style-library`，处理删除、迁移和批量重写时必须保守。

## 快速接手

优先建立上下文：

1. `README.md`
2. `AGENTS.md`
3. `src/lib/types.ts`
4. `src/lib/storage.ts`
5. 相关 `src/lib/*`
6. 相关 `src/app/api/**/route.ts`
7. 对应页面或组件

接手先跑：

```bash
git status --short
rg --files
```

工作树可能已有用户或其他 Agent 的改动。不要回滚无关改动；只编辑当前任务相关文件。

## 技术栈与命令

核心技术：

- Next.js 15 App Router、React 19、TypeScript `strict`
- ESLint 9、`zod`、`undici`、`lucide-react`
- `opencli` 用于采集、搜索、字幕、下载和飞书发布
- `ffmpeg` 与火山引擎录音文件识别 2.0 用于无字幕视频转写

常用命令：

```bash
npm install
cp .env.example .env
npm run dev
npm run dev:daemon
npm run dev:status
npm run dev:restart
npm run dev:stop
npm run lint
npm run typecheck
npm run check:library
npm run build
```

本地地址是 `http://localhost:3000`。后台开发服务器日志在 `.dev-server/next-dev.log`。

不要在开发服务器运行时同时执行 `npm run build`，Next.js 会复用 `.next`，可能导致开发页 CSS/JS 短暂 404。若页面样式或脚本异常，优先清理 `.next` 后重启：

```bash
rm -rf .next
npm run dev
```

## 环境变量

关键变量来自 `.env` / `.env.example`：

- `OPENCLI_BIN`、`FFMPEG_BIN`、`STYLE_LIBRARY_DIR`
- `VOLCENGINE_ASR_API_KEY`、`VOLCENGINE_ASR_RESOURCE_ID`、`VOLCENGINE_ASR_SUBMIT_URL`、`VOLCENGINE_ASR_QUERY_URL`、`VOLCENGINE_ASR_AUDIO_FORMAT`、`VOLCENGINE_ASR_POLL_INTERVAL_MS`
- `DOUYIN_TRANSCRIBE_CONCURRENCY`，默认 `3`，建议保持 `1-4`
- `CHAT_API_KEY`、`CHAT_BASE_URL`、`CHAT_RESPONSES_URL`、`CHAT_COMPLETIONS_URL`、`CHAT_MODEL`、`CHAT_WIRE_API`、`CHAT_REASONING_EFFORT`、`CHAT_PROXY_URL`；`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 可作为对话模型兜底配置
- `FEISHU_OPENCLI_AS`、`FEISHU_FOLDER_TOKEN`

模型未配置时允许回退到本地模板生成可编辑结果，这是设计的一部分，不要当成全站阻塞错误。涉及最新事实的生成内容，优先检查写作链路是否启用联网研究。

## 项目结构

主要目录：

- `src/app`：页面与 App Router API
- `src/components`：导航、Provider、空态、状态和格式化组件
- `src/lib`：类型、存储、采集、转写、模型、飞书、流式输出和工具函数
- `scripts`：开发服务器管理与素材库一致性检查
- `style-library`：默认本地素材库，属于用户长期资产

页面入口：

- `src/app/page.tsx`：工作台首页与快速采集入口
- `src/app/library/page.tsx`：账号风格库
- `src/app/projects/page.tsx`：项目库
- `src/app/writer/page.tsx`：写作台

API 入口：

- `accounts`、`collect`、`videos`、`videos/hydrate`
- `transcribe`、`batch-transcribe`、`batch-transcribe/stream`
- `transcripts`、`style`、`style/stream`
- `projects`、`projects/stream`
- `drafts`、`write`、`write/stream`
- `library`、`health`、`feishu/document`

## 核心数据与存储

类型定义在 `src/lib/types.ts`。核心实体是 `Account`、`Video`、`Draft`、`Project`、`AccountSummary`、`ProjectSummary` 和 `LibraryState`。平台枚举目前只有 `bilibili` 与 `douyin`。新增平台时，要同步更新 `types.ts`、`opencli.ts`、`storage.ts`、`client.ts`、相关 API 和页面。

默认存储根目录是 `STYLE_LIBRARY_DIR`，未配置时为 `./style-library`：

```text
style-library/
  bilibili/<account-slug>/
    account.json
    style.md
    videos/<video-id>.json
    transcripts/<video-id>.txt
    drafts/<draft-id>.json
  douyin/<account-slug>/
    account.json
    style.md
    videos/
    transcripts/
    drafts/
  projects/<project-slug>/
    project.json
    style.md
    drafts/
```

存储规则：

- 修改 `src/lib/storage.ts` 前先读现有函数，优先复用。
- JSON 写入使用临时文件加 `rename` 原子落盘，新增 JSON 写逻辑保持一致。
- `style.md` 和转写稿是用户可编辑资产，保存时不要无意义重排或重写格式。
- 删除账号要同步更新项目 `sourceAccountIds`。
- 删除视频要同步删除对应转写稿，并清理草稿 `styleRef.videoIds` 引用。
- 存储或引用联动改动后优先跑 `npm run check:library`。

## 业务链路

前端请求统一走 `src/lib/client.ts`。页面应尽量复用这里的封装，不要散落重复 `fetch("/api/...")`。流式接口使用 NDJSON 风格事件，相关工具在 `src/lib/streaming.ts`。

API 位于 `src/app/api/**/route.ts`，负责入参校验、流程编排和错误返回。入参校验优先用 `zod`；访问本地文件、环境变量、`opencli`、`ffmpeg` 或模型服务的接口使用 Node.js runtime；错误信息保持中文、用户可读，不要直接泄漏底层堆栈。

采集链路在 `src/lib/opencli.ts`。B 站支持账号搜索、用户视频采集、分页、时间窗过滤、详情补全和字幕 / 下载；不要轻易简化候选分页与时间窗筛选。抖音账号解析依赖 `opencli browser` 搜索与 `aweme-post`，失败时提示用户提供主页链接或 `sec_uid`。

转写链路在 `src/lib/transcription.ts` 和 `src/lib/batch-transcribe.ts`。B 站优先公开字幕，无字幕时下载后抽音频；抖音优先复用或预取媒体地址，再用 `ffmpeg` 抽取音频，通过火山 `audio.data` 提交识别，避免火山服务端直接拉取带防盗链的抖音 URL。转写失败必须落盘为失败状态，避免页面一直显示进行中。

模型链路在 `src/lib/ai.ts`。兼容 `responses`、`chat_completions` 和 `auto`，支持代理、联网研究、流式输出和本地 fallback。更换中转站时优先通过环境变量切换，不要把模型不可用、部分采集失败或部分转写失败简单升级成全站失败。

飞书发布在 `src/lib/feishu.ts` 和 `src/app/api/feishu/document/route.ts`，通过 `opencli lark-cli docs +create` 发布。

## 前端约定

全局样式在 `src/app/globals.css`。当前 UI 是浅色本地工作台 / 控制台风格，强调信息密度、可编辑性和操作效率。新增页面或区块要延续现有变量、按钮、面板、表单、状态和空态样式，并兼顾桌面端与移动端。

首页与库页依赖 `useLibrary()` 的全局刷新机制。改动 `/api/library`、`LibraryState` 或核心写入接口后，要检查相关页面联动。部分 B 站视频统计会通过 `/api/videos/hydrate` 二次补全，不要误删这条链路。

## 修改原则

- 先明确 `src/lib/types.ts` 的数据边界，再改 API 和 UI。
- 保持分层：页面负责交互展示，`client.ts` 负责请求，API 负责编排，复杂业务下沉到 `src/lib`。
- 新增对前端可见的 API 时，除非只服务服务端内部逻辑，否则同步补 `src/lib/client.ts`。
- 涉及删除、迁移、批量操作时，优先做可恢复或最小范围改动。
- 涉及 `opencli`、模型、飞书或本地文件时保留清晰中文错误和 fallback。
- 不要无理由引入大型 UI 框架或改变整体视觉语言。

## 中等以上任务流程

遇到跨层改动、存储结构调整、模型 / 采集 / 转写链路改造，按轻量流程执行：

1. Spec：写清目标、输入输出、用户可见行为、边界条件、明确不做的事，以及是否影响既有 `style-library`。
2. Plan：拆成可独立验证的小步，优先安排能尽早暴露风险的垂直切片。
3. Build：按既有分层实现，优先复用 `src/lib/*` 与 `src/lib/client.ts`。
4. Test：重点验证存储、API、引用联动、fallback 和中文错误。
5. Review：自查兼容性、用户资产风险、UI 风格和文档同步。

## 提交前检查

中等及以上代码改动至少执行：

```bash
npm run lint
npm run typecheck
```

存储或引用联动改动补：

```bash
npm run check:library
```

影响 Next.js 构建、路由、SSR 或服务端行为时再补 `npm run build`，前提是没有正在运行的开发服务器。纯文档改动通常不需要跑完整检查，但要确认内容与项目现状一致。

## 何时更新本文件

出现以下变化时同步更新 `AGENTS.md`：

- 新增核心页面、API、平台或脚本
- 本地存储目录结构变化
- 模型、采集、转写、飞书发布链路的关键约束变化
- 项目运行方式或环境变量变化
- 全局 UI 风格、数据流或素材库一致性规则变化
