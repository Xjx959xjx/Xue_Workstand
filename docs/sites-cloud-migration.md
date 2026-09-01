# Sites 云端迁移基线

## 目标

将当前工作台迁移为可由 Sites 私有托管的云端应用，同时保留现有页面、API 契约、任务语义和可恢复的数据操作。现有 `style-library` 与本地密钥不进入源码、构建产物或 Sites，除非用户后续明确授权一次具体的数据迁移。

## 权威边界

- GitHub 源码与当前工作树是实现基线；迁移工作在 `codex/sites-cloud-migration` 分支进行。
- 本地模式继续使用文件系统、OpenCLI、FFmpeg 和已有 CLI 登录，不因云端适配而失效。
- Sites 模式使用 D1 保存索引、版本、任务和事务状态，使用 R2 保存 JSON、文本、转写稿、文档、图片及其他文件字节。
- 运行时配置和密钥只通过 Sites 环境变量管理；`.openai/hosting.json` 只保存 Sites 项目标识和逻辑绑定名。

## 存储策略

云端存储采用不可变 R2 对象加 D1 指针：先写入带 revision 的 R2 对象，再以 D1 批处理切换当前指针。旧 revision 保留在历史表中，失败时当前指针不变。多文件更新先写全部对象和事务清单，最后一次性提交 D1 指针，避免跨引用只更新一半。

## 外部能力策略

Cloudflare Worker 不执行本机子进程。OpenCLI、FFmpeg、飞书 CLI 和企业微信 CLI 必须分别迁移到受鉴权的 HTTP 能力或平台原生 HTTP API。调用失败必须返回明确中文错误和 `fallback` / `fallbackReason` 状态，不得伪造成功。

## 验收门槛

1. 本地文件模式的现有测试继续通过。
2. Sites 构建产物包含 Worker 入口、D1 migration 和静态资源。
3. 云端存储覆盖读取、原子写入、revision 冲突、历史恢复、回收站与跨引用事务。
4. 云端任务覆盖排队、进度、取消、重试、重启恢复和增量事件。
5. 所有前端可见 API 保持现有类型和错误契约。
6. 私有部署成功后验证核心页面、写入读取、任务恢复和文件下载。

## 当前进度

- [x] 完成 Vinext 兼容性扫描：页面、布局和 39 个路由处理器主体可迁移。
- [x] 建立 Sites/Vinext、D1、R2 和 Drizzle 配置骨架。
- [x] 定义云对象、历史、事务、任务和任务事件表。
- [x] 生成并审查首个 D1 migration。
- [x] 实现云对象存储适配器并迁移基础存储调用链。
- [x] 实现云任务 D1 运行时：任务记录、状态、事件、结果摘要和 Worker `waitUntil()` 调度均可跨请求持久化。
- [ ] 迁移外部能力到 HTTP 提供方（当前已对本机 OpenCLI、FFmpeg、链接采集和转写增加云端显式失败边界）。
- [ ] 完成数据迁移工具、私有部署和线上验证。

## 本地 Worker 验证

`npm run build:sites` 后使用 `wrangler dev --config dist/server/wrangler.json`，应用首个 D1 migration，已验证健康检查、素材库概览、任务列表和抖音热榜接口均返回 200；项目创建/删除接口验证了 D1 元数据与 R2 对象写入链路。真实 Sites 项目创建、密钥配置、数据导入和私有部署仍需用户授权后执行。

发布前可运行 `npm run check:sites:release`。该检查只扫描 `dist/` 构建产物，不读取 `.env` 或 `style-library`；若发现受保护数据路径、常见密钥格式、缺少 migration 或错误绑定会失败。它不会上传或修改任何远程资源。

`npm run prepare:sites:migration` 默认只输出 dry-run 说明，并且不会读取 `style-library`。只有用户明确授权后才可运行 `npm run prepare:sites:migration -- --include-library`：该模式仅在 `dist/` 生成包含相对路径、大小和 SHA-256 的本地清单，拒绝符号链接和 `.env*`，仍不会复制或上传任何素材。实际上传必须另行确认具体 Sites 项目、目标环境和迁移窗口。

远程能力桥约定：`POST SITES_EXTERNAL_CAPABILITY_URL`，请求体为 `{ "operation": string, "payload": unknown }`，必须使用 `Authorization: Bearer $SITES_EXTERNAL_CAPABILITY_TOKEN` 鉴权；远程地址必须是 HTTPS，只有 localhost 调试允许 HTTP。当前调用名包括 `opencli`、`material-analysis`、`transcribe-video`、`transcribe-link`、`link-media`、`link-download`、`feishu-publish`、`feishu-doc-read` 和 `wecom-doc`；返回 JSON 必须符合对应调用点的结果类型，错误使用 HTTP 非 2xx 和 `{ "error": string }`。`link-download` 必须返回可由 Worker 代理的 `http(s)` 临时地址、文件名和内容类型，不得返回能力服务本机路径。
