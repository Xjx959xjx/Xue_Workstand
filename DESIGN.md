# 本地工作台统一设计系统

## 1. 产品定位

本项目是桌面优先的本地内容运营工作台，用于采集、转写、整理账号 / 项目风格，生成可编辑文案、评论素材，并维护毛利数据。界面气质应接近原生 macOS 专业编辑工具，而不是营销型 SaaS 官网。苹果化体现在克制的系统材质、清晰层级和自然反馈，不照搬消费级官网的大留白。

核心原则：

- 信息密度要高，但不要制造视觉噪音。
- 颜色只用于说明层级、状态和风险，不做无意义装饰。
- 本地素材和转写稿是长期资产，删除、批量操作和失败恢复必须清楚。
- 新页面默认复用 token、primitives 和 `16-workbench-system.css` 的通用视觉层；页面布局和业务密度写回对应页面 CSS，避免后置全局补丁。
- 动效保持短、轻、可解释，只服务状态变化。
- 壳层、浮层和少量抬升面板可使用受控的半透明材质；正文工作区仍以稳定、清晰的浅色表面为主。

## 2. 颜色系统

整体使用冷调浅色中性色作为底盘，蓝色承担主操作、选中和聚焦语义。绿色、琥珀色、玫红色分别用于完成、等待和失败/危险。

| 角色 | Token | 值 | 用法 |
| --- | --- | --- | --- |
| 应用背景 | `--bg` | `oklch(0.965 0.003 264)` | 页面主背景 |
| 外壳背景 | `--chrome` | `oklch(0.948 0.005 264)` | 导航、应用框架 |
| 默认面板 | `--panel` | `oklch(0.992 0.002 264)` | 卡片、窗格、表单底色 |
| 抬升面板 | `--panel-raised` | `oklch(0.998 0.001 264)` | 弹窗、强调容器 |
| 柔和面板 | `--panel-soft` | `oklch(0.955 0.004 264)` | 内嵌区块、弱分组 |
| 强文本 | `--text-strong` | `oklch(0.205 0.01 264)` | 标题、关键数值、激活标签 |
| 正文 | `--text` | `oklch(0.275 0.012 264)` | 主要 UI 文本 |
| 弱文本 | `--muted` | `oklch(0.53 0.012 264)` | 描述、时间、辅助信息 |
| 默认描边 | `--line` | `oklch(0.875 0.006 264)` | 卡片和区块边框 |
| 强描边 | `--line-strong` | `oklch(0.735 0.012 264)` | 输入框、关键控件 |
| 强调色 | `--accent` | `oklch(0.62 0.19 253)` | 聚焦、选中、主强调 |
| 强调文本 | `--accent-strong` | `oklch(0.545 0.205 254)` | 链接和强调控件文字 |
| 强调底色 | `--accent-tint` | `oklch(0.966 0.026 253)` | 选中行、高亮面板 |
| 信息 | `--blue` / `--blue-soft` | 现有 token | 链接、信息提示、主按钮 |
| 成功 | `--green` / `--green-soft` | 现有 token | 已完成、可用、已同步 |
| 等待 | `--amber` / `--amber-soft` | 现有 token | 排队、处理中、待处理 |
| 危险 | `--rose` / `--rose-soft` | 现有 token | 失败、删除、不可逆操作 |

规则：

- 组件内不要直接写 raw hex。若需要新颜色，先在 `src/app/styles/00-tokens.css` 增加语义 token。
- 结构性容器优先使用中性色面板，只有选中、激活、状态和提示使用带色底。
- 半透明材质统一复用 `--glass-panel`、`--glass-chrome`、`--glass-popover` 与模糊 token，不在业务页散写透明度和 blur。
- 成功和失败不能只靠颜色表达，必须配合文字或图标。
- 正文与背景对比度保持 WCAG AA，避免浅灰字叠浅灰底。

## 3. 字体系统

项目是中文优先、编辑密集型工具，字体使用清晰稳定的系统 UI 栈，不引入装饰型品牌字体。

| 角色 | Token | 大小 | 字重 | 行高 | 用法 |
| --- | --- | --- | --- | --- | --- |
| 页面标题 | `--text-page-title` | `28px` | `700` | `1.08` | 页面主标题 |
| 区块标题 | `--text-section-title` | `16px` | `700` | `1.25` | 面板和窗格标题 |
| 卡片标题 | `--text-card-title` | `13px` | `700` | `1.35` | 列表项、卡片标题 |
| 正文 | `--text-body` | `13px` | `400` | `1.55` | 默认 UI 文案 |
| 元信息 | `--text-meta` | `12px` | `500-650` | `1.55` | 标签、说明、辅助文本 |
| 标记文本 | `--text-caption` | `11px` | `500-650` | `1.35` | 状态、紧凑元信息 |
| 长文编辑 | 页面局部 | `14px` | `400` | `1.72` | 草稿、转写稿、生成结果 |

字体 token：

- `--font-ui`: `"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif`
- `--font-mono`: `"SF Mono", "SFMono-Regular", "Cascadia Code", Menlo, Monaco, Consolas, monospace`
- 语义字重：`--font-weight-regular`、`--font-weight-medium`、`--font-weight-label`、`--font-weight-heading`、`--font-weight-page-title`。
- 语义行高：`--line-height-caption`、`--line-height-meta`、`--line-height-body`、`--line-height-card-title`、`--line-height-section-title`、`--line-height-page-title`、`--line-height-reading`。

规则：

- 工作台默认维持 `13px` 的紧凑密度。
- 草稿、转写稿、生成结果需要更大的行高，降低长文阅读疲劳。
- 层级优先通过字重、字号和间距建立，不要靠不断增加颜色。
- 统计数字、价格、计时和状态标记使用 tabular nums。

## 4. 间距与布局

间距系统基于紧凑的 4px 网格。

| Token | 值 | 用法 |
| --- | --- | --- |
| `--space-1` | `4px` | 紧贴的行内间距 |
| `--space-2` | `8px` | 按钮组、小型分组 |
| `--space-3` | `12px` | 默认网格间距 |
| `--space-4` | `16px` | 区块间距 |
| `--space-5` | `20px` | 标题栏操作区间距 |
| `--space-6` | `24px` | 页面边距 |
| `--space-8` | `32px` | 大型区块分隔 |

布局规则：

- 桌面工作台页面使用主内容区 `100%` 可用宽度；1920px 及以上不再设置固定最大宽度，额外空间优先分配给列表、表格和并列面板。
- 桌面工作台页面使用 `--workspace-page-height` 撑满可用高度；路由按实际子区块数量声明网格行，避免通用空行或固定高度上限浪费大屏空间。
- 默认面板内边距使用 `--card-pad-md`，当前值为 `16px`；独立表单分区使用 `--section-pad`，当前值为 `18px`。
- 默认 grid gap 使用 `--space-3`，密集行内控件使用 `--space-2`。
- 窗格、列表行、表单标签和控件横向内边距复用对应语义 token；页面 CSS 不新增同义的间距、字重或行高散值。
- 移动端不能出现横向滚动，主要操作必须可触达。

## 5. 按钮

所有按钮以 `.btn` 为基础 primitive。

| 变体 | Class | 用法 |
| --- | --- | --- |
| 次级按钮 | `.btn` | 默认操作、取消、刷新、打开 |
| 主按钮 | `.btn.primary` | 当前区域最重要的操作 |
| 危险按钮 | `.btn.danger` | 删除、移除、不可逆操作 |
| 紧凑按钮 | `.btn.compact` | 表格、列表、卡片内的小操作 |
| 图标按钮 | `.btn.icon-btn` / `.btn.icon-only` | 图标操作，必须有可访问名称 |

按钮规则：

- 一个决策区域只保留一个主按钮，不要把所有操作都做成蓝色。
- 桌面默认控件高度为 `38px`，紧凑控件为 `34px`。
- 纯图标按钮必须有 `aria-label`。
- 禁用态必须使用语义化 disabled 或 `aria-disabled`，并复用共享禁用样式。
- 加载按钮使用 `aria-busy="true"`，避免重复提交。
- 聚焦态必须保留 `--focus-ring-shadow`，不要移除 focus ring。

## 6. 卡片与面板

卡片用于承载工作内容，不用于装饰。

| Primitive | Class | 用法 |
| --- | --- | --- |
| 默认面板 | `.panel` | 通用容器 |
| 面板内容 | `.panel-inner` | 标准内边距和间距 |
| 空状态 | `.empty-state-panel` | 缺内容时的说明和下一步 |
| 紧凑卡片 | `.compact-card` | 次级摘要信息 |
| 风格摘要 | `.style-summary-card` | 账号或项目风格摘要 |
| 弹窗面板 | `.modal-panel` | 聚焦编辑和确认流程 |

面板规则：

- 面板圆角使用 `--radius-xl`，当前值为 `24px`；紧凑卡片使用 `--radius-lg`，当前值为 `18px`。
- 控件圆角常用 `13px`，基础 token `--radius-md` 为 `12px`。
- 默认靠边框、柔和背景和很轻的阴影建立层级，强阴影只给弹窗、抽屉和 toast。
- 选中态用边框和底色表达，不使用重阴影。
- 避免无意义嵌套卡片。若必须嵌套，每一层都要有明确任务。
- 空状态要说明缺什么，并提供安全的下一步。

## 7. 状态样式

状态样式统一用于转写、任务、环境检查、发布、监控记录等流程。

| 语义 | Class | Token | 用法 |
| --- | --- | --- | --- |
| 中性 | `.status-pill` | `--status-neutral-*` | 普通元信息 |
| 完成 | `.status-pill.done`, `.status-pill.completed` | `--status-success-*` | 已完成、可用、已同步 |
| 等待 | `.status-pill.pending`, `.status-pill.not_started`, `.status-pill.transcribing` | `--status-warning-*` | 排队、等待、处理中 |
| 失败 | `.status-pill.failed` | `--status-danger-*` | 失败、阻塞、危险 |

状态规则：

- 状态文案保持短中文短语，例如 `已转写`、`待转写`、`转写中`、`失败`。
- 活跃工作状态应设置 `aria-busy`。
- 长任务需要同时给状态标记和进度/恢复提示。
- 警告和失败文案要告诉用户下一步能做什么。

## 8. 动效与交互

动效用于解释状态变化，不能让工作台显得浮夸。

| Token | 值 | 用法 |
| --- | --- | --- |
| `--motion-fast` | `140ms` | 按压、即时 hover |
| `--motion-base` | `220ms` | 常规状态切换 |
| `--motion-slow` | `320ms` | 页面、toast、弹窗进入 |
| `--ease-apple` | `cubic-bezier(0.32, 0.72, 0, 1)` | 进入、抬升和状态切换 |

交互规则：

- 只动画化 color、border、shadow、opacity 和 transform。
- 不动画化 width、height、top、left。
- 页面进入只做极轻的淡入和纵向位移；按压反馈使用小幅 scale，避免持续漂浮或弹跳。
- 必须尊重 `prefers-reduced-motion`。
- hover 只能作为增强，关键操作必须支持键盘和触摸。

## 9. 可访问性检查

- 纯图标按钮必须有 `aria-label`。
- 不要移除 focus ring。
- 表单字段必须有可见 label，错误信息靠近字段。
- Toast 根据严重程度使用 `role="status"` 或 `role="alert"`。
- 状态和错误不能只靠颜色表达。
- 键盘 Tab 顺序应与视觉顺序一致。
- 移动端常用控件尽量保持 44px 以上可点区域。

## 10. 实现地图

| 关注点 | 文件 |
| --- | --- |
| 全局 token | `src/app/styles/00-tokens.css` |
| 基础字体和 focus | `src/app/styles/01-base.css` |
| 应用外壳和导航 | `src/app/styles/02-shell.css` |
| 面板和通用布局 | `src/app/styles/03-primitives.css` |
| 按钮 | `src/app/styles/primitives/buttons.css` |
| 表单 | `src/app/styles/primitives/forms.css` |
| 状态、notice、toast | `src/app/styles/primitives/feedback.css` |
| 动效和 reduced-motion | `src/app/styles/primitives/interactions.css` |
| 统一工作台系统层 | `src/app/styles/16-workbench-system.css` |
| 业务路由样式 | `src/app/<route>/<route>.css`，由同级 `layout.tsx` 导入 |

`16-workbench-system.css` 是通用系统层，应在 primitives 之后、页面 CSS 之前导入。新增模块、页面、弹窗、抽屉和工具面板优先让通用 class 命中这层规则；确需局部样式时，写回对应页面 CSS，只补布局、业务密度和必要响应式，不重新定义一套颜色、按钮、圆角或动效。不要再新增后置全局页面补丁。

## 11. 禁止事项

- 不要把工作台页面做成营销首页。
- 没有产品原因时，不要改成霓虹、玻璃拟态或暗黑优先。
- 不要用 emoji 做结构性图标，继续使用 `lucide-react`。
- 不要在页面 CSS 里临时写一套按钮、卡片颜色。
- 危险操作不要做得像主操作。
- 失败状态不要静默隐藏，必须给恢复路径。
