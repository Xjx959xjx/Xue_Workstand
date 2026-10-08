# AGENTS.md

## 适用范围与规则级别

本文件适用于整个仓库；子目录 `AGENTS.md` 仅在其作用域内覆盖冲突条款，其余根级规则继续生效。本地项目数据位于 `STYLE_LIBRARY_DIR` 或 `./style-library`，其中账号、项目、转写稿、草稿、互动记录、封面和毛利数据可能无法重建。

- **MUST**：数据安全、兼容性和交付边界，必须遵守。
- **SHOULD**：默认工程方式；有充分理由可以调整，但要说明影响并验证。
- **REFERENCE**：易变的产品和实现细节以文档、源码为准。

技能和插件流程服从用户明确指令与本项目规则；不得削弱 MUST 约束。

## 沟通

- 默认中文回复，称用户为“老大！”，先给结论和风险，保持简短、可执行。解释复杂问题后追加一小段 `白话版：`；不要把回复格式要求写进文档、代码或提交信息。

## 接手与上下文

涉及仓库操作时先运行 `git status --short`。需要定位文件时按目标范围运行 `rg --files`；已知文件则直接读取相关片段。

- 工作树经常包含用户或其他 Agent 的未提交改动。不得回滚、覆盖、重排或格式化无关改动；必须触碰已有改动文件时，先读 diff 再叠加。
- 只读取当前任务需要的上下文。用 `rg` 定位目标调用链后，按需查看 `README.md`、`DESIGN.md`、目标页面 / API、对应的 `src/lib` 模块和测试；不要固定通读大型文件。

## 任务推进与技能协作

- 目标和边界明确时直接推进，完成相关验证后交付。复用当前任务已有授权和选择；仅在缺失信息会实质改变目标、参数或影响，或下一步需要尚未获得的授权时询问。
- 故障先复现或收集证据，沿调用链定位根因，再做最小修复。中等以上改动先明确目标 / 根因、影响范围、方案和验证；范围清楚的小改动不要求独立设计或计划文档。
- 修改共享逻辑前检查调用方；同步受影响的类型、测试、配置和导出。优先复用现有实现，不顺带重构、增加依赖或扩展功能。
- 按任务需要选用技能：排错重证据，跨模块改动重接口与计划，交付重验证。不因技能模板额外要求反复确认、文档落盘、提交或新建分支 / worktree；确有隔离或协作需要时再采用对应流程。

## MUST：数据与文件安全

- `style.md`、转写稿、草稿、`*.assets`、互动历史和毛利数据是用户资产；未经明确授权不得删除、迁移、批量重写、重新生成或打包外发。
- 删除账号、视频、项目、素材或草稿必须走现有可恢复删除 / 事务机制，并保持跨引用同步；不得绕过锁、直接递归删除业务目录。
- JSON、文本和二进制写入复用 `writeJsonFile`、`writeTextFileAtomic`、`writeFileAtomic` 或现有事务封装，保持临时文件 + `rename` 的原子落盘。
- 所有路径段经过 `normalizeStorageSegment` 或现有 normalize 函数；不得把 URL、标题或用户输入直接拼进路径。
- 持久化记录保留 `schemaVersion`，读取经过 `src/lib/storage/schemas.ts` 运行时校验。仅允许首次初始化的可选文件缺失时返回空状态；已有记录或必需文件丢失、损坏 JSON、路径越界和写入失败必须显式报错。
- 转写覆盖与恢复必须使用 per-video 串行锁和 revision 校验，并保留 `transcripts/.history/<video-id>/` 历史；冲突返回 409，不得覆盖并发编辑。
- 重新转写失败时已有稿保持可用；毛利在线账号表远端解析失败时只允许显式可见的缓存回退，不覆盖可用账号数据。
- 草稿资产更新走 `updateDraftAssets()` / `withDraftAssetsLock()`；watchlist、身份映射和其他共享文件复用已有串行锁。
- `npm run check:library:repair` 只在用户明确同意后对真实素材库执行；修复前必须备份，不能自动处理无法安全推导的问题。
- 默认发行包不得包含完整 `style-library`。只有用户明确要求时使用 `--include-library`；毛利包只允许携带毛利数据源，缺失时默认失败。

## MUST：错误、外部能力与并发

- 涉及 `opencli`、`ffmpeg`、火山、模型、图片模型、飞书、企业微信或本地文件时，错误必须是可见、可操作的中文信息；不得新增吞掉业务失败的空 catch、假成功或无关模板兜底。仅忽略可选解析 / 清理失败时要用注释说明边界。
- fallback 必须显式返回或持久化 `fallback`、`fallbackReason` 等状态。模型失败应失败，不得用通用本地文案覆盖当前结果。
- OpenCLI 执行复用 `src/lib/opencli-runtime.ts`，使用 `execFile` 和参数数组，传递 timeout / `AbortSignal`；不得用 shell 字符串拼接用户输入。
- 对话模型与备用节点复用 `src/lib/model-runtime.ts` 的统一配置链。联网检索只发送到明确支持 Responses `web_search` 的节点，不得发给普通 Chat Completions。
- 支持文档复用 `src/lib/support-documents.ts`：飞书走 Lark CLI，企业微信走官方 `wecom-cli doc`，其他来源沿用现有适配器；正文读取失败必须显式失败。
- 长任务接入 `src/lib/jobs.ts` 和任务中心，保留进度、取消、重启中断恢复和持久化，不能以 `after()` 或未等待的 Promise 替代。终态前分批落盘时同步递增 `dataRevision` 并写明 `dataChange`。
- 并行操作必须保留并发上限、串行锁、revision 校验和取消信号；同一资产的读改写不得直接改为 `Promise.all()`。
- 将“客户端缓存失效”和“立即重新请求”分开；页面不消费某资源时只失效缓存，避免后台任务触发无关全量读取。

## MUST：API 与客户端契约

- 本地 Next.js 中涉及文件系统、环境变量、外部 CLI 或模型的路由使用 Node.js runtime；Sites / Cloudflare 路径复用现有云端适配器和能力桥接，不假设 Worker 可直接访问本机文件或执行本机 CLI。
- API 路由复用 `apiJson()`、`apiError()`、`parseJsonBody()` 和 `zod` schema，保持 400 校验错误与中文提示。
- NDJSON 复用 `createNdjsonStream()` / `readNdjsonStream()`，保持 `stage`、`delta`、`result`、`error`、`done` 语义，并传递请求取消信号。
- 修改前端可见 API 时，同步类型、`src/lib/client.ts`、缓存失效、页面状态和错误展示。

## MUST：运行模式与交付

- `APP_MODE=workspace`：完整工作台，根路径默认进入 `/douyin-hotlist`。
- `APP_MODE=gross-margin`：只开放 `/gross-margin`、`/gross-margin/monitor` 及必要 API；`middleware.ts`、`AppModeGuard`、`AppNav` 和任务类型限制必须一致。
- `APP_START_PATH` 影响交付包启动页；调整模式或启动页时同步检查 README、`.env.example` 和 `scripts/package-release.mjs`。
- Sites 使用 `SITES_WORKSPACE_SOURCE=local` 时会读写本机真实资料库，必须沿用本机锁、revision 和可恢复删除机制；云端与本机 `APP_MODE` 必须一致，资料桥断线显式失败，不回退到空云端库。桥接协议变更须同步检查两端兼容性。
- 开发服务运行时不要直接在同一 `.next` 上执行 `npm run build`。需要构建时优先使用隔离临时目录（参考发布脚本）；仅在必须中断用户正在使用的服务且尚未获得授权时请求确认。

## SHOULD：实现方式

- 列表 API 和 `getLibraryOverview()` 保持轻量，返回摘要；全文转写、素材正文、完整草稿、research、评论、弹幕和资产等重字段按 ID 懒加载。
- 优先扩展现有存储、校验、任务、缓存和 fallback 机制；并行优化仅用于互不依赖的操作。
- 本地 Next.js 开发服务默认使用 Turbopack；预热属于可测量的性能实现，不是不可变产品规则。修改时用冷启动 / 路由切换数据验证。

## 业务规则（逐条标级）

- **MUST**：视频热榜账号与视频保存在资料库独立的 `douyin-hotlist/accounts` 下，不得写入主账号库；刷新继续使用后台任务和 watchlist 锁。
- **MUST**：账号库的 B站统计继续通过 `/api/videos/hydrate` 二次补全；修改视频列表或详情时不得绕过该链路。
- **SHOULD**：批量转写先筛选待转写项再应用数量上限。
- **MUST**：写作台多选风格卡时，每张卡生成一篇互不混合的独立草稿；单篇草稿只保存自身风格引用，续改沿用该稿风格。首稿、续改和手动编辑保持不可变版本链；`originalSourceInput` 保存写作台素材输入框原貌，历史恢复优先使用它，模型仍使用已解析的 `input` / `sourceDigest`。
- **SHOULD**：多选风格卡生成采用有界并发；续改复用父稿已保存资料，不重复转写链接、抓支持文档或联网。
- **MUST**：评论 / 弹幕输入包含支持的视频链接时先取得视频文稿；链接标识只用于采集追踪，不进入 Brief 或最终文案。真实平台样本缺失时显式失败。
- **SHOULD**：评论 / 弹幕部分成功结果按现有有界机制自动补齐；毛利在线账号表普通读取优先返回最后成功缓存并后台刷新。

## SHOULD：前端与 React

- `DESIGN.md` 是视觉单一来源；复用 token、primitives、`16-workbench-system.css` 和既有工作台组件，不创建第二套按钮、卡片、状态或动效系统。
- 根级全局 CSS 只承载 token、基础样式、通用 primitives 和 shell；路由专属布局与响应式样式尽量与页面 / layout 共置，避免所有页面加载全部业务 CSS。
- 使用 `lucide-react`；纯图标按钮提供 `aria-label`，表单有可见 label，异步状态有 `aria-live` / `aria-busy`，键盘焦点清晰，动效尊重 `prefers-reduced-motion`。
- 弹窗统一处理 `role="dialog"`、`aria-modal`、焦点进入 / 恢复、Tab 约束、Escape 和背景滚动。
- 有未保存内容的页面统一拦截侧栏导航、刷新和关闭；危险操作与主操作区分，并提供确认或可恢复机制。
- 长列表使用分页、增量渲染、虚拟化或 `content-visibility`。筛选、排序、分页和当前选择等可恢复状态优先写入 URL。
- 大页面按页面编排、controller hook、业务组件和纯函数拆分；不为拆行数或套用模式引入无语义组件、第二套组件系统或状态库。仅在真实共享状态需求下增加 Context / Provider。
- React / Next.js 工作按需参考 `vercel-react-best-practices`；重构组件接口时参考 `vercel-composition-patterns`，只读相关规则，核对已安装版本与服务端 / 客户端边界。
- 优化以测得的瓶颈为依据，请求去重和缓存沿用现有客户端机制。

## 验证

按改动风险选择下表适用项，不要求逐项执行。必要检查通过且请求已完成即停止；只有新改动、失败或未解决的具体风险才扩大或重跑检查，不因技能交付流程重复已通过且仍覆盖当前改动的检查。

| 改动范围 | 适用检查 |
| --- | --- |
| 纯文档 | `git diff --check`，人工审查 diff。 |
| 代码逻辑 | 目标测试、受影响文件的 lint；底层或跨域改动补 `npm test`，全局规则或广泛改动运行 `npm run lint`。 |
| TypeScript 类型、接口或模块依赖 | `npm run typecheck`。 |
| 存储结构、删除或引用联动 | `npm run check:library`；未经授权不运行 repair。 |
| 路由结构、SSR、middleware、运行时配置、跨页面行为或打包 | 按受影响目标构建：本地 Next.js 运行 `npm run build`；Sites 运行 `npm run check:sites`、`npm run build:sites`、`npm run check:sites:release`；共享改动影响两端时覆盖两端。遵守构建隔离规则。 |
| 路由内部局部逻辑 | 目标测试及适用的类型检查；有构建风险时再补构建。 |
| 前端交互 | 最小浏览器 smoke test。 |

会写入业务数据的自动化测试和浏览器验证必须使用隔离资料库，并确认被测服务实际采用该配置。测试使用临时 `STYLE_LIBRARY_DIR`；本地工作台 smoke test 可复用 `npm run dev:sandbox`（启动参数见 `scripts/dev-sandbox.mjs`）。

修复本次改动引入的问题并复验受影响范围；无关既有失败如实报告，不扩展修复范围。交付时说明改动、实际执行的检查及未验证项，不以推测或 Agent 自报代替验证证据。最终审查 diff，确认没有误改用户资产或无关工作树内容，也没有隐藏真实失败。

只有稳定、跨模块且难以从源码推断的高风险规则才更新本文件。具体配置、命令、布局和实现细节以 `README.md`、`PRODUCT.md`、`DESIGN.md`、`package.json`、相关源码与测试为准。
