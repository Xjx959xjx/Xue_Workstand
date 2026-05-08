# 账号风格库本地网页

本地使用的账号风格库工作台，用于把 B站 / 抖音账号的爆款内容采集、转写、沉淀成可编辑风格卡，并在写作台里参考账号风格生成文案。

## 启动

```bash
npm install
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000`。

开发服务器运行时不要同时执行 `npm run build`，Next.js 会复用 `.next` 目录，可能让开发页的 CSS/JS 静态资源短暂 404。若页面看起来像样式丢失，执行：

```bash
rm -rf .next
npm run dev
```

## 配置

- `OPENCLI_BIN`：默认使用 `opencli`，用于 B站 / 抖音采集。
- `STYLE_LIBRARY_DIR`：本地风格库目录，默认 `./style-library`。
- `SILICONFLOW_API_KEY`：硅基流动转写 Key。
- `CHAT_API_KEY`、`CHAT_BASE_URL`、`CHAT_MODEL`、`CHAT_WIRE_API`：对话模型配置，用于自动提炼风格和生成文案。默认按当前 Codex 会话使用 `https://www.fhl.mom`、`gpt-5.5`、`responses`。
- `CHAT_PROXY_URL`：可选。若 Node/Next 直连模型服务失败，可设为本机代理，例如 `http://127.0.0.1:7890`。
- `FEISHU_OPENCLI_AS`、`FEISHU_FOLDER_TOKEN`：可选。飞书文档发布固定使用 `opencli lark-cli docs +create`，默认使用当前 lark-cli 用户身份。

如果没有配置对话模型，系统会使用本地兜底模板生成可编辑结果，便于先跑通流程。
