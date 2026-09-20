export const AI_EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const;
export type AiEffort = typeof AI_EFFORTS[number];
export const AI_GROUPS = ["全部链路", "风格学习", "对话写作", "评论与弹幕", "发布工具", "图片与素材"] as const;
export type AiPolicyValue = { model: string; effort: AiEffort | "default" };
export const AI_POLICIES = [
  { id: "account_sample", group: "风格学习", title: "账号样本分析", description: "逐篇学习转写稿，提取风格证据并纠错。", model: "", effort: "medium" },
  { id: "account_style", group: "风格学习", title: "账号风格卡", description: "汇总样本证据，生成完整账号风格。", model: "", effort: "medium" },
  { id: "project_sample", group: "风格学习", title: "项目样本分析", description: "分析项目中的账号案例和素材。", model: "", effort: "medium" },
  { id: "project_style", group: "风格学习", title: "项目风格卡", description: "融合项目案例，归纳项目风格。", model: "", effort: "medium" },
  { id: "writer_generate", group: "对话写作", title: "正文生成", description: "主题写作、改写和多风格独立生成。", model: "", effort: "medium" },
  { id: "writer_revise", group: "对话写作", title: "草稿续改", description: "使用当前草稿与已保存资料生成新版本。", model: "", effort: "medium" },
  { id: "web_research", group: "对话写作", title: "联网资料检索", description: "使用独立 Responses 节点调用 web_search。", model: "", effort: "default" },
  { id: "comment_plan", group: "评论与弹幕", title: "正文理解与关键词规划", description: "读完整正文，自主决定检索词和数量。", model: "gpt-5.5", effort: "low" },
  { id: "comment_replan", group: "评论与弹幕", title: "零命中重新规划", description: "参考上一轮检索反馈，重新规划一次。", model: "gpt-5.5", effort: "medium" },
  { id: "comment_review", group: "评论与弹幕", title: "评论区反灌水复核", description: "识别高置信度模板化、协调灌水来源。", model: "gpt-5.5", effort: "medium" },
  { id: "comment_generate", group: "评论与弹幕", title: "评论生成与补齐", description: "生成评论，重试与自动补齐共用此配置。", model: "gpt-6-astra", effort: "low" },
  { id: "danmaku", group: "评论与弹幕", title: "B站弹幕", description: "按时间槽生成即时弹幕，包含重试与补齐。", model: "gpt-5.5", effort: "medium" },
  { id: "publish_plan", group: "发布工具", title: "发布检索规划", description: "提取同类选题关键词，搜索平台参考。", model: "", effort: "medium" },
  { id: "publish_generate", group: "发布工具", title: "标题与发布文案", description: "提炼参考框架，生成标题及发布文案。", model: "", effort: "medium" },
  { id: "image_prompt", group: "图片与素材", title: "图片提示词辅助", description: "将创作想法整理为可执行的生图提示词。", model: "gpt-5.5", effort: "low" },
  { id: "vision", group: "图片与素材", title: "视频画面理解", description: "描述场景、镜头与标题；需要支持图片的模型。", model: "", effort: "default" },
  { id: "transcript_clean", group: "图片与素材", title: "转写稿模型清洗", description: "仅在转写流程启用模型清洗时调用。", model: "", effort: "default" },
  { id: "image_generate", group: "图片与素材", title: "图片生成", description: "默认沿用工作台选中的图片配置；填写模型名可覆盖。", model: "", effort: "none", kind: "image" },
  { id: "image_cover", group: "图片与素材", title: "草稿封面", description: "使用封面图片节点，独立于对话模型。", model: "", effort: "none", kind: "image" }
] as const;
export type AiPolicyId = typeof AI_POLICIES[number]["id"];
export type AiPolicyOverrides = Partial<Record<AiPolicyId, AiPolicyValue>>;
export type AiSettings = { schemaVersion: 1; revision: number; updatedAt: string | null; overrides: AiPolicyOverrides };
export type AiSettingsView = AiSettings & {
  effective: Record<AiPolicyId, AiPolicyValue>;
  defaults: Record<AiPolicyId, AiPolicyValue>;
  inheritedModels: Record<AiPolicyId, string>;
  models: string[];
  services: { chat: string; web: string; image: string; asr: string; transcriptCleaning: boolean };
};
