# AGENTS.md

## 适用范围与规则级别

本文件是仓库根目录的全局 Agent 指南；子目录若有更近的 `AGENTS.md`，以更近者为准。

项目是本地内容运营工作台，核心数据位于 `STYLE_LIBRARY_DIR` 或 `./style-library`。账号、项目、转写稿、草稿、评论 / 弹幕、封面和毛利数据都可能是不可重建的用户资产。

- **MUST**：数据安全、兼容性和交付边界，必须遵守。
- **SHOULD**：默认工程方式；有充分理由可以调整，但要说明影响并验证。
- **REFERENCE**：产品与实现背景，以对应文档和源码为准，不在本文件复制易变细节。

## 沟通

- 默认中文回复，称用户为“老大！”，保持短、准、可执行；少量口语和 emoji 可以，但不影响专业判断。
- 解释复杂架构、排障或验证结果后，追加一小段 `白话版：`。
- 先给结论和风险，再说明方案；不要把格式偏好写进正式文档、代码注释、错误信息或提交信息。

## 接手与上下文

开始任务先运行：

```bash
git status --short
rg --files
```

### MUST

- 工作树经常包含用户或其他 Agent 的未提交改动。不得回滚、覆盖、重排或格式化无关改动；必须触碰已有改动文件时，先读 diff 再叠加。
- 只读取当前任务需要的上下文，不要机械展开整个目录或固定通读大型聚合文件。

### SHOULD：按任务路由读取

- 产品与运行：`README.md`、`PRODUCT.md`、`.env.example`。
- UI 与交互：`DESIGN.md`、目标页面 / 组件 / hook、对应 CSS 和 `src/app/styles/00-tokens.css`。
- API：目标 `route.ts`、`src/lib/api-route.ts`、相关类型和 `src/lib/client.ts` 中对应片段。
- 存储：目标存储函数、`src/lib/storage/core.ts`、`fs.ts`、`schemas.ts`，必要时再读 `src/lib/storage.ts` 对应片段。
- 任务 / 流式：`src/lib/jobs.ts`、`src/lib/job-sync.ts`、`src/lib/streaming.ts` 及目标调用链。
- 打包 / 远程：目标 `scripts/*.mjs`、README 对应章节和相关环境变量。

用 `rg` 精确定位后读片段。中等以上改动先明确根因、影响文件、热修或结构修、方案和验证。

## MUST：数据与文件安全

- `style.md`、转写稿、草稿、`*.assets`、互动历史和毛利数据是用户资产；未经明确授权不得删除、迁移、批量重写、重新生成或打包外发。
- 删除账号、视频、项目、素材或草稿必须走现有可恢复删除 / 事务机制，并保持跨引用同步；不得绕过锁、直接递归删除业务目录。
- JSON、文本和二进制写入复用 `writeJsonFile`、`writeTextFileAtomic`、`writeFileAtomic` 或现有事务封装，保持临时文件 + `rename` 的原子落盘。
- 所有路径段经过 `normalizeStorageSegment` 或现有 normalize 函数；不得把 URL、标题或用户输入直接拼进路径。
- 持久化记录保留 `schemaVersion`，读取经过 `src/lib/storage/schemas.ts` 运行时校验。缺失文件可返回空状态；损坏 JSON、路径越界和写入失败必须显式报错。
- 转写覆盖与恢复必须使用 per-video 串行锁和 revision 校验，并保留 `transcripts/.history/<video-id>/` 历史；冲突返回 409，不得覆盖并发编辑。
- 草稿资产更新走 `updateDraftAssets()` / `withDraftAssetsLock()`；watchlist、身份映射和其他共享文件复用已有串行锁。
- `npm run check:library:repair` 只在用户明确同意后对真实素材库执行；修复前必须备份，不能自动处理无法安全推导的问题。
- 默认发行包不得包含完整 `style-library`。只有用户明确要求时使用 `--include-library`；毛利包只允许携带毛利数据源，缺失时默认失败。

## MUST：错误、外部能力与并发

- 涉及 `opencli`、`ffmpeg`、火山、模型、图片模型、飞书、企业微信或本地文件时，错误必须是可见、可操作的中文信息；不得新增吞掉业务失败的空 catch、假成功或无关模板兜底。仅忽略可选解析 / 清理失败时要用注释说明边界。
- fallback 必须显式返回或持久化 `fallback`、`fallbackReason` 等状态。模型失败应失败，不得用通用本地文案覆盖当前结果。
- OpenCLI 执行复用 `src/lib/opencli-runtime.ts`，使用 `execFile` 和参数数组，传递 timeout / `AbortSignal`；不得用 shell 字符串拼接用户输入。
- 对话模型与备用节点复用 `src/lib/model-runtime.ts` 的统一配置链。联网检索只发送到明确支持 Responses `web_search` 的节点，不得发给普通 Chat Completions。
- 支持文档复用 `src/lib/support-documents.ts`：飞书走 Lark CLI，企业微信走官方 `wecom-cli doc`，其他来源沿用现有适配器；正文读取失败必须显式失败。
- 长任务接入 `src/lib/jobs.ts` 和任务中心，保留进度、取消、重启中断恢复和持久化。终态前分批落盘时同步递增 `dataRevision` 并写明 `dataChange`。
- 将“客户端缓存失效”和“立即重新请求”分开；页面不消费某资源时只失效缓存，避免后台任务触发无关全量读取。

## MUST：API 与客户端契约

- 涉及文件系统、环境变量、外部 CLI 或模型的路由使用 Node.js runtime。
- API 路由优先复用 `apiJson()`、`apiError()`、`parseJsonBody()` 和 `zod` schema，保持 400 校验错误与中文提示。
- NDJSON 复用 `createNdjsonStream()` / `readNdjsonStream()`，保持 `stage`、`delta`、`result`、`error`、`done` 语义，并传递请求取消信号。
- 列表 API 只返回摘要类型；正文、research、评论、弹幕和资产等重字段按 ID 懒加载。
- 新增或修改前端可见 API 时，同步类型、`src/lib/client.ts` 对应客户端函数、缓存失效、页面状态和错误展示。
- 不引入第二套存储、校验、任务、请求缓存或 fallback 系统；先扩展已有抽象。

## MUST：运行模式与交付

- `APP_MODE=workspace`：完整工作台，根路径默认进入 `/douyin-hotlist`。
- `APP_MODE=gross-margin`：只开放 `/gross-margin`、`/gross-margin/monitor` 及必要 API；`middleware.ts`、`AppModeGuard`、`AppNav` 和任务类型限制必须一致。
- `APP_START_PATH` 影响交付包启动页；调整模式或启动页时同步检查 README、`.env.example` 和 `scripts/package-release.mjs`。
- 开发服务运行时不要直接在同一 `.next` 上执行 `npm run build`。需要构建时先确认并停服，或使用发布脚本的隔离临时目录。
- 默认开发服务使用 Turbopack；预热属于可测量的性能实现，不是不可变产品规则。修改时用冷启动 / 路由切换数据验证。

## SHOULD：稳定业务不变量

- 视频热榜账号与视频保存在独立的 `style-library/douyin-hotlist/accounts`，不要写入主账号库；刷新继续使用后台任务和 watchlist 锁。
- 账号库的 B站统计继续通过 `/api/videos/hydrate` 二次补全；修改视频列表或详情时不得绕过该链路。
- 批量转写先筛选待转写项再应用数量上限；重新转写失败时已有稿保持可用。
- 写作台多选风格卡时，每张卡并发生成一篇互不混合的独立草稿；单篇草稿只保存自身风格引用，续改沿用该稿风格。首稿、续改和手动编辑保持不可变版本链；`originalSourceInput` 保存写作台素材输入框原貌，历史恢复优先使用它，模型仍使用已解析的 `input` / `sourceDigest`。
- 续改复用父稿已保存资料和该稿对应的风格卡，不重复转写链接、抓支持文档或联网。
- 评论 / 弹幕输入包含支持的视频链接时必须先取得视频文稿；链接标识只用于采集追踪，不进入 Brief 或最终文案。真实平台样本缺失时显式失败，部分成功结果按现有有界机制自动补齐。
- `getLibraryOverview()` 保持轻量，不重新塞入全文转写、素材正文、完整草稿或资产列表。
- 毛利在线账号表普通读取优先返回最后成功缓存并后台刷新；远端解析失败时只允许显式可见的缓存回退，不覆盖可用账号数据。

## SHOULD：前端

- `DESIGN.md` 是视觉单一来源；复用 token、primitives、`16-workbench-system.css` 和既有工作台组件，不创建第二套按钮、卡片、状态或动效系统。
- 根级全局 CSS 只承载 token、基础样式、通用 primitives 和 shell；路由专属布局与响应式样式尽量与页面 / layout 共置，避免所有页面加载全部业务 CSS。
- 使用 `lucide-react`；纯图标按钮提供 `aria-label`，表单有可见 label，异步状态有 `aria-live` / `aria-busy`，键盘焦点清晰，动效尊重 `prefers-reduced-motion`。
- 弹窗统一处理 `role="dialog"`、`aria-modal`、焦点进入 / 恢复、Tab 约束、Escape 和背景滚动。
- 有未保存内容的页面统一拦截侧栏导航、刷新和关闭；危险操作与主操作区分，并提供确认或可恢复机制。
- 长列表使用分页、增量渲染、虚拟化或 `content-visibility`。筛选、排序、分页和当前选择等可恢复状态优先写入 URL。
- 大页面按“页面编排 + controller hook + 业务组件 + 纯函数”拆分；不要仅为拆行数创建无语义组件，也不要为当前本地工作台盲目引入 Redux / Zustand / React Query。

## 验证

按影响面从小到大执行：

1. 目标测试；底层或跨域改动补 `npm test`。
2. `npm run lint`。
3. `npm run typecheck`。
4. 存储结构、删除或引用联动改动补 `npm run check:library`；未经授权不运行 repair。
5. 路由、SSR、middleware、Next 配置、跨页面行为或打包改动补 `npm run build`，但先处理正在运行的开发服务。
6. 前端交互改动做最小浏览器 smoke test；涉及真实素材写入时使用临时 `STYLE_LIBRARY_DIR`。

纯文档改动通常执行 `git diff --check` 并人工审查 diff。最终确认没有误改用户资产或无关工作树内容，也没有隐藏真实失败。

## REFERENCE：信息来源

- 产品、启动、环境变量和交付方式：`README.md`、`.env.example`、`PRODUCT.md`。
- 视觉与交互：`DESIGN.md`。
- 页面和 API：以 `src/app/**` 当前源码为准。
- 存储、任务、模型和外部能力：以相关 `src/lib/**` 当前源码与测试为准。
- 命令：以 `package.json` scripts 为准。

只有稳定、跨模块且难以从源码推断的高风险规则才更新本文件。具体默认值、并发数、提示词策略、页面布局像素和临时实现细节应放在源码、测试、README 或 DESIGN 中。
