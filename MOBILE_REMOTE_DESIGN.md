# 手机远程工作台设计

> 状态：第一版已实现；Mac 端 Tailscale、私人 HTTPS Serve 和 LaunchAgent 已配置，iPhone 端尚待安装登录及真机验收  
> 目标：让唯一使用者在电脑不在身边时，通过 iPhone 安全访问现有工作台；尽量复用当前 Next.js、`style-library`、OpenCLI、ffmpeg、模型和任务系统。

## 1. 结论

第一版采用“常驻后台主机 + 私人组网 + 手机 Web App”，不开放公网端口，也不立即迁移云端。

```text
iPhone 主屏幕 Web App
        │
        │ 私人组网内的 HTTPS
        ▼
Tailscale Serve（仅本人设备可访问）
        │
        │ 反向代理到 127.0.0.1:3000
        ▼
现有 Next.js 工作台
        ├── style-library
        ├── OpenCLI / Browser Bridge
        ├── ffmpeg / 火山 ASR
        ├── 对话模型 / 图片模型
        ├── 飞书 / 企业微信
        └── 本地任务中心
```

手机和后台主机不需要位于同一局域网。iPhone 可以使用蜂窝网络或其他 Wi-Fi，只要 iPhone 和后台主机都在线并接入同一个私人网络。

该方案的硬前提是后台主机必须：

- 开机；
- 联网；
- 不处于深度睡眠；
- Next.js 服务、Tailscale 和所需采集工具正常运行。

如果后台主机会关机，手机无法独立完成采集、转写、生成或读取最新本地数据。第二阶段应将后台迁移到常驻 Mac mini，或再设计云端控制面与本地执行节点。

## 2. 为什么选择该方案

### 2.1 保留现有能力

当前项目的关键能力依赖 Node.js 子进程、本地文件和桌面浏览器环境：

- OpenCLI 及 Browser Bridge；
- ffmpeg 音视频处理；
- `style-library` 文件读写；
- 本机模型、代理、飞书和企业微信配置；
- 本地任务队列。

这些能力不能直接在 iPhone Safari 内运行。让手机作为远程操作台、电脑作为执行后台，可以最大限度复用现有实现。

### 2.2 不直接开放公网

Next.js 继续只监听 `127.0.0.1`。私人组网负责设备身份、加密连接和 HTTPS 入口，避免把 `3000` 端口暴露给互联网。

第一版不实现：

- 用户注册；
- 密码找回；
- 多角色权限；
- 邮箱或短信验证；
- 面向公众的登录页面；
- 公网反向代理；
- App Store 上架。

### 2.3 更新简单

手机 Web App 始终加载后台主机上的同一套 Next.js 前端与 API：

- 更新数据后，手机重新请求即可看到；
- 更新代码并重启后台后，手机重新打开或刷新即可使用新版本；
- 不需要重新安装 iPhone App；
- 前端与 API 同仓库发布，避免独立客户端版本长期落后。

## 3. 远程连接设计

### 3.1 推荐链路

后台主机和 iPhone 安装 Tailscale，并登录同一个仅本人使用的网络。

后台主机执行：

```bash
tailscale serve --bg 3000
```

该命令将私人网络内的 HTTPS 地址反向代理到：

```text
http://127.0.0.1:3000
```

手机访问形式：

```text
https://<后台主机名>.<私人网络名>.ts.net
```

当前 Mac 的实际私人地址：

```text
https://xjxmacbook-air.tailfdc962.ts.net/mobile
```

该地址仅在登录 `xjx959xjx.github` 私人网络的设备上可访问。工作台的 443 端口仍只通过 Serve 私下开放；公网 Funnel 只在 8443 端口代理带强令牌鉴权的能力桥，不会暴露工作台页面。

设计约束：

- 工作台页面使用 Tailscale Serve，不通过 Funnel 公开；
- 8443 Funnel 仅代理 `127.0.0.1:3401` 的窄能力桥网关；
- Next.js 保持只监听 loopback；
- iPhone 离开应用后再次打开，应先检查后台在线状态；
- 如果私人网络以后加入其他成员，再增加访问控制规则或应用内令牌。

参考：

- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)

### 3.2 后台主机常驻

生产运行脚本已与开发服务分开：

```text
npm run remote:setup
npm run remote:start
npm run remote:stop
npm run remote:status
npm run remote:dev
npm run remote:deploy
npm run remote:rollback
```

实际行为：

- `remote:setup`：检查 Tailscale / Node / `caffeinate`，配置私人 Serve 和 LaunchAgent；
- `remote:start`：停止开发服务并启动当前正式版本，只监听 `127.0.0.1:3000`；
- `remote:stop`：停止正式服务，但保留 Tailscale Serve 配置；
- `remote:status`：输出 Next、当前版本、Tailscale 和 Serve 状态；
- `remote:dev`：确认没有运行任务后停止正式服务，并启动现有开发服务；
- `remote:deploy`：检查任务、在临时目录安装依赖并执行 lint、typecheck、素材库一致性和 production build，切换版本并健康检查；
- `remote:rollback`：回退到保留的上一版本；
- 正式产物位于 `.remote-server/releases/<buildId>`，只保留最近两个版本；
- 构建或启动失败不会切换到坏版本；启动健康检查失败会自动恢复上一版本。

在 macOS 上增加 LaunchAgent：

- 用户登录后自动启动工作台；
- 异常退出后自动拉起；
- 日志写入项目已有的服务日志目录或单独的 `.remote-server`；
- 不把模型密钥、飞书凭证或企业微信密钥写入 plist；
- 电脑重启但用户尚未登录时，明确视为不可用。

后台主机需要关闭自动深度睡眠。若使用 MacBook，还要考虑合盖睡眠；长期使用更适合常驻 Mac mini。

首次上线顺序：

```bash
# 1. Mac 与 iPhone 安装 Tailscale，并登录同一私人账号
# 2. Mac 项目目录中执行
npm run remote:setup
npm run remote:deploy
npm run remote:status
```

之后代码更新只需：

```bash
npm run remote:deploy
```

发布不会复制或迁移 `style-library`；正式服务始终读取项目当前这一个真实数据目录。

### 3.3 连接状态

手机端统一显示四类状态：

| 状态 | 条件 | 手机行为 |
| --- | --- | --- |
| 在线 | Next 与核心依赖可用 | 正常使用 |
| 部分可用 | Next 在线，但 OpenCLI、ffmpeg 或模型不可用 | 允许浏览和编辑，相关操作禁用并说明原因 |
| 后台更新中 | 服务正在重启或更新 | 保留当前输入，短间隔重试 |
| 离线 | 私人网络或后台主机不可达 | 显示最后连接时间和排查顺序 |

不使用笼统的“网络错误”。错误提示应区分：

- iPhone 未连接私人网络；
- 后台主机离线或睡眠；
- Next 服务未启动；
- OpenCLI Browser Bridge 未连接；
- 模型或代理不可用；
- 当前操作超时；
- 服务更新中。

## 4. 手机产品结构

### 4.1 导航

底部导航最多保留五项：

```text
首页    热榜    账号库    写作    更多
```

任务中心不再藏在桌面侧栏底部：

- 首页显示运行中任务；
- 顶部状态按钮显示活跃任务数量；
- “更多”中提供完整任务历史入口。

“更多”包括：

- 热点雷达；
- 项目工作台；
- 评论生成；
- 工具台；
- 数据维护；
- 数据监控；
- 任务记录；
- 连接与服务状态；
- 版本和更新信息。

### 4.2 首页

首页是手机的远程控制中心，不复制桌面首页。

```text
┌──────────────────────────┐
│ 风格库             在线 ● │
│ 家中工作台 · 23ms          │
├──────────────────────────┤
│ 正在执行                   │
│ 批量转写  12 / 30   40%    │
│ [查看详情]          [停止] │
├──────────────────────────┤
│ 快捷操作                   │
│ [粘贴链接转写] [新建写作]  │
│ [刷新热榜]     [生成评论]  │
├──────────────────────────┤
│ 最近草稿                   │
│ ① 标题……         5分钟前   │
│ ② 标题……         昨天     │
├──────────────────────────┤
│ 需要处理                   │
│ 2 个转写失败 · 1 个任务中断 │
└──────────────────────────┘
```

首页优先级：

1. 后台是否在线；
2. 当前任务和失败恢复；
3. 高频快捷操作；
4. 最近草稿；
5. 次要统计。

### 4.3 视频热榜

- 默认单列卡片；
- 顶部只保留时间窗口、平台和刷新；
- 其他筛选进入底部 Sheet；
- 视频卡片显示封面、账号、标题、发布时间、播放/互动和热度变化；
- 单击进入详情，长按不承载关键操作；
- 刷新账号、加入主账号库等操作放详情页；
- 列表超过 50 条时做虚拟化或分页，避免手机滚动卡顿。

### 4.4 账号库

桌面的三栏结构改为三级路由：

```text
/library
  └── /library/<platform>/<account>
        └── /library/<platform>/<account>/videos/<video>
```

返回时保留：

- 筛选条件；
- 排序；
- 当前账号；
- 列表滚动位置。

账号详情顶部显示风格状态、视频数量、已转写数量和最近采集时间。批量操作进入显式的选择模式，避免普通浏览时误操作。

### 4.5 转写稿

- 标题栏显示保存状态和 revision；
- 正文编辑区使用至少 16px 字号，避免 iOS 自动缩放；
- 底部固定“保存”主按钮；
- 历史版本放入底部 Sheet；
- revision 冲突继续返回 409，不静默覆盖；
- 切走或关闭有未保存内容时给确认；
- 网络断开时保留当前输入，恢复后要求重新读取 revision 再保存。

### 4.6 对话写作

手机端分成四个步骤：

```text
选择目标 → 生成/续改 → 版本与导出
```

主写作页面只展示：

- 当前稿件；
- 当前操作指令；
- 一个主操作按钮；
- 生成进度；
- 保存状态。

风格来源、research 和版本历史放折叠区或底部 Sheet。局部改写继续返回并保存完整新稿。

### 4.7 任务中心

- 运行中任务置顶；
- 显示阶段、当前对象、完成数、失败数和预计剩余状态；
- 支持停止任务；
- 失败项提供明确重试入口；
- 后台重启导致 `interrupted` 时解释原因；
- 页面离开不取消任务，只有用户明确停止才传递取消信号。

### 4.8 数据维护与监控

- 桌面表格在手机改为摘要卡片；
- 详情编辑使用全屏 Sheet；
- 金额、播放量和比例使用 tabular nums；
- 批量编辑保留在桌面，手机优先单条维护与快速检查；
- 图表不能只靠颜色表达，必须显示数值、单位和文字状态。

## 5. 移动视觉与交互

沿用现有冷调浅色工作台，不另建视觉体系。

### 5.1 响应式断点

```text
≤ 420px   小屏 iPhone
421–780px 大屏手机与竖屏小平板
781–1180px 平板
> 1180px  现有桌面工作台
```

### 5.2 手机规格

- 页面左右边距：16px；
- 组件间距：8px / 12px / 16px / 24px；
- 正文：至少 16px；
- 长文行高：1.65–1.75；
- 可点击区域：至少 44×44px；
- 底部导航包含 `env(safe-area-inset-bottom)`；
- 固定顶部包含 `env(safe-area-inset-top)`；
- 高度使用 `dvh`，不依赖固定 `100vh`；
- 禁止页面级横向滚动；
- hover 仅作为桌面增强，所有操作支持点击；
- 动效维持 150–300ms，并尊重 `prefers-reduced-motion`。

### 5.3 手机专用组件

优先新增通用组件，而不是在每个页面复制实现：

```text
MobileTabBar
MobileTopBar
MobileMoreMenu
MobileFilterSheet
MobileActionSheet
MobileStickyActions
ServerStatusBadge
RemoteOfflineState
ActiveJobCard
UnsavedChangesGuard
```

桌面继续使用现有 `AppNav`，手机由断点切换到 `MobileTabBar`。同一层级不能同时出现侧栏、顶部全导航和底部导航。

## 6. Web App 安装

新增：

```text
src/app/manifest.ts
src/app/apple-icon.png
src/app/icon.png
```

Manifest 至少包含：

- `name`；
- `short_name`；
- `description`；
- `start_url`；
- `display: "standalone"`；
- `background_color`；
- `theme_color`；
- 图标尺寸和类型。

根布局增加：

- `manifest`；
- `appleWebApp`；
- 独立的 viewport 配置；
- `viewportFit: "cover"`；
- 与现有语义 token 一致的主题色。

iPhone 安装方式：

```text
Safari 打开私人 HTTPS 地址
→ 分享
→ 添加到主屏幕
→ 打开“作为 Web App”
```

第一版不做业务数据离线写入，也不缓存 API 响应。这样后台更新后，手机重新打开即可获取新版本。

第二版可以增加仅缓存静态外壳的 Service Worker，用于在后台离线时显示友好说明，但必须：

- 不缓存 `/api/**`；
- 使用构建版本号更新静态缓存；
- 检测到新版本时提示“刷新更新”；
- 不在用户编辑过程中强制刷新。

参考：

- [Apple：将网站作为 iPhone Web App 使用](https://support.apple.com/guide/iphone/iphea86e5236/ios)
- [Next.js Manifest](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest)
- [Next.js App Icons](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons)

## 7. 后台与更新

### 7.1 版本信息

健康接口增加：

```ts
type RemoteHealth = {
  app: {
    status: "ok" | "degraded";
    version: string;
    buildId: string;
    startedAt: string;
  };
  services: {
    opencli: ServiceHealth;
    browserBridge: ServiceHealth;
    ffmpeg: ServiceHealth;
    chatModel: ServiceHealth;
    imageModel: ServiceHealth;
    feishu: ServiceHealth;
    wecom: ServiceHealth;
  };
};
```

健康检查不返回 API Key、完整文件路径、Cookie 或命令输出中的敏感内容。

### 7.2 更新流程

```text
收到更新
  ↓
检查工作树和正在运行的任务
  ↓
阻止在开发服务运行时构建
  ↓
安装依赖
  ↓
lint / typecheck
  ↓
生产构建
  ↓
原子切换到新构建
  ↓
重启服务
  ↓
检查 /api/health
  ↓
成功：保留新版本
失败：恢复旧构建并显示错误
```

限制：

- 不自动覆盖未提交代码；
- 不把 `style-library` 打入更新包；
- 不在更新时迁移或批量重写用户资产；
- 运行中任务需要用户确认后才能更新；
- 更新导致的任务中断必须显示为 `interrupted`；
- 不允许空 catch 或假成功。

### 7.3 手机感知更新

手机每次冷启动读取健康接口中的 `buildId`：

- 与当前页面构建一致：正常进入；
- 后台已更新：提示“后台已更新，点击刷新”；
- 当前有未保存编辑：先保存草稿或确认放弃，再刷新；
- 后台更新中：短间隔重试，不连续弹 Toast。

## 8. 数据与备份

第一版继续把后台主机上的 `style-library` 作为唯一数据源：

- 手机不直接同步整个目录；
- 手机不创建第二份可写数据库；
- 手机只保留临时 UI 状态和未提交编辑；
- 所有写操作继续调用现有存储函数和原子写逻辑；
- 删除和引用联动仍由服务器完成；
- 修改存储结构后继续运行 `npm run check:library`。

备份建议：

- 后台主机使用系统备份或定期快照；
- 不让多个设备通过网盘同时写 `style-library`；
- 远程访问与数据备份是两件事，私人组网不等于备份。

## 9. 电脑关机时的升级路线

### 9.1 推荐：常驻 Mac mini

适合完整保留 OpenCLI、Browser Bridge、ffmpeg 和本地文件结构。

```text
iPhone
  ↓ 私人 HTTPS
常驻 Mac mini
  ├── Next.js
  ├── Chrome / Browser Bridge
  ├── OpenCLI / ffmpeg
  └── style-library
```

这是个人使用下兼容性最好、维护成本最低的长期方案。

### 9.2 备选：云端后台 + 本地执行节点

只有确认需要电脑彻底关机后再做：

```text
iPhone
  ↓
云端控制面
  ├── 账号、草稿、任务和同步数据
  └── 模型调用
        ↓ 任务队列
本地执行节点
  └── OpenCLI / Browser Bridge / ffmpeg
```

该方案需要新增：

- 数据库和对象存储；
- `style-library` 迁移或同步协议；
- 本地执行节点注册；
- 云端任务队列；
- 冲突处理；
- 断点续传；
- 密钥管理；
- 正式鉴权与备份。

工作量明显高于第一版，不作为当前起点。

## 10. 实施阶段

### 阶段 A：远程通路（1–2 天）

- 安装并验证后台主机与 iPhone 的私人网络；
- Next.js 保持 loopback；
- 配置持久的 HTTPS Serve；
- 真机使用蜂窝网络访问；
- 验证重启恢复和后台主机睡眠行为；
- 记录明确的故障排查步骤。

验收：iPhone 关闭 Wi-Fi后，仍能通过私人 HTTPS 地址打开工作台。

### 阶段 B：手机外壳（2–3 天）

- Manifest 和主屏幕图标；
- 手机顶部栏和五项底部导航；
- 首页、连接状态和任务入口；
- safe area、`dvh`、触摸尺寸；
- 保留桌面导航不受影响。

验收：从主屏幕打开无明显浏览器外壳，375px 宽度无页面级横向滚动。

### 阶段 C：核心工作流（4–7 天）

- 热榜；
- 账号库；
- 视频详情与转写稿；
- 对话写作；
- 任务中心；
- 数据维护和监控的手机核心操作。

验收：人在外面可完成“看热榜 → 打开账号/视频 → 查看或编辑转写 → 生成/续改文案 → 查看任务”的完整流程。

### 阶段 D：完整适配（3–6 天）

- 热点雷达；
- 项目工作台；
- 评论和封面；
- 工具台；
- 文件上传下载；
- 飞书发布；
- 真机弱网、横屏和异常恢复测试。

### 阶段 E：可靠性与更新（2–4 天）

- 生产常驻服务；
- LaunchAgent；
- 远程状态检查；
- 更新脚本和构建版本提示；
- 静态离线外壳（可选）；
- 备份检查。

总量：

- 可远程打开：1–2 天；
- 核心功能顺手可用：约 7–12 天；
- 全页面和常驻更新完善：约 12–20 天。

## 11. 预计影响文件

第一阶段实现优先涉及：

```text
package.json
.env.example
README.md
src/app/layout.tsx
src/app/manifest.ts
src/app/apple-icon.png
src/app/icon.png
src/components/AppNav.tsx
src/components/MobileTabBar.tsx
src/components/TaskCenter.tsx
src/components/RemoteStatus.tsx
src/app/styles/00-tokens.css
src/app/styles/02-shell.css
src/app/styles/11-responsive.css
src/app/styles/16-workbench-system.css
src/app/api/health/route.ts
src/lib/client.ts
scripts/remote-server.mjs
scripts/update-remote.mjs
```

后续页面适配写回各页面已有 CSS，不新增第二套颜色、按钮、卡片或动效系统。

## 12. 验证清单

### 网络与后台

- 蜂窝网络可访问；
- Next.js 未暴露到普通局域网或公网；
- 私人网络断开时提示准确；
- 后台重启后 Serve 自动恢复；
- Mac 睡眠时能识别为离线；
- OpenCLI、Browser Bridge、ffmpeg 和模型故障可区分。

### 手机交互

- 375px、小屏和大屏 iPhone；
- 竖屏与横屏；
- 所有主要点击区域至少 44px；
- 底部导航不遮挡内容；
- 键盘不遮挡保存和生成按钮；
- 无页面级横向滚动；
- 返回后恢复筛选、滚动和编辑状态；
- VoiceOver 名称和错误提示可读；
- reduced motion 下无多余动画。

### 数据安全

- revision 冲突返回 409；
- 离线编辑不覆盖服务器新版本；
- 删除操作明确确认；
- 更新不携带或覆盖 `style-library`；
- 存储改动通过 `npm run check:library`；
- 日志不包含密钥和敏感凭证。

## 13. 当前决策

当前推荐默认：

| 决策 | 选择 |
| --- | --- |
| 使用方式 | iPhone 主屏幕 Web App |
| 远程连接 | Tailscale Serve 私人 HTTPS |
| 后台位置 | 当前电脑，后续可换常驻 Mac mini |
| Next 暴露范围 | 仅 `127.0.0.1` |
| 公网端口 | 不开放 |
| 应用登录 | 第一版不另做，依赖私人设备身份 |
| 数据源 | 后台主机上的 `style-library` |
| 离线写入 | 不支持 |
| API 缓存 | 不缓存 |
| 更新方式 | 后台统一更新，手机刷新生效 |
| App Store | 不需要 |
