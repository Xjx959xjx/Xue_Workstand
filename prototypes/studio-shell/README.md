# Studio 前端骨架

独立静态交互原型，不调用业务 API，不读取素材库。`python3 -m http.server 3003 --bind 127.0.0.1 --directory prototypes/studio-shell` 启动。

参考项目：
- https://github.com/satnaing/shadcn-admin ：分层导航、克制的控件。
- https://github.com/twentyhq/twenty ：列表与上下文详情。
- https://github.com/toeverything/AFFiNE ：围绕内容的工作区。

页面为原创实现，未复制上述项目代码或资源。示例内容仅用于评估布局。现有模块均有导航映射，编辑器、数据表与列表使用不同骨架；11 个模块已有对应骨架：资讯阅读、视频榜单、账号卡片、项目资料与风格编辑、任务与文稿、画布与输入、评论结果、数据编辑表、监控表、分组配置、工具选择。所有数值与内容均为示例，尚未接入真实业务。

此目录的样式仅用于独立设计验证，不作为第二套业务前端。确认骨架后应迁回现有组件和路由，再删除此原型。
