# AGENTS.md

## 适用范围

本文件是仓库根目录的全局 Agent 指南，适用于整个项目。后续如果某个子目录出现更近的 `AGENTS.md`，以更近的文件为准。

本项目是一个本地运行的内容工作台，用来沉淀 B 站 / 抖音账号风格，并围绕这些素材完成采集、转写、风格总结、项目整合和写作生成。它不是数据库型系统，核心资产都落在本地文件系统里。

## 项目目标

- 采集 B 站 / 抖音账号爆款视频与基础数据
- 生成、保存或维护视频转写稿
- 基于转写稿总结账号风格卡
- 将多个账号整合为项目风格卡
- 在写作台按账号或项目风格生成文案
- 管理草稿，并可发布到飞书文档
- 将账号、视频、转写稿、风格卡、草稿和项目持久化到本地目录

## 技术栈

- Next.js 15 App Router
- React 19
- TypeScript `strict`
- ESLint 9
- `zod` 用于 API 入参校验
- `undici` 用于模型接口请求与代理
- `opencli` 用于采集、搜索、字幕、下载和飞书发布链路

## 启动与检查

首次启动：

```bash
npm install
cp .env.example .env
npm run dev
```

常用命令：

```bash
npm run dev
npm run dev:daemon
npm run dev:status
npm run dev:restart
npm run dev:stop
npm run lint
npm run typecheck
npm run build
```

本地地址：

- `http://localhost:3000`

注意事项：

- 如果希望本地网页不依赖当前终端会话，使用 `npm run dev:daemon` 后台启动；日志在 `.dev-server/next-dev.log`，状态用 `npm run dev:status` 查看。
- 开发服务器运行时不要同时执行 `npm run build`。本项目依赖 `.next`，并且 README 已说明两者并行可能导致 CSS/JS 静态资源短暂 404。
- 如果页面出现样式或脚本异常，优先清理 `.next` 后重新启动：

```bash
rm -rf .next
npm run dev
```

## 环境变量

关键环境变量来自 `.env` / `.env.example`：

- `OPENCLI_BIN`：采集、搜索、字幕、下载、飞书发布依赖的 `opencli` 可执行文件，默认 `opencli`
- `FFMPEG_BIN`：音频抽取依赖的 `ffmpeg` 可执行文件，默认 `ffmpeg`
- `STYLE_LIBRARY_DIR`：本地素材库目录，默认 `./style-library`
- `SILICONFLOW_API_KEY`：硅基流动音视频转写 Key
- `SILICONFLOW_BASE_URL`：硅基流动接口地址
- `SILICONFLOW_TRANSCRIBE_MODEL`：转写模型
- `DOUYIN_TRANSCRIBE_CONCURRENCY`：抖音批量转写并发数，默认 `2`，建议保持在 `1-3`
- `CHAT_API_KEY`：对话模型 Key
- `CHAT_BASE_URL`：对话模型接口地址，默认 `https://www.fhl.mom`
- `CHAT_MODEL`：对话模型，默认 `gpt-5.5`
- `CHAT_WIRE_API`：模型协议，支持 `responses` 和 `chat_completions`
- `CHAT_PROXY_URL`：服务端模型请求代理，例如 `http://127.0.0.1:7890`
- `FEISHU_OPENCLI_AS`：飞书发布使用的 lark-cli 身份
- `FEISHU_FOLDER_TOKEN`：飞书文档目标文件夹 token

工作原则：

- 模型未配置时，项目允许回退到本地模板生成可编辑结果，不要把“缺少模型 Key”当成全站阻塞错误。
- 如果生成内容涉及最新事实，优先检查写作链路是否启用了联网研究，而不是假设模型自带最新知识。
- 涉及 `opencli` 的功能要保留清晰、用户可读的中文错误信息。

## 仓库结构

根目录重点文件：

- `README.md`：项目使用说明与环境说明
- `AGENTS.md`：本文件，给后续 Agent / 协作者快速对齐上下文
- `package.json`：脚本与依赖
- `tsconfig.json`：TypeScript 配置，路径别名为 `@/* -> ./src/*`
- `.env.example`：环境变量模板

源码目录：

- `src/app`：页面与 App Router API
- `src/components`：跨页组件、导航、状态、Provider
- `src/lib`：业务核心逻辑、存储、采集、转写、模型调用、类型和工具函数

当前页面：

- `src/app/page.tsx`：工作台首页与快速采集入口
- `src/app/library/page.tsx`：账号风格库
- `src/app/projects/page.tsx`：项目库
- `src/app/writer/page.tsx`：写作台
- `src/app/drafts/page.tsx`：草稿管理

当前 API：

- `src/app/api/collect/route.ts`：采集账号视频
- `src/app/api/accounts/route.ts`：创建 / 删除账号
- `src/app/api/videos/route.ts`：删除视频及其转写稿引用
- `src/app/api/videos/hydrate/route.ts`：补全 B 站视频统计数据
- `src/app/api/transcribe/route.ts`：单条视频转写
- `src/app/api/batch-transcribe/route.ts`：批量转写
- `src/app/api/style/route.ts`：账号风格卡生成 / 保存
- `src/app/api/projects/route.ts`：项目创建 / 删除 / 风格卡生成 / 保存
- `src/app/api/drafts/route.ts`：草稿保存
- `src/app/api/library/route.ts`：风格库聚合状态
- `src/app/api/transcripts/route.ts`：转写稿读取 / 保存 / 删除
- `src/app/api/write/route.ts`：文案生成
- `src/app/api/health/route.ts`：运行环境诊断
- `src/app/api/feishu/document/route.ts`：飞书文档发布

## 核心数据模型

类型定义在 `src/lib/types.ts`。

最重要实体：

- `Account`：平台账号
- `Video`：视频、统计数据、转写状态与原始数据
- `Draft`：写作产物
- `Project`：聚合多个账号的项目
- `AccountSummary` / `ProjectSummary`：页面消费的聚合态
- `LibraryState`：首页、库页和全局 Provider 消费的状态载荷

平台枚举目前只有：

- `bilibili`
- `douyin`

如果要扩展平台，优先从 `src/lib/types.ts`、`src/lib/opencli.ts`、`src/lib/storage.ts`、`src/lib/client.ts` 和相关 API 入手，保持类型、落盘结构、采集链路和前端请求一起演进。

## 本地存储约定

本项目以文件系统为核心，不以数据库为中心。

主要逻辑在 `src/lib/storage.ts`，默认根目录为：

- `STYLE_LIBRARY_DIR`
- 未配置时为 `./style-library`

落盘结构大致如下：

```text
style-library/
  bilibili/
    <account-slug>/
      account.json
      style.md
      videos/
        <video-id>.json
      transcripts/
        <video-id>.txt
      drafts/
        <draft-id>.json
  douyin/
    <account-slug>/
      account.json
      style.md
      videos/
      transcripts/
      drafts/
  projects/
    <project-slug>/
      project.json
      style.md
      drafts/
```

存储协作要求：

- 修改存储逻辑时，优先保持向后兼容，不要轻易改已有目录结构。
- JSON 写入已通过临时文件 + `rename` 实现原子落盘，新增 JSON 写逻辑时保持同样模式。
- 删除账号时要同步更新项目 `sourceAccountIds`。
- 删除视频时要同步删除对应转写稿，并清理草稿 `styleRef.videoIds` 中的引用。
- `style.md` 和转写稿是用户可编辑资产，保存时不要引入不必要的格式重写。

## 业务实现分层

### 前端请求层

`src/lib/client.ts`

- 封装前端到 `/api/*` 的请求。
- 默认 `Content-Type: application/json`，并使用 `cache: "no-store"`。
- 前端页面应尽量复用这里的函数，不要在页面里散落重复 `fetch("/api/...")`。
- 新增 API 后，除非明确只服务服务端内部逻辑，否则优先补一层 client 函数。

### API 层

`src/app/api/**/route.ts`

- 负责入参校验、流程编排、错误返回。
- 入参校验优先使用 `zod`。
- 需要访问本地文件、环境变量或 `opencli` 的接口应使用 Node.js runtime。
- 返回错误时保持用户可读的中文错误信息，不要直接泄漏低层实现细节。

### 领域逻辑层

`src/lib/opencli.ts`

- 封装 `opencli` 调用。
- 负责账号解析、B 站用户搜索、视频采集、B 站详情补全、字幕拉取、视频下载等。
- B 站采集支持分页和详情补全，修改时要避免破坏时间窗筛选需要的候选数据。

`src/lib/transcription.ts`

- 封装转写链路。
- 优先使用平台字幕；必要时下载媒体并调用硅基流动转写。
- 抖音转写优先通过 `opencli douyin user-videos` 获取最新媒体地址，再用 `ffmpeg` 抽取 16kHz 单声道低码率音频上传转写，避免整段视频上传。
- 抖音批量转写会先按账号预取一次媒体地址，再使用小并发；默认并发 `2`，可用 `DOUYIN_TRANSCRIBE_CONCURRENCY` 调整。如果 opencli、ffmpeg 或硅基流动限流不稳定，优先降回 `1`。
- 转写失败要更新视频状态，避免页面一直停留在进行中状态。

`src/lib/ai.ts`

- 封装模型调用。
- 兼容 `responses` 和 `chat_completions`。
- 支持代理。
- 支持联网研究补充上下文。
- 模型不可用时保留本地 fallback，这是设计的一部分。

`src/lib/storage.ts`

- 负责本地文件系统读写、聚合和引用联动。
- 是数据一致性的核心位置，改动前先读现有函数，优先复用。

## 前端风格约定

全局样式在 `src/app/globals.css`，当前 UI 风格已经比较明确：

- 本地工作台 / 控制台风格
- 浅色主题
- 使用 CSS 变量统一颜色、阴影、圆角和状态样式
- 强调信息密度、可编辑性和操作效率

前端改动时请遵守：

- 优先延续现有设计语言，不要突然切成完全不同的品牌风格。
- 尽量复用已有变量、按钮、面板、表单、状态和空态样式。
- 新增页面或区块要同时考虑桌面端和移动端。
- 不要为“看起来更现代”无理由引入大体量 UI 框架。
- 首页与库页依赖 `useLibrary()` 的全局数据刷新机制，改接口后要检查相关页面联动。

## 已知运行约束与坑

- 开发服务器运行时不要并行执行 `npm run build`，否则 `.next` 可能导致开发页静态资源短暂 404。
- B 站采集支持按时间窗过滤，并且会分页补抓候选数据；不要轻易简化这段逻辑。
- 抖音账号名搜索通过 `opencli douyin search` 适配器接入；如果当前 opencli 环境缺少该命令，应提示用户升级 / 安装适配器，或临时提供明确 `sec_uid` / 主页链接。
- 部分 B 站视频的点赞 / 评论 / 收藏数据会在前端二次 hydrate，避免误删 `/api/videos/hydrate` 链路。
- 模型能力缺失时退回模板生成是刻意设计，不是 bug。
- 本地素材库可能包含用户长期积累资产，涉及删除、迁移、批量重写时要格外保守。

## 常见任务入口

- 采集问题：优先看 `src/lib/opencli.ts` 和 `src/app/api/collect/route.ts`
- 转写问题：优先看 `src/lib/transcription.ts`、`src/app/api/transcribe/route.ts` 和 `src/app/api/batch-transcribe/route.ts`
- 风格卡生成：优先看 `src/lib/ai.ts`、`src/app/api/style/route.ts` 和 `src/app/api/projects/route.ts`
- 写作生成：优先看 `src/app/writer/page.tsx`、`src/app/api/write/route.ts` 和 `src/lib/ai.ts`
- 数据异常：优先看 `src/lib/storage.ts` 和实际 `style-library` 目录
- 展示异常：优先看 `src/components/*`、`src/app/globals.css` 和对应 `page.tsx`
- 飞书发布：优先看 `src/lib/feishu.ts` 和 `src/app/api/feishu/document/route.ts`
- 环境诊断：优先看 `src/app/api/health/route.ts`

## 修改代码时的优先原则

- 先理解 `src/lib/types.ts` 的数据边界，再改 API 和 UI。
- 先复用已有 `src/lib/*` 能力，再新增重复函数。
- 尽量让页面只负责交互和展示，复杂逻辑下沉到 `src/lib`。
- 新增接口先想清楚是否应进入 `src/lib/client.ts`。
- 改动落盘格式前，先评估对现有 `style-library` 的兼容性。
- 涉及删除、迁移、批量操作时，优先做可恢复或最小范围改动。
- 不要把本地 fallback、部分采集失败、部分转写失败简单处理成全站失败。

## 复杂任务工作流

不需要整包引入外部 Agent 技能仓库；遇到中等及以上功能、跨层改动、存储结构调整、模型 / 采集 / 转写链路改造，按下面的轻量流程执行：

1. **Spec**：先写清楚目标、输入输出、用户可见行为、边界条件、明确不做的事，以及是否影响既有 `style-library` 数据。
2. **Plan**：拆成可独立验证的小步，标出会触碰的 `src/lib/*`、API、页面和文档文件，优先安排能尽早暴露风险的垂直切片。
3. **Build**：按既有分层实现，优先复用领域逻辑和 `src/lib/client.ts`；涉及 `opencli`、模型、飞书或本地文件时保留中文错误和本地 fallback。
4. **Test**：行为改动要补对应检查；存储、API、引用联动和 fallback 逻辑要重点验证。中等及以上代码改动至少跑 `npm run lint` 和 `npm run typecheck`。
5. **Review**：提交前自查兼容性、删除 / 迁移风险、用户可编辑资产是否被无谓重写、UI 是否仍符合本地工作台风格；新增页面、API、环境变量或目录结构时同步更新文档。

## Agent 接手顺序

默认按这个顺序建立上下文：

1. `README.md`
2. `AGENTS.md`
3. `src/lib/types.ts`
4. `src/lib/storage.ts`
5. 相关 `src/lib/*` 领域逻辑
6. 相关 API `route.ts`
7. 对应页面 `page.tsx` / 组件

接手时建议先运行：

```bash
git status --short
rg --files src app components lib
```

如果工作树已有改动，不要回滚用户或其他 Agent 的修改。只编辑和当前任务相关的文件。

## 提交前检查

完成任何中等及以上代码改动后，至少执行：

```bash
npm run lint
npm run typecheck
```

如果改动影响 Next.js 构建、路由、SSR/服务端行为，再补：

```bash
npm run build
```

但前提是当前没有正在运行的 `npm run dev`。如果开发服务器正在运行，先和用户确认是否可以停止，或只做 lint / typecheck。

纯文档改动通常不需要跑完整检查，但要至少确认文件能正常读取、内容与实际项目一致。

## 文档维护规则

当出现以下变化时，应同步更新本文件：

- 新增核心页面或 API
- 新增平台
- 本地存储目录结构变化
- 模型、采集、转写、飞书发布链路的关键约束变化
- 项目运行方式或环境变量要求变化
- 全局 UI 风格或数据流约定变化

目标不是把这里写成百科，而是保证新 Agent 在 5 分钟内知道：

- 这个项目是做什么的
- 核心数据放在哪里
- 主要逻辑分布在哪些文件
- 改代码时最容易踩什么坑
