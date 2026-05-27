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

这个专用包不是单文件 `exe`，而是 Windows 便携包：解压后双击 `start.cmd`，浏览器默认打开 `/gross-margin`，并且只保留“数据维护”和“数据监控”两页；其他工作台页面在专用模式下会被自动拦回毛利模块。专用包现在也会内置 `opencli`，目标 Windows 机器不需要再单独安装它。

开发服务器运行时不要同时执行 `npm run build`，Next.js 会复用 `.next` 目录，可能让开发页的 CSS/JS 静态资源短暂 404。若页面看起来像样式丢失，执行：

```bash
rm -rf .next
npm run dev
```

## 配置

- `OPENCLI_BIN`：默认使用 `opencli`，用于 B站 / 抖音采集。
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
- `CHAT_API_KEY`、`CHAT_BASE_URL`、`CHAT_RESPONSES_URL`、`CHAT_COMPLETIONS_URL`、`CHAT_MODEL`、`CHAT_WIRE_API`、`CHAT_REASONING_EFFORT`：对话模型配置，用于自动提炼风格和生成文案。默认按当前 Codex 会话使用 `https://www.fhl.mom`、`gpt-5.5`、`responses`、`xhigh`。新中转站如果只兼容 OpenAI Chat Completions，可设 `CHAT_WIRE_API=chat_completions`；不确定时可设 `CHAT_WIRE_API=auto`，系统会在 Responses 不兼容时自动切到 Chat Completions。`CHAT_BASE_URL` 可以填中转站根地址，也可以用 `CHAT_RESPONSES_URL` / `CHAT_COMPLETIONS_URL` 指定完整接口地址。`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 也会作为兜底配置读取。
- `CHAT_PROXY_URL`：可选。若 Node/Next 直连模型服务失败，可设为本机代理，例如 `http://127.0.0.1:7890`。
- `ENGAGEMENT_MODEL_CONCURRENCY`：评论生成并发批次数，默认 `4`，建议保持在 `1-4` 之间；中转站限流或超时时可先调回 `1`。
- `IMAGE_API_KEY`、`IMAGE_BASE_URL`、`IMAGE_MODEL`、`IMAGE_SIZE`、`IMAGE_QUALITY`、`IMAGE_FORMAT`、`IMAGE_PROXY_URL`：可选。用于后续独立封面生成能力，默认按 OpenAI Images API / `gpt-image-2` / `2048x1152` 生成。
- `FEISHU_OPENCLI_AS`、`FEISHU_FOLDER_TOKEN`：可选。飞书文档发布固定使用 `opencli lark-cli docs +create`，默认使用当前 lark-cli 用户身份。

如果没有配置对话模型，系统会使用本地兜底模板生成可编辑结果，便于先跑通流程。

评论生成页位于 `/assets`，可基于已保存草稿、粘贴文案或 B站 / 抖音视频链接生成观众评论，并可按需生成弹幕。评论和弹幕使用对话模型；链接提取沿用现有视频转写链路，普通网页内容请改用粘贴文案。当前默认会生成 `100` 条评论，评论高批量场景会按 `25` 条一批并发生成；如果模型中转站限流，可把 `ENGAGEMENT_MODEL_CONCURRENCY` 调低。

抖音账号名采集会调用 `opencli douyin search <账号名> -f json` 解析 `sec_uid`；如果本机 opencli 暂未提供该适配器，可以先填写抖音主页链接或 `sec_uid` 采集。

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

`--preset gross-margin-win` 固定只复制 `style-library/gross-margin`，不会把整个 `style-library` 打进包里，避免误发其他账号库、草稿和写作素材。当前会优先从你 V1 文案工作台的 `style-library/gross-margin` 复制毛利账号库数据。

对方解压后：

- macOS 双击 `install-deps.command` 检查/安装 Node.js、opencli、ffmpeg，再双击 `start.command`。
- 终端运行 `./install-deps.sh`、`./start.sh`、`./stop.sh`。
- Windows 先完整解压 `.zip`，再运行 `install-deps.cmd`、`start.cmd`、`stop.cmd`；不要在压缩包预览窗口里直接双击。`gross-margin-win` 专用包会优先使用包内 `node.exe`，目标机不需要先全局安装 Node。

数据维护 / 数据监控模块不需要大模型；专用包已内置 `opencli` 以支持刷新平台数据，无字幕视频转写才需要 `ffmpeg` 和火山转写配置。
