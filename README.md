# 账号风格库本地网页

本地使用的账号风格库工作台，用于把 B站 / 抖音账号的爆款内容采集、转写、沉淀成可编辑风格卡，并在写作台里参考账号风格生成文案。

## 启动

```bash
npm install
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000`。

如果希望服务退出终端后仍然保持运行，可以使用后台启动：

```bash
npm run dev:daemon
npm run dev:status
npm run dev:restart
npm run dev:stop
```

后台日志写入 `.dev-server/next-dev.log`，该目录不会提交到 git。

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
- `JOB_MAX_ACTIVE`：后台任务最大同时运行数，默认 `2`，允许 `1-6`；多任务会先排队再执行。
- `JOB_HISTORY_LIMIT`：任务历史保留条数，默认 `200`，允许 `50-1000`，超出后自动清理更早的已结束任务。
- `VOLCENGINE_ASR_API_KEY`：火山引擎录音文件识别 2.0 API Key。
- `VOLCENGINE_ASR_RESOURCE_ID`：火山引擎转写资源 ID，默认 `volc.seedasr.auc`。
- `VOLCENGINE_ASR_POLL_INTERVAL_MS`：火山转写查询间隔，默认 `1000` 毫秒。
- `VOLCENGINE_ASR_MAX_POLL_ATTEMPTS`：火山转写最大轮询次数，默认 `120`。
- `VOLCENGINE_ASR_REQUEST_TIMEOUT_MS`：火山转写单次请求超时，默认 `30000` 毫秒。
- `VOLCENGINE_ASR_RETRY_COUNT`：火山转写遇到瞬时网络错误时的重试次数，默认 `2`，建议保持在 `0-3`。
- `DOUYIN_TRANSCRIBE_CONCURRENCY`：抖音批量转写并发数，默认 `3`，建议保持在 `1-4`。
- `DOUYIN_HOTLIST_REFRESH_CONCURRENCY`：抖音热榜账号刷新并发数，默认 `5`，允许 `1-5`；OpenCLI 或抖音页面不稳定时可调回 `1-2`。
- `CHAT_API_KEY`、`CHAT_BASE_URL`、`CHAT_RESPONSES_URL`、`CHAT_COMPLETIONS_URL`、`CHAT_MODEL`、`CHAT_WIRE_API`、`CHAT_REASONING_EFFORT`、`CHAT_SERVICE_TIER`：主对话模型配置，用于自动提炼风格和生成文案。新中转站如果只兼容 OpenAI Chat Completions，可设 `CHAT_WIRE_API=chat_completions`；不确定时可设 `CHAT_WIRE_API=auto`，系统会在 Responses 不兼容时自动切到 Chat Completions。`CHAT_SERVICE_TIER=priority` 可显式请求中转站 / Codex 的快速服务层，和 `xhigh` 推理档位是两件事。`CHAT_BASE_URL` 可以填中转站根地址，也可以用 `CHAT_RESPONSES_URL` / `CHAT_COMPLETIONS_URL` 指定完整接口地址。`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 也会作为主模型配置读取。
- `CHAT_FALLBACK_API_KEY`、`CHAT_FALLBACK_BASE_URL`、`CHAT_FALLBACK_RESPONSES_URL`、`CHAT_FALLBACK_COMPLETIONS_URL`、`CHAT_FALLBACK_MODEL`、`CHAT_FALLBACK_WIRE_API`、`CHAT_FALLBACK_REASONING_EFFORT`、`CHAT_FALLBACK_SERVICE_TIER`、`CHAT_FALLBACK_PROXY_URL`、`CHAT_FALLBACK_ENABLED`：备用对话模型配置。默认备用地址和模型是旧配置 `https://www.fhl.mom` / `gpt-5.5` / `responses` / `xhigh`，但必须单独填写 `CHAT_FALLBACK_API_KEY` 或 `FHL_API_KEY` 才会启用，避免把主模型 key 发到旧中转站。
- `CHAT_PROXY_URL`：可选。若 Node/Next 直连模型服务失败，可设为本机代理，例如 `http://127.0.0.1:7890`。
- `CHAT_HEALTH_PROBE_TIMEOUT_MS`：对话模型健康检查探针超时，默认 `8000` 毫秒，允许 `2000-30000`。
- `ENGAGEMENT_MODEL_CONCURRENCY`：评论生成并发批次数，默认 `4`，建议保持在 `1-4` 之间；中转站限流或超时时可先调回 `1`。
- `IMAGE_API_KEY`、`IMAGE_BASE_URL`、`IMAGE_MODEL`、`IMAGE_SIZE`、`IMAGE_QUALITY`、`IMAGE_FORMAT`、`IMAGE_PROXY_URL`：可选。用于后续独立封面生成能力，默认按 OpenAI Images API / `gpt-image-2` / `2048x1152` 生成。
- `FEISHU_OPENCLI_AS`、`FEISHU_FOLDER_TOKEN`：可选。飞书文档发布固定使用 `opencli lark-cli docs +create`，默认使用当前 lark-cli 用户身份。

如果没有配置对话模型，系统会使用本地兜底模板生成可编辑结果，便于先跑通流程。

评论生成页位于 `/assets`，可基于已保存草稿、粘贴文案或 B站 / 抖音视频链接生成观众评论，并可按需生成弹幕。评论和弹幕使用对话模型；链接提取沿用现有视频转写链路，普通网页内容请改用粘贴文案。当前默认会生成 `100` 条评论，评论高批量场景会按 `25` 条一批并发生成；如果模型中转站限流，可把 `ENGAGEMENT_MODEL_CONCURRENCY` 调低。

抖音账号名采集会调用 `opencli douyin search <账号名> -f json` 解析 `sec_uid`；如果本机 opencli 暂未提供该适配器，可以先填写抖音主页链接或 `sec_uid` 采集。

抖音热榜页位于 `/douyin-hotlist`。它维护一个独立的本地对标账号池，关注列表保存在 `style-library/douyin-hotlist/watchlist.json`，账号和抓取结果保存在 `style-library/douyin-hotlist/accounts/<account>/`；这里添加账号不会写入主账号库 `style-library/douyin/`。

抖音转写会优先复用已采集的媒体地址，必要时再调用 `opencli douyin user-videos` 刷新地址，然后由本机 `ffmpeg` 抽取 16kHz 单声道低码率 mp3，并通过火山引擎录音文件识别 2.0 的 `audio.data` 提交转写，避免火山服务端直接拉取带防盗链的抖音 URL。批量转写抖音视频时会先按账号预取一次媒体地址，再使用小并发转写，以减少重复 opencli 查询和火山任务排队带来的等待；如果本机网络、opencli、ffmpeg 或火山接口限流不稳定，可把 `DOUYIN_TRANSCRIBE_CONCURRENCY` 调回 `1`。B站视频仍优先使用公开字幕，没有字幕时会尝试下载后抽音频转写。

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
