# 弹窗底层交互统一

现有 ModalBackdrop 统一接入 useDialogInteraction 和 dialog-interaction。写作历史、任务中心以及原生图片对比弹窗使用同一生命周期管理。

- 集中处理初始焦点、Tab / Shift+Tab、焦点逃逸、Escape、焦点恢复和背景滚动锁。
- 只有最上层处理关闭，忙碌状态沿用原弹窗的 disabled 约定。
- 共用一组 document 监听器，重绘仅更新回调，不重新抢焦点。
- 写作历史外置菜单纳入所属弹窗焦点范围；菜单和重命名的 Escape 消费保持优先级。
- 删除重复焦点/键盘处理函数及 useRestoreFocus；保持面板 JSX、样式、业务关闭回调和原有确认行为。
- 本轮 20 个文件，净减少 281 行生产源码；未新增依赖，未修改用户素材或 CSS。

## 验证

- 受影响文件 lint、类型检查、git diff --check 通过。
- 隔离目录 npm run build 通过；因复用 node_modules 符号链接，临时构建副本设置 outputFileTracingRoot=/，项目配置未改。保留既有动态依赖追踪警告。
- 核心浏览器验证覆盖 StrictMode、初始焦点、双向 Tab、隐藏/禁用控件、重绘、焦点逃逸、嵌套弹窗、忙碌状态、原生 dialog、无控件弹窗、遮罩和焦点/滚动恢复，全部通过。额外验证长弹窗 Tab 会把焦点控件滚动到可见区域。
- 写作历史真实组件：外置菜单焦点与 Tab、菜单 Escape、重命名 Escape、嵌套删除确认、父滚动锁和恢复触发器全部通过。
- 隔离正式页面 /gross-margin 的导入弹窗及任务中心冒烟通过；无浏览器运行错误，存在既有 CSS preload 警告。
- npm test：170 项，169 通过，1 项为此前已复现的 GPT-6 健康检查失败；本轮没有修改该模块或测试。

浏览器验证夹具、执行脚本和输出位于 output/playwright/modal-smoke/。验证只使用夹具或临时 STYLE_LIBRARY_DIR。
