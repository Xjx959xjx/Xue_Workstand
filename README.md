# 账号风格库本地网页

本地使用的账号风格库工作台，用于把 B站 / 抖音账号的爆款内容采集、转写、沉淀成可编辑风格卡，并在写作台里参考账号风格生成文案。

## 规划文档

- [手机远程工作台设计](./MOBILE_REMOTE_DESIGN.md)：通过 Tailscale 从 iPhone 远程访问本机工作台；第一版手机外壳、状态检测和发布脚本已实现。

## 启动

```bash
npm install
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000`，默认进入视频热榜页 `/douyin-hotlist`（历史路径保留）。开发服务默认使用 Turbopack，侧栏模块会在空闲时顺序预热页面和只读首屏 API，避免首次切换时现场编译造成数秒卡顿。

如果希望服务退出终端后仍然保持运行，可以使用后台启动：

```bash
npm run dev:daemon
npm run dev:status
npm run dev:restart
npm run dev:stop
```

后台日志写入 `.dev-server/next-dev.log`，该目录不会提交到 git。

## iPhone 私人远程访问

Mac 和 iPhone 安装 Tailscale、登录同一个私人账号后，在项目目录执行：

```bash
npm run remote:setup
npm run remote:deploy
npm run remote:status
```

`remote:setup` 配置 Tailscale Serve 和 macOS LaunchAgent；Next.js 仍只监听
`127.0.0.1:3000`，不会开放公网端口，也不要启用 Funnel。正式服务通过
`caffeinate` 在 Mac 插电、开盖时保持运行。然后在 iPhone 的 Tailscale 中找到该
Mac 的私人 HTTPS 地址，用 Safari 打开并“添加到主屏幕”。

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

## 配置

- `OPENCLI_BIN`：默认使用 `opencli`，用于 B站 / 抖音采集。
- `OPENCLI_BROWSER_CONNECT_TIMEOUT`：opencli 等待 Browser Bridge 连接的秒数，Windows 专用包默认 `8`，避免扩展未连接时每条刷新长时间卡住。
- `OPENCLI_WINDOW`：opencli 浏览器窗口模式，Windows 专用包默认 `background`，减少刷新时反复弹出浏览器窗口。
- `FFMPEG_BIN`：默认使用 `ffmpeg`，抖音和无字幕 B站回退转写时会先抽取音频。
- `STYLE_LIBRARY_DIR`：本地风格库目录，默认 `./style-library`。
- `WECOM_ACCOUNT_SHEET_URL`：可选。配置企业微信在线表格链接后，数据维护里的抖音 / B站账号配对和报价以在线表为准，通过 `wecom-cli` 读取。普通打开会立即展示最后一次成功缓存并在后台刷新，不再等待远端；手动点击刷新才会等待最新结果。在线表暂时不可用时继续显示上次成功缓存或本地缓存，并给出可见警告。
- `WECOM_CLI_BIN`、`WECOM_ACCOUNT_SHEET_CACHE_TTL_MS`、`WECOM_ACCOUNT_SHEET_FALLBACK_LOCAL`：在线账号表读取命令、缓存时长和本地回退开关。
- `JOB_MAX_ACTIVE`：后台任务最大同时运行数，默认 `2`，允许 `1-6`；多任务会先排队再执行。
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
- `DOUYIN_HOTLIST_REFRESH_CONCURRENCY`：视频热榜账号刷新并发数，默认 `5`，允许 `1-5`；OpenCLI、抖音或 B站页面不稳定时可调回 `1-2`。变量名沿用旧版抖音热榜配置。
- `CHAT_API_KEY`、`CHAT_BASE_URL`、`CHAT_RESPONSES_URL`、`CHAT_COMPLETIONS_URL`、`CHAT_MODEL`、`CHAT_WIRE_API`、`CHAT_REASONING_EFFORT`、`CHAT_SERVICE_TIER`：主对话模型配置，用于自动提炼风格和生成文案。新中转站如果只兼容 OpenAI Chat Completions，可设 `CHAT_WIRE_API=chat_completions`；不确定时可设 `CHAT_WIRE_API=auto`，系统会在 Responses 不兼容时自动切到 Chat Completions。`CHAT_SERVICE_TIER=priority` 可显式请求中转站 / Codex 的快速服务层，和 `xhigh` 推理档位是两件事。`CHAT_BASE_URL` 可以填中转站根地址，也可以用 `CHAT_RESPONSES_URL` / `CHAT_COMPLETIONS_URL` 指定完整接口地址。`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 也会作为主模型配置读取。
- `CHAT_FALLBACK_API_KEY`、`CHAT_FALLBACK_BASE_URL`、`CHAT_FALLBACK_RESPONSES_URL`、`CHAT_FALLBACK_COMPLETIONS_URL`、`CHAT_FALLBACK_MODEL`、`CHAT_FALLBACK_WIRE_API`、`CHAT_FALLBACK_REASONING_EFFORT`、`CHAT_FALLBACK_SERVICE_TIER`、`CHAT_FALLBACK_PROXY_URL`、`CHAT_FALLBACK_ENABLED`：第一备用对话模型配置。默认备用地址和模型是旧配置 `https://www.fhl.mom` / `gpt-5.5` / `responses` / `xhigh`，但必须单独填写 `CHAT_FALLBACK_API_KEY` 或 `FHL_API_KEY` 才会启用，避免把主模型 key 发到旧中转站。还可按相同后缀配置 `CHAT_FALLBACK_2_*` 至 `CHAT_FALLBACK_5_*`，系统会依次尝试。
- `CHAT_PROXY_URL`：可选。若 Node/Next 直连模型服务失败，可设为本机代理，例如 `http://127.0.0.1:7890`。
- `CHAT_HEALTH_PROBE_TIMEOUT_MS`：对话模型健康检查探针超时，默认 `8000` 毫秒，允许 `2000-30000`。
- `WEB_RESEARCH_ENABLED`、`WEB_RESEARCH_API_KEY`、`WEB_RESEARCH_BASE_URL`、`WEB_RESEARCH_RESPONSES_URL`、`WEB_RESEARCH_MODEL`、`WEB_RESEARCH_REASONING_EFFORT`、`WEB_RESEARCH_SERVICE_TIER`、`WEB_RESEARCH_PROXY_URL`：写作台联网检索的独立 Responses API 配置，推理档位默认 `medium`。它只负责 `web_search`，不会改变现有 Chat Completions 写作链；未配置独立接口时，系统仍可使用对话模型链里明确支持 Responses 的节点。密钥不会自动跨服务复用，如确实是同一服务，可在本地环境文件写 `WEB_RESEARCH_API_KEY=$CHAT_API_KEY`。
- `STYLE_ONE_SHOT_MAX_INPUT_CHARS`、`STYLE_SAMPLE_ANALYSIS_CONCURRENCY`：账号风格卡在完整转写总字数不超过默认 `50000` 时，使用一次 `high` 请求直接完成全量分析和风格卡生成；超过阈值后仍保持 `high`，按默认并发 `1` 串行分析样本，再做最终整合，避免中转站并发 429。
- `ENGAGEMENT_MODEL_CONCURRENCY`：评论生成并发批次数，默认 `4`，建议保持在 `1-4` 之间；中转站限流或超时时可先调回 `1`。
- `ENGAGEMENT_COMMENT_CANDIDATE_RATIO`：评论首轮超采样倍率，默认 `1.4`，允许 `1.05-1.5`；模型会多写一批候选，再按长度、重复结构和事实约束筛到目标数量。
- `IMAGE_API_KEY`、`IMAGE_BASE_URL`、`IMAGE_MODEL`、`IMAGE_SIZE`、`IMAGE_QUALITY`、`IMAGE_FORMAT`、`IMAGE_PROXY_URL`：可选。用于后续独立封面生成能力，默认按 OpenAI Images API / `gpt-image-2` / `2048x1152` 生成。
- `FEISHU_OPENCLI_AS`、`FEISHU_FOLDER_TOKEN`：可选。飞书文档发布固定使用 `opencli lark-cli docs +create`，默认使用当前 lark-cli 用户身份。

如果没有配置对话模型，风格卡仍可使用本地兜底模板生成可编辑结果。写作、评论和弹幕生成依赖可用的对话模型；鉴权、限流、超时或模型未配置会直接失败，不会静默切到与资料无关的本地模板。

账号库位于 `/library`，支持按平台、转写和风格状态筛选账号，并按标题、转写状态及数据指标筛选排序视频；筛选条件和当前选择会写入 URL，刷新后可恢复。批量模式可对当前筛选结果选择、转写或导出。手动保存、重新转写和历史恢复都使用 revision 冲突保护；覆盖前的旧稿归档到账号目录的 `transcripts/.history/<video-id>/`，可在转写稿编辑器中查看并恢复。

对话写作页位于 `/writer`。参考风格支持同时选择多个账号或项目，选择顺序即优先级：第一项作为主风格，其余作为补充风格；这组引用会随草稿版本保存并在续改时继续使用。首稿、模型续改和手动编辑都会保存为同一写作会话下的独立版本，可在右侧历史栏切换，不会覆盖上一版；历史列表只加载标题、版本和时间，点开后才读取草稿全文。旧草稿会按单版本、单风格引用继续读取。素材、原文、抖音 / B站视频链接和支持文档共用一个输入框：视频链接自动转写，飞书、网易灵犀、企业微信、腾讯文档及普通公开网页链接自动读取正文；链接未公开或当前工具身份无权限时会明确报错，不会把裸链接交给模型猜。首稿不再额外生成写作 Brief，而是把用户要求、原始素材、所选风格卡组、代表样本和已读取资料直接交给成稿模型；开头方式、句长、节奏、具象程度和结尾方式只服从当前所选风格卡组与代表样本，不附加跨账号通用模板。续改只读取当前稿件、已保存资料摘要、当前所选风格卡组，以及旧草稿已有的历史策划备注，不会重复转写链接、抓支持文档或联网。联网检索开关位于生成按钮旁，使用独立 `WEB_RESEARCH_*` Responses API，和现有 Chat Completions 写作接口互不影响；没有独立配置且对话模型链里也没有 Responses 节点时，入口才会置灰。选中稿件段落后可以只改局部，但模型仍会返回并保存完整新稿。

写作素材支持点选或拖入 TXT、Markdown、CSV、JSON、HTML、字幕和 DOCX 文件；本地文件正文中的链接会保留为正文，不会误触发视频转写或支持文档抓取。

评论生成页位于 `/assets`，可基于已保存草稿、粘贴文案或 B站 / 抖音视频链接生成观众评论；历史区只读取标题、来源和数量，点开记录后才加载评论、弹幕和来源全文。粘贴文案必须选择目标平台，视频链接会自动识别。评论和弹幕使用对话模型；输入中只要包含支持的视频链接（包括带标题、口令的整段分享文案），就必须先沿用现有视频转写链路取得文稿，不能把分享文案直接当正文生成。链接、域名、短链码、视频 ID 和平台分享指令只用于采集与追踪，进入 Brief、素材锚点和模型提示词前会被剥离，模型输出中再次出现也会被过滤。评论默认生成 `50` 条，可选“平台自然”或“原评增强”：平台自然只用当前视频文稿理解内容，平台语气来自本地冷启动标杆库；标杆库按平台、题材和视频形态检索，并排除当前视频 ID。原评增强才额外读取当前视频原评。真实样本为零时生成会显式停止，不再静默使用万能预设。生成前会为每条评论分配意图、长度、可选素材锚点和表情额度，以 `8` 条小批次并发超采样，再按事实、长度、平台表情、重复结构和近似重复本地筛选；单批失败时先保存其余可用结果，同一任务随后会自动原位补齐评论和弹幕，不再要求手动点击。结果可下载为标准 Word `.docx`，文件名为“账号名+XX条评论+XX条弹幕.docx”。运行 `npm run engagement:refresh-style` 会以固定预算重建标杆库：先复用本地账号库 / 热榜真实评论，再为 B站和抖音各题材补取少量参考视频；B站默认约三分之二预算给手机、PC、影像、耳机、穿戴、AI 硬件等数码垂类，按热度优先可信评测账号、限制单账号占比，并剔除抽奖和店铺导流评论。若 B站临时风控导致评论区覆盖不足，刷新会明确失败并保留上一份可用缓存。生成时不会联网或无限滚动。`npm run engagement:refresh-style -- --local-only` 可只用本地数据重建，采样预算、数码占比、偏好账号和题材查询可通过 `ENGAGEMENT_BENCHMARK_*` 调整。弹幕仅支持 B站，刷新时保存真实弹幕时间点；生成时由程序结合真实密度和当前文稿爆点创建成簇时间槽，以 `16` 条小批次、最多 `2` 并发生成并对瞬时限流自动重试，只有程序标记的复读槽可以重复，模型只填写槽位文本，不得自行编时间。火山转写取得语音分段时使用真实时间，否则结果区会明确显示“文案节奏估时”。如果模型中转站限流，可把 `ENGAGEMENT_MODEL_CONCURRENCY` 调低。链接文稿、评论锚点和标杆语料会缓存在 `style-library/engagement/.cache/`，这些内容是可重新生成的派生缓存，不属于评论历史资产。

账号采集、工具台的单条提文案 / 标题文案、热点雷达刷新、视频热榜刷新和毛利批量刷新都通过任务中心后台运行，可查看进度并停止。任务输入与状态会持久化，前端使用游标只拉取增量变化；服务重启后，批量转写、热榜刷新、热点刷新和毛利刷新等幂等任务会自动回到队列，其他失败或中断任务可在任务中心直接重试。账号、视频、项目、素材、草稿和监控记录的删除会进入 `style-library/.trash/`，跨文件引用清理失败时自动回滚，也可通过 `/api/library/trash` 查询和恢复；浏览器文件下载仍采用直接流式下载。

抖音账号名采集会调用 `opencli douyin search <账号名> -f json` 解析 `sec_uid`；如果本机 opencli 暂未提供该适配器，可以先填写抖音主页链接或 `sec_uid` 采集。

视频热榜页位于 `/douyin-hotlist`（历史路径保留）。它维护一个独立的本地对标账号池，可添加抖音或 B站账号；关注列表保存在 `style-library/douyin-hotlist/watchlist.json`，账号和抓取结果保存在 `style-library/douyin-hotlist/accounts/<account>/`；这里添加账号不会写入主账号库 `style-library/douyin/` 或 `style-library/bilibili/`。抓取通过任务中心在后台运行，可查看账号级进度或停止任务；页面打开且可见时每 3 小时自动刷新一次，关闭页面不会抓取。自动刷新按最近一次全量检查计时，单账号手动抓取不会推迟全量刷新。

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
