# 账号风格库本地网页

本地使用的账号风格库工作台，用于把 B站 / 抖音账号的爆款内容采集、转写、沉淀成可编辑风格卡，并在写作台里参考账号风格生成文案。

## 规划文档

- [手机远程工作台设计](./MOBILE_REMOTE_DESIGN.md)：通过 Tailscale 从 iPhone 远程访问本机工作台；第一版手机外壳、状态检测和发布脚本已实现。
- [任务中心 API](./docs/api/jobs.md)：后台任务的创建、增量轮询、详情、停止与重试。

## 启动

```bash
npm install
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000`，默认进入视频热榜页 `/douyin-hotlist`（历史路径保留）。开发服务默认使用 Turbopack，侧栏仅在鼠标停留或键盘聚焦目标模块时预热该页面，不再自动遍历全站和业务 API；离开目标或点击导航时取消预热，让真实导航优先。开发模式首次访问未编译模块仍可能需要等待编译。

如果希望服务退出终端后仍然保持运行，可以使用后台启动：

```bash
npm run dev:daemon
npm run dev:status
npm run dev:restart
npm run dev:stop
```

后台日志写入 `.dev-server/next-dev.log`，该目录不会提交到 git。

已配置 `capability:setup` 的 Mac 使用 `dev:daemon` / `dev:restart` 时，会从同一钥匙串加载桥接令牌，并随开发服务启动窄网关。Sites 可通过原有桥接地址调用 3000 开发版；停止开发服务时网关一并退出。直接执行 `npm run dev` 仍只启动 Next.js，不启动桥接。令牌不会写入日志或配置文件。

Sites 设置 `SITES_WORKSPACE_SOURCE=local` 后，业务 API 通过上述桥接读取和操作本机同一份资料库，包括账号、项目、草稿、素材及任务。修改沿用本机接口的锁、版本校验和可恢复删除；不会复制或合并已有云端数据。Mac 和开发服务必须在线，断线时页面显示错误，不回退到空的云端库。公开站点的访客拥有这些业务操作权限。单次上传仍受桥接正文大小配置限制。

## 运行指标与模型评测

任务中心现在会通过 Pino 输出结构化运行日志。每次任务阶段切换会记录任务类型、阶段、平台、排队耗时、阶段耗时、模型、缓存、fallback 和失败信息，但不会记录原文、文案正文或密钥。日志级别可通过 `PINO_LOG_LEVEL` 调整，默认是 `info`。

查看已持久化任务的汇总指标：

```bash
npm run metrics:pipeline
npm run metrics:pipeline -- --json
```

评测写作链路需要先启动本地工作台，并指定一个已经有风格卡的账号目录名；评测使用 `save: false`，不会创建草稿：

```bash
PROMPTFOO_STYLE_PLATFORM=bilibili \
PROMPTFOO_STYLE_ACCOUNT_ID='已有风格卡的账号目录名' \
npm run eval:writer -- --max-concurrency 1 --no-write
```

评测样本位于 `evals/`，只应放脱敏、可复用的固定样本。Promptfoo 默认只在本地运行；不要把素材评测结果上传到 Promptfoo Cloud。修改提示词、模型或上下文组装后，先用同一批样本运行评测，再结合 `npm run metrics:pipeline` 观察真实任务的成功率和耗时。

## iPhone 私人远程访问

Mac 和 iPhone 安装 Tailscale、登录同一个私人账号后，在项目目录执行：

```bash
npm run remote:setup
npm run remote:deploy
npm run remote:status
```

`remote:setup` 配置 Tailscale Serve 和 macOS LaunchAgent；Next.js 仍只监听
`127.0.0.1:3000`，完整工作台不会开放公网。正式服务通过
`caffeinate` 在 Mac 插电、开盖时保持运行。然后在 iPhone 的 Tailscale 中找到该
Mac 的私人 HTTPS 地址，用 Safari 打开并“添加到主屏幕”。

常驻服务按 Next.js 生产环境优先级读取项目根目录的 `.env.production.local`、
`.env.local`、`.env.production`、`.env`（进程已有环境变量优先），支持 `$变量名` 引用。
修改模型或联网检索配置后，执行 `npm run remote:start` 重启当前正式版本即可生效。

日常命令：

```bash
npm run remote:start      # 启动当前正式版本
npm run remote:stop       # 停止正式服务
npm run remote:status     # 查看 Next / Tailscale / 版本状态
npm run remote:dev        # 切回开发服务
npm run remote:deploy     # 检查、临时构建、发布并健康检查
npm run remote:rollback   # 回退上一可用版本
```

发布前若存在运行或排队任务会直接拒绝。正式产物保存在
`.remote-server/releases/<buildId>`，保留最近两个版本；启动失败会自动恢复上一版。
正式服务始终读取当前项目的真实 `style-library`，不会创建第二份可写数据。

如果 Sites 云端需要调用当前 Mac 的 OpenCLI、FFmpeg、转写、飞书或企业微信能力，额外执行：

```bash
npm run capability:setup
npm run remote:deploy
npm run capability:status
```

`capability:setup` 会在 macOS 钥匙串生成独立强令牌，并用 Tailscale Funnel 的
`8443` 端口只公开一个窄网关；它只接受 `/api/capability-bridge` 和带一次性下载凭证的
素材路径，其他页面与 API 一律返回 404。完整工作台仍只通过私人 Serve 访问。
如果当前 Tailscale 账号尚未允许 Funnel，命令会明确停止并要求在 Tailscale 管理页完成一次授权，
不会自动扩大公网范围。令牌不会写入 `.env`、源码或日志。

如果要把“数据维护”和“数据监控”单独交付给 Windows 用户，使用专用发行模式：

```bash
npm run package:release -- --preset gross-margin-win
```

这个专用包不是单文件 `exe`，而是 Windows 便携包：解压后先运行一次 `setup-browser-bridge.cmd` 安装/启用 OpenCLI 浏览器扩展，再双击 `start.cmd`，浏览器默认打开 `/gross-margin`，并且只保留“数据维护”和“数据监控”两页；其他工作台页面在专用模式下会被自动拦回毛利模块。专用包会内置 `opencli` 主程序，目标 Windows 机器不需要再单独安装全局 opencli；B站 / 抖音实时刷新仍需要 Chrome / Edge 里的 OpenCLI Browser Bridge 扩展连通。

开发服务器运行时不要同时执行 `npm run build`，Next.js 会复用 `.next` 目录，可能让开发页的 CSS/JS 静态资源短暂 404。若页面看起来像样式丢失，执行：

```bash
rm -rf .next
npm run dev
```

## 网页 AI 模型配置

工作台侧栏或手机「更多」中的 **AI 模型配置**（`/ai-settings`）可按业务环节设置模型和推理等级，支持搜索、批量调整、撤销及恢复默认。修改后点击「保存更改」，新开始的模型调用读取最新设置，无需重启；已经发出的请求继续执行。

配置保存在 `STYLE_LIBRARY_DIR/settings/ai-models.json`，带 schemaVersion、revision 与原子写入。多页面同时编辑时，过期版本返回 409 并保留当前编辑，需重新载入后合并。恢复默认也需保存；模型名留空沿用对应节点（图片生成沿用工作台所选图片配置）。模型必须由该环节现有后端支持，联网检索仍使用独立 Responses 节点。

此页不编辑 API 密钥、服务地址或凭证，继续使用环境变量中的已有节点。图片没有对话推理等级，尺寸与质量仍由图片工作台控制；火山 ASR 仅展示服务信息。风格学习与评论调研的缓存标识包含相关模型配置，配置变化后不会误用旧配置的调研／学习缓存。毛利模式不开放此页及其 API。

界面布局参考 [shadcn/ui](https://ui.shadcn.com/)，沿用本项目的视觉 token、按钮和表单控件。

## 配置

- `OPENCLI_BIN`：默认使用 `opencli`，用于 B站 / 抖音采集。
- `OPENCLI_BROWSER_CONNECT_TIMEOUT`：opencli 等待 Browser Bridge 连接的秒数，Windows 专用包默认 `8`，避免扩展未连接时每条刷新长时间卡住。
- `OPENCLI_WINDOW`：opencli 浏览器窗口模式，Windows 专用包默认 `background`，减少刷新时反复弹出浏览器窗口。
- `OPENCLI_BROWSER_SESSION`：手动浏览器采集统一复用的后台会话名，默认 `content-workbench-browser`；不要为每次任务生成新名称，否则 Chrome 会累积多个 “OpenCLI Browser” 分组。
- `OPENCLI_PROFILE`：可选。多个 Chrome profile 同时连接 Browser Bridge 时，用 `opencli profile list` 中的别名或 contextId 固定到一个 profile。
- `GROSS_MARGIN_MONITOR_REFRESH_CONCURRENCY`：数据监控刷新并发数，默认 `6`，允许 `1-6`；B站优先并发读取公开统计接口，仅在公开接口失败时进入 OpenCLI 兜底。
- `FFMPEG_BIN`：默认使用 `ffmpeg`，抖音和无字幕 B站回退转写时会先抽取音频。
- `STYLE_LIBRARY_DIR`：本地风格库目录，默认 `./style-library`。
- `NEXT_PUBLIC_STIRLING_PDF_URL`：工具台里的 Stirling-PDF 地址，默认 `http://localhost:8080`。本地 Docker 可直接使用；地址只用于打开自托管 Web UI，PDF 文件不会经过本项目转发。
- `SITES_STORAGE_MODE`：Sites 云端运行时由构建配置设为 `cloud`；本地文件模式留空。
- `SITES_EXTERNAL_CAPABILITY_URL`、`SITES_EXTERNAL_CAPABILITY_TOKEN`：可选的受鉴权 HTTP 能力桥。云端 OpenCLI、FFmpeg 抽帧、ASR/链接转写、媒体下载、飞书和企业微信文档调用会以 `{ operation, payload }` POST 到该地址；令牌只放在部署环境变量中，不要提交到仓库。
- `SITES_CAPABILITY_BRIDGE_TOKEN`、`SITES_CAPABILITY_BRIDGE_PUBLIC_URL`：能力提供方主机使用。将本地工作台通过受保护的 HTTPS 反向代理暴露到 `/api/capability-bridge`，令牌至少 32 个字符；Sites 端的 `SITES_EXTERNAL_CAPABILITY_*` 使用同一地址和令牌。该入口在 Sites Worker 内会强制关闭，媒体文件通过短期、一次性下载凭证传输，不会返回本机路径。
- 当前 Mac 常驻模式会从 macOS 钥匙串读取能力桥令牌，并把 `SITES_CAPABILITY_BRIDGE_PUBLIC_URL` 指向独立的 Tailscale Funnel `8443` 窄网关；不要把令牌复制进仓库或聊天。
- `SITES_CAPABILITY_BRIDGE_TIMEOUT_MS`、`SITES_CAPABILITY_BRIDGE_BODY_LIMIT_BYTES`、`SITES_CAPABILITY_BRIDGE_ASSET_TTL_MS`：能力提供方的单次执行超时、JSON 请求上限和临时媒体有效期；默认分别为 20 分钟、2MB 和 10 分钟。
- 云端健康检查会使用 Bearer 令牌 GET capability URL，并核对服务实际声明的操作列表；仅填写地址和令牌但服务不可达、鉴权失败或缺少操作时，状态页会显示真实故障，不会标记为已配置。
- `npm run prepare:sites:migration`：安全的 Sites 数据迁移预检，默认不读取素材库。只有明确授权后附加 `-- --include-library` 才会在本地 `dist/` 生成哈希清单；该命令本身永不上传素材。
- `WECOM_ACCOUNT_SHEET_URL`：可选。配置企业微信在线表格链接后，数据维护里的抖音 / B站账号配对和报价以在线表为准，通过 `wecom-cli` 读取。普通打开会立即展示最后一次成功缓存并在后台刷新，不再等待远端；手动点击刷新才会等待最新结果。在线表暂时不可用时继续显示上次成功缓存或本地缓存，并给出可见警告。
- `WECOM_CLI_BIN`、`WECOM_ACCOUNT_SHEET_CACHE_TTL_MS`、`WECOM_ACCOUNT_SHEET_FALLBACK_LOCAL`：在线账号表读取命令、缓存时长和本地回退开关。
- `JOB_MAX_ACTIVE`：后台任务最大同时运行数，默认 `5`，允许 `1-6`；多任务会先排队再执行。
- `JOB_HISTORY_LIMIT`：任务历史保留条数，默认 `200`，允许 `50-1000`，超出后自动清理更早的已结束任务。
- `JOB_HISTORY_MAX_MB`：任务历史磁盘预算，默认 `20MB`，允许 `5-500MB`；和条数上限任一先到即清理更早的已结束任务。
- `JOB_RESULT_PERSIST_KB`：已结束任务结果的单条持久化上限，默认 `96KB`，允许 `16-1024KB`；超限时仅压缩磁盘历史，当前运行中的页面结果不受影响。
- `VOLCENGINE_ASR_API_KEY`：火山引擎录音文件识别 2.0 API Key。
- `VOLCENGINE_ASR_RESOURCE_ID`：火山引擎转写资源 ID，默认 `volc.seedasr.auc`。
- `VOLCENGINE_ASR_POLL_INTERVAL_MS`：火山转写查询间隔，默认 `1000` 毫秒。
- `VOLCENGINE_ASR_MAX_POLL_ATTEMPTS`：火山转写最大轮询次数，默认 `120`。
- `VOLCENGINE_ASR_REQUEST_TIMEOUT_MS`：火山转写单次请求超时，默认 `30000` 毫秒。
- `VOLCENGINE_ASR_RETRY_COUNT`：火山转写遇到瞬时网络错误时的重试次数，默认 `2`，建议保持在 `0-3`。
- `DOUYIN_TRANSCRIBE_CONCURRENCY`：抖音批量转写并发数，默认 `3`，建议保持在 `1-4`。
- `DOUYIN_HOTLIST_REFRESH_CONCURRENCY`：视频热榜账号刷新并发数，默认 `2`，允许 `1-5`；抖音使用共享会话内的有界并发，每六个账号返回后保存结果并更新进度，分页间隔 `250ms`。变量名沿用旧版抖音热榜配置。
- `CHAT_API_KEY`、`CHAT_BASE_URL`、`CHAT_RESPONSES_URL`、`CHAT_COMPLETIONS_URL`、`CHAT_MODEL`、`CHAT_WIRE_API`、`CHAT_REASONING_EFFORT`、`CHAT_SERVICE_TIER`：主对话模型配置，用于自动提炼风格和生成文案。新中转站如果只兼容 OpenAI Chat Completions，可设 `CHAT_WIRE_API=chat_completions`；不确定时可设 `CHAT_WIRE_API=auto`，系统会在 Responses 不兼容时自动切到 Chat Completions。`CHAT_SERVICE_TIER=priority` 可显式请求中转站 / Codex 的快速服务层，和 `xhigh` 推理档位是两件事。`CHAT_BASE_URL` 可以填中转站根地址，也可以用 `CHAT_RESPONSES_URL` / `CHAT_COMPLETIONS_URL` 指定完整接口地址。`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 也会作为主模型配置读取。
- `CHAT_FALLBACK_API_KEY`、`CHAT_FALLBACK_BASE_URL`、`CHAT_FALLBACK_RESPONSES_URL`、`CHAT_FALLBACK_COMPLETIONS_URL`、`CHAT_FALLBACK_MODEL`、`CHAT_FALLBACK_WIRE_API`、`CHAT_FALLBACK_REASONING_EFFORT`、`CHAT_FALLBACK_SERVICE_TIER`、`CHAT_FALLBACK_PROXY_URL`、`CHAT_FALLBACK_ENABLED`：第一备用对话模型配置。默认备用地址和模型是旧配置 `https://www.fhl.mom` / `gpt-5.5` / `responses` / `xhigh`，但必须单独填写 `CHAT_FALLBACK_API_KEY` 或 `FHL_API_KEY` 才会启用，避免把主模型 key 发到旧中转站。还可按相同后缀配置 `CHAT_FALLBACK_2_*` 至 `CHAT_FALLBACK_5_*`，系统会依次尝试。
- `CHAT_PROXY_URL`：可选。若 Node/Next 直连模型服务失败，可设为本机代理，例如 `http://127.0.0.1:7890`。
- 本机模型请求按代理地址复用连接池，空闲连接默认保留 30 秒（服务端 keep-alive 提示优先），最多保留 8 个代理池；淘汰时等待在途请求结束。直连继续使用 Undici 默认连接池，云端继续使用原生 fetch。此优化减少重复建连，不改变模型、推理强度或重试策略。
- `CHAT_HEALTH_PROBE_TIMEOUT_MS`：对话模型健康检查探针超时，默认 `8000` 毫秒，允许 `2000-30000`。
- `WEB_RESEARCH_ENABLED`、`WEB_RESEARCH_API_KEY`、`WEB_RESEARCH_BASE_URL`、`WEB_RESEARCH_RESPONSES_URL`、`WEB_RESEARCH_MODEL`、`WEB_RESEARCH_REASONING_EFFORT`、`WEB_RESEARCH_SERVICE_TIER`、`WEB_RESEARCH_PROXY_URL`：写作台联网检索的独立 Responses API 配置，推理档位默认 `medium`。它只负责 `web_search`，不会改变现有 Chat Completions 写作链；未配置独立接口时，系统仍可使用对话模型链里明确支持 Responses 的节点。密钥不会自动跨服务复用，如确实是同一服务，可在本地环境文件写 `WEB_RESEARCH_API_KEY=$CHAT_API_KEY`。
- `STYLE_SAMPLE_ANALYSIS_CONCURRENCY`：完整原文逐篇分析并发数，默认 `2`，范围 `1-6`。账号与项目学习统一先缓存用途、具体表达动作及已核验原句，再归纳风格卡；缓存键包含原文、提示词版本与模型配置。旧的 `STYLE_ONE_SHOT_MAX_INPUT_CHARS` 不再生效。日常写稿只读取已有风格与原文，不补跑逐篇分析；学习仅在更新风格任务中执行。
- `ENGAGEMENT_MODEL_CONCURRENCY`：评论生成并发批次数，默认 `4`，建议保持在 `1-4` 之间；中转站限流或超时时可先调回 `1`。
- `ENGAGEMENT_COMMENT_CANDIDATE_RATIO`：评论首轮超采样倍率，默认 `1.4`，允许 `1.05-1.5`；模型会多写一批候选，再按长度、重复结构和事实约束筛到目标数量。
- `IMAGE_API_KEY`、`IMAGE_BASE_URL`、`IMAGE_MODEL`、`IMAGE_SIZE`、`IMAGE_QUALITY`、`IMAGE_FORMAT`、`IMAGE_PROXY_URL`：可选。用于生图工作台和草稿封面。接口兼容 OpenAI Images API；`IMAGE_BASE_URL` 应包含 `/v1`，`IMAGE_MODEL` 填服务商提供的准确模型标识。封面默认使用 `gpt-image-2` / `2048x1152`；独立工作台按页面选择的尺寸和质量生成。
- `FEISHU_OPENCLI_AS`、`FEISHU_FOLDER_TOKEN`：可选。飞书文档发布固定使用 `opencli lark-cli docs +create`，默认使用当前 lark-cli 用户身份。

风格学习、写作、评论和弹幕生成依赖可用的对话模型；调用失败不会静默切到与资料无关的本地模板。风格样本分析沿用现有节点及协议配置，使用流式接口（Responses / Chat Completions），避免非流式长等待触发网关超时；完整收到正常结束标记且通过原文证据校验后才保存缓存，断流内容不作为成功结果。风格样本分析遇到连接中断、超时、限流或服务端异常时，每个已配置节点最多自动重试一次，等待期间可取消；鉴权、额度和接口配置错误不在同一节点重复请求。任务进度显示重试状态，失败提示标明样本和安全的传输错误码。已完成分析保留缓存，重试复用。业务模型请求默认不设置固定 token 输出上限，包括风格分析与归纳、写作与续改、联网检索、评论与弹幕、发布文案、图片提示词及视觉读取；仍受上游模型容量和服务默认值约束。底层保留调用方显式指定预算的能力，健康探针保留小预算。用户指定的字数、评论数量、平台格式、输入容量、超时和取消机制保持有效。风格分析或引用校验失败时保留原卡；更新卡片前将旧版归档到对应账号／项目的 `.style-history/`。账号风格编辑器的“重新归纳”会跳过最终卡缓存，仍复用未变化的逐篇分析。

风格学习提示词统一维护在 `src/lib/writer-prompts.ts`。逐篇分析从完整原作提取观察视角、信息安排、句间衔接、节奏及表达效果；风格卡再比较多篇作品，区分共同倾向、场景变化与单篇例子。卡片按“后续写手不再同时获得完整原作”的用途编写，用少量可定位的连续引句说明具体讲法，不套固定目录、开场公式或通用禁忌清单。程序校验分析结构、引句及其位置，风格判断是否贴切仍需人工或真实试稿评价。账号与项目归纳只使用本轮原文证据，不输入旧卡全文；用户明确保存的偏好独立保留，其他人工内容仍可从风格历史对照。逐篇分析与最终归纳使用独立版本，只有归纳版本改变时会复用有效分析。分析版本改变后，下次主动更新风格会重新分析原作，可能增加耗时和模型调用；不会自动重建已有卡，旧稿续改仍保留原快照。

账号库位于 `/library`，支持按平台、转写和风格状态筛选账号，并按标题、转写状态及数据指标筛选排序视频；筛选条件和当前选择会写入 URL，刷新后可恢复。批量模式可对当前筛选结果选择、转写或导出。手动保存、重新转写和历史恢复都使用 revision 冲突保护；覆盖前的旧稿归档到账号目录的 `transcripts/.history/<video-id>/`，可在转写稿编辑器中查看并恢复。

对话写作页位于 `/writer`。参考风格支持同时选择多个账号或项目；多选后会按每张风格卡并发生成一篇互不混合的独立文案，并分别保存为草稿，可在结果区直接切换。单篇草稿只保存自身使用的风格引用，后续模型续改和手动编辑都会沿用该稿风格并保存为同一写作会话下的新版本，不会覆盖上一版；历史列表只加载标题、版本和时间，点开后才读取草稿全文。旧草稿继续兼容读取。素材、原文、抖音 / B站视频链接和支持文档共用一个输入框：视频链接自动转写，飞书、网易灵犀、企业微信、腾讯文档及普通公开网页链接自动读取正文；同一支持文档成功读取后会缓存 24 小时，并发生成时只读取一次共享资料，读取失败不会缓存；链接未公开或当前工具身份无权限时会明确报错，不会把裸链接交给模型猜。默认首稿只读取所选风格卡（含用户保存偏好）、本次要求与素材、实际提供的支持资料，不再自动读取、匹配或附带博主原作。公共提示只说明要求优先级、事实依据和输出形式，不追加修辞规则或编辑检查。随后一次生成全文，明确字数和禁用词未通过时保留稿件，并在“参考资料”中显示检查提醒。新稿保存当时的风格正文、任务约束与内容指纹，原作参考数组为空；续改沿用这份快照，不重新转写、抓文档、联网或选样。续改支持“按要求微调”与“重新校准风格”，选中段落时两种方式均只调整选中范围；普通续改不附带原作，明确校准时可使用旧稿快照中已有的原作，不重新采集或选样。旧稿缺少快照会明确说明使用当前关联卡，并从该版开始保存快照。续改以本轮指令为准，不机械套用首稿的字数检查。联网检索开关位于生成按钮旁，使用独立 `WEB_RESEARCH_*` Responses API，和现有 Chat Completions 写作接口互不影响；没有独立配置且对话模型链里也没有 Responses 节点时，入口才会置灰。选中稿件段落后可以只改局部，但模型仍会返回并保存完整新稿。

联网检索提示词位于 `src/lib/writer-prompts.ts` 的 `writerWebResearchInstruction()`，同时接收本次要求、素材与支持文档。按问题复杂度整理具体资料与来源，不预设条数、字数或搜索轮数；关键资料不足时补搜，资料充分或结果重复时停止，用户明确要求的范围优先。写作检索的原生请求和一次连接故障重试共用 90 秒预算，失败后转入最多 60 秒的 OpenCLI 备用搜索；重试和切换会显示进度。独立严格检索调用仍沿用原有 180 秒预算。成功的写作检索结果在 `.cache/writer-research` 持久化缓存 30 分钟，相同要求、素材、已读取支持文档和检索配置可跨次生成复用；仅换风格卡不重新检索。同一进程内相同检索并发请求合并，命中与等待会显示进度。输入、检索提示词或节点/模型配置改变以及缓存过期时重新检索；失败或取消不缓存，备用搜索成功结果保留原生失败说明。旧稿续改继续复用已保存资料。

写作素材支持点选或拖入 TXT、Markdown、CSV、JSON、HTML、字幕、DOCX 和 PDF 文件；PDF 会提取其中的文字层，扫描件请先进行 OCR。本地文件正文中的链接会保留为正文，不会误触发视频转写或支持文档抓取。

评论生成页位于 `/assets`，可基于已保存草稿、粘贴文案或 B站 / 抖音视频链接生成观众评论；历史区只读取标题、来源和数量，点开记录后才加载评论、弹幕和来源全文。粘贴文案必须选择目标平台，视频链接会自动识别。评论和弹幕使用对话模型；输入中只要包含支持的视频链接（包括带标题、口令的整段分享文案），就必须先沿用现有视频转写链路取得文稿，不能把分享文案直接当正文生成。链接、域名、短链码、视频 ID 和平台分享指令只用于采集与追踪，进入正文锚点和模型提示词前会被剥离，模型输出中再次出现也会被过滤。评论默认生成 `50` 条，采用“正文理解与精准规划 → 目标平台采样 → 语料审查 → AI 创作”的链路。理解和规划合并为一次模型请求，最多使用两个精准检索词，只采目标平台，每词最多两个视频，每视频最多 12 条评论，同一视频不重复采集。评论区先进行视频级反灌水检查，再逐条检查自然表达与当前正文语境，保留项必须返回判断理由及正文原句依据；不能因来源标题相关而放行只聊来源博主、演员身份、私人关系或缺失画面语境的评论。筛选不会在数量凑够后提前结束，时间预算耗尽或部分失败时明确记录已审、未审与拒绝数量，未审评论不进入参考。结果页可展开搜索依据、逐条判断及来源视频。语境不匹配但经审查表达自然的原句仅用于学习说话方式，不带入其人物与事实；灌水及未审样本不用。生成提示词不再传入讨论提纲，不要求每个观点只出现一次，允许附和、半句和文化梗联想。原生评论只供学习平台语气与讨论方式，最终评论围绕完整当前文案重新生成，禁止直接复制或近义改写参考评论。生成每批最多 48 条，沿用配置并限制最多两批并发，并保留已有失败重试与取消机制；生成后追加一次精简 AI 质检，排除批量换词、编辑式点评、外部人物事实污染与围绕转写口误的评论，保留同一话题的不同反应及自然附和。以 1—2 分钟为优化目标，整次生成及自动补齐共享 5 分钟停止预算；平台采集、链接转写与模型响应影响实际耗时，停止后不会把未审语料或失败模型结果当成成功输出。历史记录与旧版原评标签保持兼容。补写会过滤工整转折、总结式金句、HTML 实体、事实/型号错误、链接污染和近似重复。新结果标记“AI 生成”，历史结果继续区分“相关原评 / AI 生成”；Word 导出的格式、内容和命名保持原有逻辑。弹幕仍保留独立的真实节奏参考，仅支持 B站；运行 `npm run engagement:refresh-style` 可刷新弹幕标杆数据。火山转写取得语音分段时使用真实时间，否则结果区会明确显示“文案节奏估时”。如果模型中转站限流，可把 `ENGAGEMENT_MODEL_CONCURRENCY` 调低。

工具台位于 `/tools`，新增的 Stirling-PDF 工作区会打开本机或局域网中的自托管 Stirling-PDF 实例，用于合并、拆分、压缩、转换、OCR、签名等 PDF 操作。Docker 默认启动地址为 `http://localhost:8080`；首次登录使用实例提示的初始账号后，应立即修改初始密码。

账号采集、工具台的单条提文案 / 标题文案、热点雷达刷新、视频热榜刷新和毛利批量刷新都通过任务中心后台运行，可查看进度并停止。任务输入与状态会持久化，前端使用游标只拉取增量变化；服务重启后，批量转写、热榜刷新、热点刷新和毛利刷新等幂等任务会自动回到队列，其他失败或中断任务可在任务中心直接重试。账号、视频、项目、素材、草稿和监控记录的删除会进入 `style-library/.trash/`，跨文件引用清理失败时自动回滚，也可通过 `/api/library/trash` 查询和恢复；浏览器文件下载仍采用直接流式下载。

抖音账号名采集会调用 `opencli douyin search <账号名> -f json` 解析 `sec_uid`；如果本机 opencli 暂未提供该适配器，可以先填写抖音主页链接或 `sec_uid` 采集。

视频热榜页位于 `/douyin-hotlist`（历史路径保留）。它维护一个独立的本地对标账号池，可添加抖音或 B站账号；关注列表保存在 `style-library/douyin-hotlist/watchlist.json`，账号和抓取结果保存在 `style-library/douyin-hotlist/accounts/<account>/`；这里添加账号不会写入主账号库 `style-library/douyin/` 或 `style-library/bilibili/`。抓取通过任务中心在后台运行，可查看账号级进度或停止任务；页面打开且可见时每 3 小时自动刷新一次，关闭页面不会抓取。自动刷新按最近一次全量检查计时，单账号手动抓取不会推迟全量刷新。

抖音热榜通过 OpenCLI 后台共享会话批量读取作品接口：每轮只初始化一次抖音会话，不逐账号打开主页。发布时间和互动统计使用接口真实字段，不从作品 ID 推测日期；普通媒体地址查询仍使用 `opencli douyin user-videos`。遇到 HTTP `401` / `403` / `444` / `429` 时暂停尚未发出的抖音请求，保留已成功结果与已有数据，并在刷新日志中提示处理方式；完成浏览器验证或等待限流恢复后可再次刷新。

抖音转写会优先复用已采集的媒体地址，必要时再调用 `opencli douyin user-videos` 刷新地址，然后由本机 `ffmpeg` 抽取 16kHz 单声道低码率 mp3，并通过火山引擎录音文件识别 2.0 的 `audio.data` 提交转写，避免火山服务端直接拉取带防盗链的抖音 URL。批量转写抖音视频时会先按账号预取一次媒体地址，再使用小并发转写，以减少重复 opencli 查询和火山任务排队带来的等待；如果本机网络、opencli、ffmpeg 或火山接口限流不稳定，可把 `DOUYIN_TRANSCRIBE_CONCURRENCY` 调回 `1`。B站视频仍优先使用公开字幕，没有字幕时会尝试下载后抽音频转写。

开发验证可依次运行 `npm test`、`npm run lint`、`npm run typecheck` 和 `npm run check:library`。若一致性检查只报告可安全推导的转写元数据漂移，可在确认后运行 `npm run check:library:repair`；修复前的原文件会备份到 `style-library/.repairs/<timestamp>/`，孤立目录、损坏 JSON 和跨引用问题不会自动修改。

## 打包交付

生成可交付运行包：

```bash
npm run package:release
```

如果要生成“数据维护 / 数据监控”Windows 专用便携包：

```bash
WINDOWS_NODE_DIR=/path/to/windows-node npm run package:release -- --preset gross-margin-win
```

如果要生成给普通 Windows 用户双击安装的 `.exe` 安装包，优先使用 GitHub Actions 里的
`Build Gross Margin Windows Installer` 工作流。它会在 Windows runner 上安装 Inno Setup，
并执行：

```bash
npm run package:release -- --preset gross-margin-win-installer
```

安装包会把程序装到用户目录下，并创建桌面/开始菜单快捷方式；运行数据保存在用户
`AppData`，升级安装不会覆盖已有维护和监控数据。本机 macOS 仍可继续生成 `.zip`
便携包用于排查，但不建议在 macOS 上直接生成 `.exe`。

脚本会在临时目录安装依赖并构建 Next.js standalone 产物，输出到 `dist/`：

- `account-style-library-*.tar.gz`：macOS / Linux 交付压缩包。
- `account-style-library-*.zip`：Windows 优先使用这个压缩包。
- `account-style-library-*-setup.exe`：Windows 安装包，优先交付给什么都没装的用户。
- 同名目录：本机可直接测试的解压目录。

`--preset gross-margin-win` 只生成 Windows `.zip` 和对应目录，不再生成 macOS / Linux `.tar.gz`。打包前需要通过 `WINDOWS_NODE_DIR` 提供一个包含 `node.exe` 的 Windows Node 运行时目录，脚本会把它内置到运行包里。

默认不会把本机 `style-library` 打进包里，避免误发账号素材、转写稿、草稿和监控记录。对方首次启动后会在运行包内创建空的 `style-library`。如果确实要带当前本地数据一起交付，显式执行：

```bash
npm run package:release -- --include-library
```

`--preset gross-margin-win` 固定只复制毛利数据，不会把整个 `style-library` 打进包里，避免误发其他账号库、草稿和写作素材。打包时只允许显式 `GROSS_MARGIN_LIBRARY_SOURCE` 或当前仓库 `style-library/gross-margin` 作为毛利数据源；找不到数据源会直接失败。如果确实要生成空毛利包，追加 `--allow-empty-gross-margin`。

对方解压后：

- macOS 双击 `install-deps.command` 检查/安装 Node.js、opencli、ffmpeg，再双击 `start.command`。
- 终端运行 `./install-deps.sh`、`./start.sh`、`./stop.sh`。
- Windows 先完整解压 `.zip`，首次使用运行 `setup-browser-bridge.cmd`，确认 OpenCLI Browser Bridge 扩展连通后再运行 `start.cmd`、`stop.cmd`；不要在压缩包预览窗口里直接双击。`gross-margin-win` 专用包会优先使用包内 `node.exe`，目标机不需要先全局安装 Node 或 opencli。

数据维护 / 数据监控模块不需要大模型；专用包已内置 `opencli` 主程序以支持刷新平台数据，但浏览器型抓取需要 Browser Bridge 扩展，无字幕视频转写才需要 `ffmpeg` 和火山转写配置。

默认写作直接读取风格卡，省去原作读取与匹配，不额外调用模型筛选或制定计划。准备阶段的 `writer.preparation` 日志记录素材、支持文档、联网和风格准备耗时，`writer.sample-analysis` 记录缓存命中与生成数量，不记录资料正文。


### 直接写作与可撤销偏好

选博主或项目并提供素材后，写作台以现有风格卡和用户当次要求为主，通常每种风格只调用一次模型生成正文。要求冲突时，当次要求优先，其次是明确保存的偏好，再其次是风格卡。默认不自动附带原作，也不追加公共修辞指导和末尾编辑检查；用户自定义提示词直接填写在当次要求中，长期要求使用“以后也这样写”。支持文档和联网资料仅在实际提供或启用时加入，视频转写或联网仍可能有额外调用。单篇通过后台任务的 partialText 展示生成中正文；多篇继续独立生成，避免混稿。学习原作、重新归纳风格卡仍使用原有独立流程，不受默认写作精简影响。

在成稿下填写“以后也这样写”，点击“记住这条偏好”，只更新当前稿件对应的一个博主或项目。偏好独立标注为用户表达要求，不视为博主原作证据；它对之后的新稿生效，旧稿续改仍用原快照。可撤销本次记住，或在风格卡中编辑清理。更新复用现有原子写入、风格历史和 hash 冲突校验；重新学习保留明确保存的偏好。普通手改和 AI 输出不会自动升级为长期规则。本版没有后台自动采集，也不批量重建旧风格卡。

## 生图工作台

工作台模式下打开 `/images`，或从侧栏进入“生图工作台”。创作画布支持拖动、平移、缩放与分支查看；作品图库用大缩略图纵向浏览历史。底部常驻提示词、模型、比例和张数（默认 1 张），右侧“参数设置”提供质量、精确尺寸与 2K / 4K 预设。最多使用 6 张参考图（上传、拖放、粘贴，每张最多 10MB）；在提示词中输入 `@` 可引用已上传素材或当前画布的生成图，引用绑定图片 ID，提交时转换为模型接收的图片序号。移除仍被引用的图片后，需删除对应引用或重新添加图片才能生成。

查看历史不会替换当前输入；“复用这组参数”显式载入历史设置，“基于此图修改”将该结果作为参考创建新分支，保留旧记录。可选 2–4 张图片并排对比，也支持缩放预览和原图下载。画布归属与分支随生成记录保存，拖动位置仅保存在当前浏览器；旧记录按独立画布展示，无需迁移。页面使用 React Flow、Tiptap Mention 和 Yet Another React Lightbox，模型密钥不下发到浏览器。

生图复用任务中心的排队、进度、取消和失败重试。结果逐张原子保存到 `STYLE_LIBRARY_DIR/images`，部分失败或取消保留已完成图片；服务重启后未完成任务标记为中断，可手动重试，不自动重复调用收费图片服务。再次生成创建独立记录，原图和原参数保持不变。历史列表返回摘要，图片按需读取。

请在 `.env.local` 配置 `IMAGE_API_KEY`、`IMAGE_BASE_URL`、`IMAGE_MODEL`；运行中的生产服务需重启以读取新配置。接口参数是否被接受取决于中转服务；拒绝、限流、鉴权失败和超时均显示真实错误，不生成替代图片。毛利专用模式不开放本模块。

生图工作台支持模型配置选择、自定义宽高（256–4096）、16 倍数对齐和常用比例 / 2K / 4K 预设。尺寸是否可用由对应图片服务决定。新增服务使用 `.env.local` 的 `IMAGE_PROFILES` JSON 数组，例如 `[{"id":"provider2","label":"第二套服务","model":"模型名","baseUrl":"https://example.com/v1","apiKey":"服务密钥"}]`。每套配置有独立密钥和地址，页面只接收名称与 ID；原 `IMAGE_*` 配置保留为 `default`，`IMAGE_DEFAULT_PROFILE` 可指定新建任务默认选择的配置 ID。历史记录保留所选配置 ID，旧记录继续使用默认配置；修改配置后重启服务生效。

### 游戏热点雷达

`/hotspots` 接入 36 个游戏媒体、赛事、官方和社区入口。点击刷新创建 `hotspot-refresh` 后台任务，支持进度、取消和重启后的中断恢复；页面读取已有快照，不自动调用模型。采集保留最近 72 小时有发布时间的资讯，规则预筛后交给两轮 AI 输出五档编辑优先级、评论方向和视频切入点。编辑优先级不是客观热度，评论方向不是实测评论情绪。

模型复用工作台对话模型与备用节点配置；`HOTSPOT_RADAR_COARSE_LIMIT` 默认 80（40—160），`HOTSPOT_RADAR_FINE_LIMIT` 默认 24（6—48），`HOTSPOT_RADAR_MODEL_CONCURRENCY` 默认 2（1—3）。网页采集调用系统 curl，适配 macOS / Linux / Windows，支持 `HOTSPOT_RADAR_PROXY`。小黑盒使用已安装的 Google Chrome（可设 `CHROME_BIN`）和独立临时配置，不读取日常浏览器资料；未安装、受限或超时会显示来源错误。临时聚合域名与网站解析器可能失效，可在来源诊断中查看。

轻量刷新以 3～10 分钟为目标，实际取决于来源和模型响应，不保证慢节点也能完整完成。每个来源限时 20 秒、最多补查 3 篇缺日期文章；单批模型限时 60 秒，整轮 9 分半中止外部请求并显式报告未完成。粗筛每批 20 条、精筛每批 6 条；达到精筛数量上限时显示实际覆盖，未精筛资讯仍可阅读。优先复用已有正文缓存，再为最多 8 条候选各补一篇原文，单篇限时 12 秒、正文阶段总预算 60 秒，复用支持文档读取器及其 24 小时缓存；缺正文的选题降为“先看看”，详情和写作台输入均携带材料缺口，不能把摘要推断当作已核实事实。

逐条缓存粗筛和精筛的有效判断（包括淘汰结果），相同最终选题池也复用日报，保存在 `.cache/hotspot-analysis/`，72 小时内复用。新增或批次重排只分析缺失项；模型配置、提示词、输入材料、该条资讯的评分或 `HOTSPOT_RADAR_INTERESTS` 变化会失效对应缓存；不相关评分、仅 API 密钥轮换和正文缺失的不同网络报错不会导致全部重算。反馈用于该条资讯，团队通用偏好仍通过 interests 设置。失败和非法输出不缓存。URL 去重忽略已知追踪参数和 fragment，保留文章身份参数及原始来源链接。

“继续分析”沿用 72 小时内已保存的采集记录，不请求来源，跳过已完成精筛（包括合法淘汰）的候选，每次最多继续一轮精筛预算；保留已有选题并累计覆盖。本轮候选全部完成后按钮禁用。它针对本轮粗筛预算内的候选，不等于全库逐篇分析；若要扩大范围可调整粗筛上限后重新采集。旧版记录没有完成 ID 时从已有选题恢复进度。日报失败仍可单独重试。

来源请求缓存位于 `.cache/hotspot-requests/`：10 分钟内直接复用，过期后对支持的网站发送 ETag / Last-Modified 条件请求，304 复用正文。网络、HTTP 或来源解析失败后按 5、10、20、40、60 分钟冷却，成功即重置；用户取消不计失败。冷却期间有 72 小时内成功缓存则显式标记“旧缓存回退”，没有则显示失败和下次重试时间；来源诊断展示缓存命中、来源未变化、重新获取或旧缓存状态。小黑盒复用请求缓存和冷却，但没有 HTTP 条件请求。

至少一半来源可用且有近期资讯才开始分析（日期补查不完整但取得有效资讯的来源计为可用，仍保留错误诊断）；采集完成先原子保存 `radar-collection.json`，资讯列表立即可读；精筛每批完成保存选题并递增任务数据版本。模型批次或结构校验失败保留旧快照、本轮资讯和已完成批次。精筛完成后先发布新选题快照，再生成日报；日报失败不回滚选题，任务仍明确显示失败，可点击“保留选题，仅重试日报”，不重复采集和筛选；超过 72 小时要求重新采集。正常分析无选题可以保存空选题池。最高档保留窗口从首次进入开始计算 72 小时，不随刷新延长。列表只返回摘要，采集材料和风险按选题 ID 懒加载。

数据位于 `STYLE_LIBRARY_DIR/hotspots/`，快照和反馈通过运行时 schema 校验与原子写入保存。评分按当前本地工作台统一维护，不接受客户端冒充用户身份；可保存“吊爆了 / 还行 / 不行”，最新评分与最近 1000 条历史供后续提示词参考。兼容已有规则版快照，不自动搬迁外部源码包的数据。原项目宿主定时器未迁入，避免开发热重载重复调度；需要自动刷新时应通过外部调度调用创建任务接口 `POST /api/hotspots`，不要启动原 CJS 路由。

热点雷达复用调研：采用 [rss-parser](https://github.com/bobby-brennan/rss-parser)（MIT）处理 RSS / Atom，保留工作台现有网络、任务和存储链。界面参考 [NewsNow](https://github.com/newsnext/newsnow)（MIT）的来源导航及 [Folo](https://github.com/RSSNext/Folo)（AGPL-3.0）的列表阅读布局，仅借鉴交互，不复制代码。[RSSHub](https://github.com/DIYgod/RSSHub)（AGPL-3.0）作为后续可选来源服务，本次未引入其部署依赖。

TrendRadar 在本机 Docker 中独立运行，部署目录为 `~/Applications/trendradar`，采集输出挂载到该目录的 `output`。工作台通过系统 `sqlite3 -readonly` 读取最新热榜/RSS 日库；`TRENDRADAR_OUTPUT_DIR` 可覆盖输出路径，数据库损坏或权限错误会显式报错。`127.0.0.1:8081` 是 TrendRadar 报告页，不是控制 API。

资讯发现继续使用原 NewsNow 嵌入页。“更新选题”默认运行统一事件链路：读取 TrendRadar 已配置来源的热榜/RSS，以及视频热榜已保存的抖音/B站数据 → 时间窗口与排除词过滤 → URL 去重、来源与类型均衡 → AI 粗筛并排序 → 跨语言事件归并与近期事件关联 → 有界正文补充 → 按事件精筛 → 合并发布选题池。它不会自动抓取 NewsNow 页面所有可选站点，也不会重新爬视频账号；上游采集分别按自己的刷新机制运行，过期、缺失和读取失败会在来源状态中显示。RSSHub 尚未部署。

默认读取 72 小时内数据、每来源最多 20 条进入候选排序、全轮最多 80 条粗筛、24 个事件精筛。三类来源轮转，避免单一 RSS 源占满候选；优先分由模型给出，最终为编辑判断。相关配置见 `.env.example` 的 `HOTSPOT_RADAR_INPUTS`、`MAX_AGE_HOURS`、`PER_SOURCE_LIMIT`、`COARSE_LIMIT`、`FINE_LIMIT`、`INTERESTS`、`EXCLUDE`（均带 `HOTSPOT_RADAR_` 前缀）。默认关闭额外日报，设 `HOTSPOT_RADAR_REPORT=1` 可开启。配置变动后按现有环境变量方式重启服务。

事件归并要求每个输入 ID 恰好出现一次，已有资讯保留历史事件归属；非法/缺失 ID 显式失败，不缓存不完整合并。新回应或处罚可更新原选题 ID，保留评分、历史来源和最多 30 条来源时间线；普通转载不应标作新进展。事件新进展仍是基于来源材料的 AI 判断，详情保留待核实状态。全文补充每事件最多两篇、整轮最多八次网络请求和一分钟正文预算，不进行无限联网延展。视频标题/互动仅作为传播线索，当前不自动转写，不拿标题冒充视频全文；未知发布时间不会用采集时间替代。

新链路继续使用现有 `hotspot-refresh` 任务、取消/进度/部分结果原子保存、9 分半上限与分析缓存。精筛每批 3 个事件，单批最多等待 120 秒，整轮截止时间优先；模型超时后可继续已保存进度。缓存覆盖粗筛、事件归并和精筛，输入/兴趣/模型变化重新判断，合法淘汰结果也复用；继续分析按事件材料指纹和模型/兴趣配置跳过已完成事件。既有选题保留并按原可见性规则过期；未变化的事件不反复更新日期。旧版采集记录仍可沿用旧链路继续完成。设置内“手动补充候选”作为可选补充，不再是默认步骤。
