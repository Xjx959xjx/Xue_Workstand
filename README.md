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

开发服务器运行时不要同时执行 `npm run build`，Next.js 会复用 `.next` 目录，可能让开发页的 CSS/JS 静态资源短暂 404。若页面看起来像样式丢失，执行：

```bash
rm -rf .next
npm run dev
```

## 配置

- `OPENCLI_BIN`：默认使用 `opencli`，用于 B站 / 抖音采集。
- `FFMPEG_BIN`：默认使用 `ffmpeg`，抖音和无字幕 B站回退转写时会先抽取音频。
- `STYLE_LIBRARY_DIR`：本地风格库目录，默认 `./style-library`。
- `VOLCENGINE_ASR_API_KEY`：火山引擎录音文件识别 2.0 API Key。
- `VOLCENGINE_ASR_RESOURCE_ID`：火山引擎转写资源 ID，默认 `volc.seedasr.auc`。
- `VOLCENGINE_ASR_POLL_INTERVAL_MS`：火山转写查询间隔，默认 `1000` 毫秒。
- `DOUYIN_TRANSCRIBE_CONCURRENCY`：抖音批量转写并发数，默认 `3`，建议保持在 `1-4`。
- `CHAT_API_KEY`、`CHAT_BASE_URL`、`CHAT_MODEL`、`CHAT_WIRE_API`、`CHAT_REASONING_EFFORT`：对话模型配置，用于自动提炼风格和生成文案。默认按当前 Codex 会话使用 `https://www.fhl.mom`、`gpt-5.5`、`responses`、`xhigh`。
- `CHAT_PROXY_URL`：可选。若 Node/Next 直连模型服务失败，可设为本机代理，例如 `http://127.0.0.1:7890`。
- `IMAGE_API_KEY`、`IMAGE_BASE_URL`、`IMAGE_MODEL`、`IMAGE_SIZE`、`IMAGE_QUALITY`、`IMAGE_FORMAT`、`IMAGE_PROXY_URL`：可选。用于衍生素材模块里的 B站封面生成，默认按 OpenAI Images API / `gpt-image-2` / `2048x1152` 生成。
- `FEISHU_OPENCLI_AS`、`FEISHU_FOLDER_TOKEN`：可选。飞书文档发布固定使用 `opencli lark-cli docs +create`，默认使用当前 lark-cli 用户身份。

如果没有配置对话模型，系统会使用本地兜底模板生成可编辑结果，便于先跑通流程。

衍生素材页位于 `/assets`，会基于已保存草稿生成观众评论、B站弹幕和 B站封面。评论和弹幕使用对话模型；封面需要配置图片模型环境变量，未配置时只会禁用封面生成，不影响评论和弹幕。

抖音账号名采集会调用 `opencli douyin search <账号名> -f json` 解析 `sec_uid`；如果本机 opencli 暂未提供该适配器，可以先填写抖音主页链接或 `sec_uid` 采集。

抖音转写会优先复用已采集的媒体地址，必要时再调用 `opencli douyin user-videos` 刷新地址，然后由本机 `ffmpeg` 抽取 16kHz 单声道低码率 mp3，并通过火山引擎录音文件识别 2.0 的 `audio.data` 提交转写，避免火山服务端直接拉取带防盗链的抖音 URL。批量转写抖音视频时会先按账号预取一次媒体地址，再使用小并发转写，以减少重复 opencli 查询和火山任务排队带来的等待；如果本机网络、opencli、ffmpeg 或火山接口限流不稳定，可把 `DOUYIN_TRANSCRIBE_CONCURRENCY` 调回 `1`。B站视频仍优先使用公开字幕，没有字幕时会尝试下载后抽音频转写。
