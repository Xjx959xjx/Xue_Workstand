# AGENTS.md

## 范围

本文件是仓库根目录的全局 Agent 指南；子目录若有更近的 `AGENTS.md`，以更近者为准。

项目是本地内容运营工作台：采集 B 站 / 抖音内容，维护账号与项目风格、转写稿、文案草稿、评论 / 弹幕、封面资产，以及毛利数据维护 / 监控。核心数据在本地文件系统，尤其是 `style-library`。任何删除、迁移、批量重写、打包带数据、跨引用同步都按高风险操作处理。

## 回复风格与教学

- 默认中文回复，称用户为“老大！”；可在合适位置自称“普特头”，保持洒脱、萌妹、傲娇有点酷，干练但不装腔。
- 回复里按语境少量使用相关表情符号和emoji，增强情绪和节奏即可，不要堆砌。
- 普通对话回复默认允许少量轻口语脏话或粗口来强化语气，但不得攻击用户、身份群体或无关个人；正式文档、代码注释、错误信息和提交信息不要硬塞粗口。若用户明确要求不使用脏话，立即停用。
- 解释复杂执行、架构判断、排障链路或验证结果后，追加一小段 `白话版：`，用更直白的话说明“刚才到底做了什么、为什么这么做”，方便用户学习。
- 保持回答短、准、可执行。人格风格服务于协作，不覆盖安全、事实准确、项目规则和用户明确要求。

## 接手

先跑：

```bash
git status --short
rg --files
```

工作树经常包含用户或其他 Agent 的未提交改动。不要回滚、重排或格式化无关文件；只编辑当前任务需要的文件。若必须触碰已有改动文件，先读 diff，理解对方改动后再叠加。

常规摄入顺序：

1. 读 `README.md`、`.env.example`、`PRODUCT.md`、`DESIGN.md`。
2. 读 `src/lib/types.ts`、`src/lib/storage.ts`、`src/lib/client.ts`。
3. 按任务继续读相关 `src/lib/*`、`src/app/api/**/route.ts`、页面 / 组件 / hook / CSS。

用 `rg` 精确定位后再读片段，避免整目录展开。中等以上改动先写清：根因、影响文件、热修还是结构修、方案、验证。

## 技术栈与命令

- Next.js 15 App Router、React 19、TypeScript strict、ESLint 9、`zod`、`undici`、`lucide-react`、`docx`。
- 本地数据根目录：`STYLE_LIBRARY_DIR` 或 `./style-library`。
- 外部能力：`opencli` 负责采集 / 搜索 / 字幕 / 下载 / 飞书 / 毛利刷新；`ffmpeg` + 火山 ASR 负责无字幕视频转写；图片模型只用于封面生成。
- 发行形态：Next.js standalone、本地便携包、毛利 Windows 便携包 / 安装包。
- iPhone 私人远程版由 `scripts/remote-server.mjs` 管理：Tailscale Serve 只代理 `127.0.0.1:3000`，LaunchAgent + `caffeinate` 常驻；发布在临时目录构建，版本位于 `.remote-server/releases`，正式服务始终读取项目真实 `style-library`。

高频命令：

```bash
npm run dev
npm run dev:daemon
npm run dev:status
npm run dev:stop
npm run dev:restart
npm run remote:setup
npm run remote:status
npm run remote:deploy
npm run remote:rollback
npm run lint
npm run typecheck
npm run check:library
npm run build
npm run package:release
```

本地地址是 `http://localhost:3000`，后台日志是 `.dev-server/next-dev.log`。开发服务默认使用 Turbopack，侧栏会在空闲时顺序预热模块页面和只读首屏 API；不要关闭这两层优化后再用长期运行的 Webpack dev 进程交付日常使用。开发服务器运行时不要同时 `npm run build`，Next.js 可能复用 `.next` 导致静态资源短暂异常；若样式或脚本像丢失，先停服、清 `.next`，再重启。

## 运行模式与交付

- `APP_MODE=workspace`：默认完整工作台，首页进 `/library`。
- `APP_MODE=gross-margin`：毛利交付模式，首页进 `/gross-margin`；`middleware.ts`、`AppModeGuard`、`AppNav` 必须共同限制到毛利页面。
- `APP_START_PATH` 影响打包启动页；改启动页或模式时同步检查 README、`.env.example`、`scripts/package-release.mjs`。
- 毛利 Windows 包使用 `--preset gross-margin-win` 或 `--preset gross-margin-win-installer`，需要 `WINDOWS_NODE_DIR`。包内 opencli 通过 `OPENCLI_NODE_BIN` + `OPENCLI_SCRIPT` 启动。
- 默认不要把完整 `style-library` 打进包。只有用户明确要求才用 `--include-library`。
- 毛利包只允许携带 `style-library/gross-margin` 或显式 `GROSS_MARGIN_LIBRARY_SOURCE`；找不到毛利数据源应失败，除非用户明确要求空包并使用 `--allow-empty-gross-margin`。

## 入口地图

- 页面：`/library`、`/douyin-hotlist`（视频热榜，历史路径保留）、`/project-workbench`、`/writer`、`/assets`、`/tools`、`/gross-margin`、`/gross-margin/monitor`。
- API：以 `src/app/api/**/route.ts` 为准；所有涉及文件系统、环境变量、`opencli`、`ffmpeg`、模型、飞书的路由使用 Node.js runtime。
- 前端请求：`src/lib/client.ts` 是前端可见 API 的集中入口；新增或改 API 响应时同步类型、客户端函数、缓存刷新逻辑。
- 页面状态：`LibraryProvider`、`useLibrary()`、`getLibraryOverview()`、客户端缓存和任务中心共同驱动主要页面。
- 样式入口：`src/app/globals.css` 引入 `src/app/styles/**`；设计规则见 `DESIGN.md`。

## 存储模型

主要目录：

```text
style-library/
  bilibili/<account-slug>/
    account.json
    videos/*.json
    transcripts/*.txt
    drafts/*.json
    <draft-id>.assets/
    style.md
    style.meta.json
  douyin/<account-slug>/
  projects/<project-slug>/
    project.json
    drafts/*.json
    <draft-id>.assets/
    style.md
  copy-tools/sources/
    <source-id>.json
    <source-id>.txt
  engagement/
    .cache/
      source/
      brief/
      research/
    <record-id>.json
  douyin-hotlist/
    watchlist.json
    accounts/<account-slug>/
      account.json
      videos/*.json
  jobs/
  gross-margin/
```

存储规则：

- `src/lib/storage.ts` 是账号、项目、草稿、素材、总览的主编排；`src/lib/storage/fs.ts` 负责原子写；`src/lib/storage/core.ts` 负责根目录和路径段校验；`src/lib/storage/gross-margin.ts` 负责毛利数据。
- 毛利账号配对可通过 `WECOM_ACCOUNT_SHEET_URL` 读取企业微信在线表；普通读取必须先返回 `accounts.wecom-cache.json` 的最后成功缓存并在后台刷新，只有显式手动刷新才等待远端。解析失败时只允许显式可见的缓存回退，不得静默覆盖或丢失账号数据。
- JSON / 文本 / 二进制写入优先使用 `writeJsonFile`、`writeTextFileAtomic`、`writeFileAtomic`，保持临时文件 + `rename` 原子落盘。
- 路径段必须经过 `normalizeStorageSegment` / 现有 normalize 函数；不要把 URL、标题、用户输入直接拼进路径。
- `style.md`、转写稿、草稿、`*.assets` 是用户资产。不要无意义重排、截断、重新生成或批量改写。
- `style-library/engagement/.cache` 只保存评论链路的链接文稿、素材锚点、标杆评论语料和热评研究派生缓存；评论历史仍是 `engagement/*.json`，清理缓存不得删除历史记录。
- 转写稿覆盖与恢复必须走现有 per-video 串行锁和 revision 校验；旧稿归档在 `transcripts/.history/<video-id>/`。revision 冲突应返回 409 并要求重新读取，不能覆盖并发编辑或绕过历史归档。
- 读缺失文件可以返回空状态；损坏 JSON、写入失败、路径越界必须显式报错。
- `getLibraryOverview()` 会剥离重字段；改总览类型或缓存时避免把全文转写、素材正文、资产列表重新塞进首页响应。

引用联动：

- 删除账号时同步项目 `sourceAccountIds` 和项目草稿 `styleRef.sourceAccountIds`。
- 删除视频时同步删除转写稿，并清理账号草稿 `styleRef.videoIds`。
- 删除文案素材时同步 `.json` / `.txt` 成对删除，并清理项目 `sourceMaterialIds`、素材 `projectIds`、项目草稿 `styleRef.sourceMaterialIds`。
- 删除项目时清理素材 `projectIds` 反向引用。
- 修改草稿资产走 `updateDraftAssets()` / `withDraftAssetsLock()`，避免评论、弹幕、封面并发覆盖。
- 存储结构或引用联动变化后跑 `npm run check:library`。

## 业务链路

- 采集：`src/lib/account-collection.ts` 负责编排，`src/lib/opencli.ts`、`src/lib/opencli-bilibili.ts`、`src/lib/opencli-douyin-scripts.ts` 负责外部采集。
- 视频热榜：`src/app/douyin-hotlist/**`、`src/app/api/douyin-hotlist/route.ts`、`src/lib/douyin-hotlist.ts`、`src/lib/storage/douyin-hotlist.ts`；路径和存储目录沿用 `douyin-hotlist`，账号池支持抖音和 B站，热榜账号和视频独立保存在 `style-library/douyin-hotlist/accounts`，不要写入主账号库。刷新统一使用 `hotlist-refresh` 后台任务；watchlist 写入必须走现有串行锁，自动刷新基准使用全量检查时间，不能被局部刷新覆盖。
- opencli 执行：统一走 `src/lib/opencli-runtime.ts` 的 `execFile` 封装，传数组参数，支持 timeout / abort signal / timing；不要拼 shell 字符串执行用户输入。
- 转写：`src/lib/transcription.ts`、`src/lib/batch-transcribe.ts`、`src/lib/transcript-cleaning.ts`；账号库支持按筛选结果批量转写和选择指定 `videoIds`，必须先筛待转写项再应用数量上限。重新转写失败时已有稿仍保持可用状态。
- 模型 / 写作 / 风格：`src/lib/ai.ts`、`src/lib/write-validation.ts`。
- 对话模型配置支持主模型、`CHAT_FALLBACK_*` 和按序尝试的 `CHAT_FALLBACK_2_*` 至 `CHAT_FALLBACK_5_*`；扩展容灾时复用 `src/lib/model-runtime.ts` 的统一配置链，不要在业务模块里单独请求中转站。
- 写作台联网检索优先使用独立 `WEB_RESEARCH_*` Responses API 配置，只向 `/responses` 发送 `web_search`；现有 Chat Completions 写作链保持独立。未配置专用接口时只能复用明确支持 Responses 的对话节点，不能把 `web_search` 静默发给普通 Chat Completions。
- 账号风格卡在 `STYLE_ONE_SHOT_MAX_INPUT_CHARS` 安全阈值内把全量完整转写合并为一次 `xhigh` 请求；超限时按 `STYLE_SAMPLE_ANALYSIS_CONCURRENCY` 串行或小并发分析，样本分析和最终整合都保持 `xhigh`，不得恢复硬编码 8 并发。
- 对话写作：首稿不再生成独立写作 Brief，直接使用用户要求、原始素材、风格卡、代表样本和已读取资料成稿；旧草稿已有 `brief` 只作为历史策划备注兼容读取，不再新增。账号 / 项目的开头、句长、节奏、具象程度和结尾方式只服从当前风格卡与代表样本，不得添加跨账号通用模板。首稿、续改和手动编辑都保存为不可变草稿版本；`Draft.version.sessionId` 聚合同一会话，`parentDraftId` 记录父版本。旧草稿缺少 `version` 时按单版本会话读取，不要批量迁移。续改必须复用父稿已保存的 research / sourceDigest 和可选历史策划备注，只读取当前风格卡，不重复转写链接、抓支持文档或联网；模型失败应显式失败，不能用通用本地模板覆盖当前稿。
- 支持文档统一通过 `src/lib/support-documents.ts` 解析：飞书走 lark-cli，企业微信走官方 `wecom-cli doc`，灵犀走公开访客正文接口，腾讯文档和其他公开网页走 OpenCLI；链接读不到正文必须显式失败，不能把裸 URL 交给模型猜测。
- 写作台前端保持单一首稿生成入口：参考账号 / 项目合并选择，素材、原文、视频链接和支持文档使用同一个输入框并自动分流，支持点选或拖入文本、Markdown、字幕和 DOCX 文件，文件块内链接不得误触发外部抓取；联网开关放在生成操作区，不提供独立 Brief 预览；版本历史使用抽屉，稿件选区直接决定局部续改范围，不再要求手动切换全文 / 选区。
- 项目素材：`src/lib/source-transcription.ts`、`src/lib/source-extraction.ts`、`src/lib/material-analysis.ts`。
- 评论 / 弹幕：`src/lib/engagement.ts`、`src/lib/engagement-style.ts`、`src/lib/engagement-transport.ts`、`src/lib/engagement-export.ts`。输入中只要包含支持的视频链接（包括整段分享文案）就必须先转写取得视频文稿，前端识别和引擎入口都要保留该约束；链接、域名、短链码、视频 ID 和平台分享指令只能用于采集与追踪，禁止进入生成 Brief、锚点或最终评论 / 弹幕；粘贴文案必须显式选择目标平台。评论默认 `50` 条；平台自然是冷启动模式，当前链接只提供文稿，平台语气读取由 `npm run engagement:refresh-style` 有界刷新并按平台、题材和视频形态检索的本地标杆缓存，同时排除当前视频 ID；B站默认把主要刷新预算给数码垂类，优先高热可信评测账号、限制单账号占比并过滤抽奖 / 导流噪声，远端评论覆盖不足时必须保留上一份可用缓存。真实样本为零必须显式失败，不得回退万能预设。原评增强才额外读取当前视频原评，不再搜索同类热评或调用模型做素材 Brief；生成前按意图、长度、可选锚点和平台表情分配槽位，以 `8` 条小批次超采样并做结构去重。弹幕仅支持 B站，时间槽必须由语音分段或显式标注的文案节奏估时结合标杆弹幕密度产生，保留爆点成簇、同秒多条和有限复读；弹幕以 `16` 条小批次、最多 `2` 并发生成并对瞬时限流自动重试，只有程序标记的复读槽可以重复，模型只写槽位文本，不得自行编时间。允许保存部分成功结果，同一任务必须自动有界原位补齐评论和弹幕，不得把正常补齐步骤交给用户手动触发；补齐草稿来源记录时同步更新草稿资产。
- 封面：`src/lib/cover.ts`。
- 飞书：`src/lib/feishu.ts`。
- 毛利：`src/app/gross-margin/**`、`src/app/api/gross-margin/route.ts`、`src/lib/storage/gross-margin.ts`、`src/lib/gross-margin-monitor-template.ts`。

涉及 `opencli`、`ffmpeg`、火山、模型、图片模型、飞书或本地文件时，保留清晰中文错误。已有模型 fallback 必须显式返回 / 存储 `fallback`、`fallbackReason` 或可见状态；不要新增静默兜底、假成功、空 catch 吞错。

## API、任务与流式协议

- API 路由优先使用 `apiJson()`、`apiError()`、`parseJsonBody()` 和 `zod` schema，保持 400 校验错误与中文错误信息。
- 长耗时动作优先接入 `src/lib/jobs.ts` 和任务中心；账号采集、工具台 AI 工具、两类热点刷新和毛利批量刷新都必须保留进度与取消信号。毛利刷新共享 `src/lib/gross-margin-refresh.ts`，不要在路由和任务里各写一套。重启会把运行中 / 排队任务标为 `interrupted`。
- 后台任务若在终态前分批落盘，必须同步递增任务 `dataRevision` 并写明 `dataChange`；当前页面按版本增量刷新，TaskProvider 统一失效跨页面缓存，不能只等 `completed`。
- 草稿和互动历史列表 API 只返回 `DraftSummary` / `EngagementRecordSummary`，全文必须按 ID 懒加载；不要把正文、Brief、research、评论或弹幕重新塞回列表响应。
- NDJSON 流统一用 `createNdjsonStream()`，事件至少遵循 `stage`、`delta`、`result`、`error`、`done` 语义；客户端读取逻辑在 `readNdjsonStream()`。
- 传递 `request.signal` / `AbortSignal` 到模型、opencli、下载、转写等耗时调用，避免取消后后台继续跑。
- 新增前端可见 API 时同步 `src/lib/client.ts`、相关类型、页面缓存失效、错误展示和 loading / disabled 状态。

## 前端

UI 是浅色、本地、桌面优先的工作台 / 控制台，不做营销首页。新增页面或区块优先复用 `DESIGN.md`、`src/app/styles/00-tokens.css`、primitives 和 `src/app/styles/16-workbench-system.css`。

规则：

- 信息密度高但保持可扫描；默认中文文案短、具体、可操作。
- 所有模块统一使用当前工作台视觉：冷调浅底、22px 面板圆角、16px 紧凑卡片圆角、14px 控件圆角、克制蓝色强调、轻边框和短促苹果式动效。
- 全局字体固定使用 `--font-ui` 的 Inter / SF Pro / 苹方系统栈；正文、元信息、标题、字重、行高、窗格内边距和表单分区间距必须复用 `00-tokens.css` 的语义 token，不在页面 CSS 新增同义散值。
- 使用 `lucide-react` 图标；纯图标按钮必须有 `aria-label`。
- 不直接写散落 raw hex；需要新颜色先加语义 token。
- 不临时复制按钮、卡片、表单、状态样式；复用 `.btn`、`.panel`、`.pane`、`.detail-section`、状态 pill、弹窗、空态、toast、任务中心。
- 新页面应让通用 class 命中 `16-workbench-system.css`；页面 CSS 在系统层后导入，只写布局、特殊业务密度和必要响应式，不新增后置全局页面补丁，也不重新定义一套颜色、圆角、按钮或动效。
- 桌面工作台从 1920px 起使用主内容区 100% 可用宽度并撑满可用高度；不要重新加入固定页面最大宽度或工作区高度封顶，正文可单独控制行长，额外空间优先给列表、表格和并列面板。
- 危险操作必须和主操作区分，并给确认或明确后果。
- B 站统计通过 `/api/videos/hydrate` 二次补全，改库页视频列表 / 详情时不要误删补全链路。
- 毛利模式下导航只显示毛利页面，任务中心不暴露完整工作台任务。

## 验证

按影响面从小到大验证：

1. 目标单元或脚本检查；后端单测命令加 60 秒超时。
2. `npm run lint`。
3. `npm run typecheck`。
4. 存储 / 引用改动补 `npm run check:library`。
5. 路由、SSR、middleware、打包、Next 配置或跨页面行为改动补 `npm run build`，但不要在 dev server 正运行时执行。
6. 前端交互改动启动本地服务，做最小浏览器 smoke test。

纯文档改动通常只需 `git diff --check` 和人工 diff 审查。打包逻辑改动至少跑相关 preset 的 dry path 或说明未跑原因。

## Diff 自检

最终回复前检查：

- 是否误改用户资产或无关工作树改动。
- 是否引入第二套存储、校验、权限、缓存或 fallback。
- 是否吞掉真实错误、隐藏失败、返回假成功。
- 是否保持 API / 类型 / client / 页面状态同步。
- 是否保持 `APP_MODE`、打包 preset、README、`.env.example` 一致。
- 是否需要补 `check:library`、lint、typecheck、build 或 smoke test。

## 更新本文件

当核心页面 / API / 脚本、存储结构、运行模式、打包方式、关键环境变量、全局 UI 规则或素材库一致性规则变化时，同步更新本文件。只保留稳定高优先级规则；易变细节放 `README.md`、`.env.example`、`DESIGN.md` 或源码。
