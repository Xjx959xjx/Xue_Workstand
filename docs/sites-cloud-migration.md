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
- [x] 实现受鉴权的 HTTP capability bridge，并接入 OpenCLI、FFmpeg 素材分析、ASR、链接媒体解析/下载、飞书和企业微信文档能力。
- [x] 完成安全的数据迁移预检工具、私有部署和 D1/R2/云任务线上验证。
- [ ] 在用户选定的常驻主机上配置 bridge HTTPS 地址和真实密钥。
- [ ] 仅在用户明确授权后迁移现有 `style-library`。

## 本地 Worker 验证

`npm run build:sites` 后使用 `wrangler dev --config dist/server/wrangler.json`，应用首个 D1 migration，已验证健康检查、素材库概览、任务列表和抖音热榜接口均返回 200；项目创建/删除接口验证了 D1 元数据与 R2 对象写入链路。Sites 私有项目也已部署，生产环境验证了页面响应、D1 migration、云对象目录、R2 热点快照写入和 D1 云任务完成。当前部署保持 owner-only；没有上传 `.env`、`.env.local` 或现有 `style-library`。

发布前可运行 `npm run check:sites:release`。该检查只扫描 `dist/` 构建产物，不读取 `.env` 或 `style-library`；若发现受保护数据路径、常见密钥格式、缺少 migration 或错误绑定会失败。它不会上传或修改任何远程资源。

`npm run prepare:sites:migration` 默认只输出 dry-run 说明，并且不会读取 `style-library`。只有用户明确授权后才可运行 `npm run prepare:sites:migration -- --include-library`：该模式仅在 `dist/` 生成包含相对路径、大小和 SHA-256 的本地清单，拒绝符号链接和 `.env*`，仍不会复制或上传任何素材。实际上传必须另行确认具体 Sites 项目、目标环境和迁移窗口。

远程能力桥约定：`POST SITES_EXTERNAL_CAPABILITY_URL`，请求体为 `{ "operation": string, "payload": unknown }`，必须使用 `Authorization: Bearer $SITES_EXTERNAL_CAPABILITY_TOKEN` 鉴权；远程地址必须是 HTTPS，只有 localhost 调试允许 HTTP。当前调用名包括 `opencli`、`material-analysis`、`transcribe-video`、`transcribe-link`、`link-media`、`link-download`、`feishu-publish`、`feishu-doc-read` 和 `wecom-doc`；返回 JSON 必须符合对应调用点的结果类型，错误使用 HTTP 非 2xx 和 `{ "error": string }`。`link-download` 返回可由 Worker 代理的短期地址、文件名、内容类型和一次性下载令牌，不返回能力服务本机路径。

## Capability bridge 提供方

能力提供方复用本地工作台的 Node runtime 和现有 CLI 登录：

1. 在常驻主机的环境文件配置 `SITES_CAPABILITY_BRIDGE_TOKEN`，值至少 32 个字符；不要把值提交到仓库。
2. 通过受控的 HTTPS 反向代理把该主机的 `/api/capability-bridge` 暴露为公网地址，并将这个完整地址写入 `SITES_CAPABILITY_BRIDGE_PUBLIC_URL`。
3. Sites 生产环境配置 `SITES_EXTERNAL_CAPABILITY_URL` 为同一地址，`SITES_EXTERNAL_CAPABILITY_TOKEN` 为同一令牌，然后重新部署已保存版本。
4. 使用相同 Bearer 令牌 GET capability URL 可做只读健康检查；响应只报告启用状态与操作列表，不返回密钥。

Sites 的 `/api/health` 与远程状态接口会执行这个真实探测，并区分未配置、URL 无效、鉴权失败、网络不可达、超时和操作缺失。探测结果有界超时，不会触发 OpenCLI、转写或发布等业务操作。

当前 Mac 作为能力主机时，运行 `npm run capability:setup`。令牌由脚本生成并保存到
macOS 钥匙串；常驻服务启动时只把它注入本机 Node 进程。Tailscale 私人 Serve 继续在
`443` 提供完整工作台，独立 Funnel 在 `8443` 只转发到 `127.0.0.1:3401` 窄网关。
窄网关仅放行 capability bridge 与一次性素材下载路径，其他页面和 API 返回 404。
若 tailnet 未启用 Funnel，配置会停止并要求管理员在 Tailscale 管理页显式授权。

该入口具有以下边界：

- 只在本地/常驻 Node 主机启用；当 `SITES_STORAGE_MODE=cloud` 或 `SITES_RUNTIME=cloud` 时返回 503。
- Bearer 令牌使用定长哈希比较，请求正文和执行时间有上限。
- 媒体 URL 拒绝 localhost、内网地址和非 HTTP(S) 协议。
- 本地生成的视频/音频只通过一次性临时下载令牌读取，读取完成或过期后清理临时文件。
- OpenCLI 使用参数数组执行，不接受 shell 命令字符串。
