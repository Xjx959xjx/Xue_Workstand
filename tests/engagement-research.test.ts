import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeCoordinatedCommentSection,
  buildPlatformResearchTasks,
  buildLocalEngagementResearchQueries,
  countTargetPlatformResearchComments,
  filterQuarantinedVideoCommentSamples,
  hasResearchSemanticMatch,
  normalizeEngagementResearchPlan
} from "../src/lib/engagement-research";
import {
  containsPlatformUserMention,
  isExcludedRelatedVideo,
  selectFallbackMetricThreshold
} from "../src/lib/opencli-normalizers";

test("全网评论调研会从主体与版本锚点生成有界检索词", () => {
  const queries = buildLocalEngagementResearchQueries({
    summary: "流放之路2将在1.0加入决斗者与剑类武器",
    topic: "流放之路2 1.0",
    subjects: ["流放之路2", "决斗者"],
    keyFacts: ["12月18日上线1.0", "加入剑类武器"],
    discussionAngles: ["近战强度", "终局玩法"],
    skepticalAngles: ["平衡调整"],
    anchorTerms: ["1.0", "剑类武器", "旋风斩"]
  });

  assert.ok(queries.length >= 1 && queries.length <= 3);
  assert.match(queries[0], /流放之路2/);
  assert.equal(queries.some((query) => /评论|论坛|评测/.test(query)), false);
});

test("折叠屏稿件优先提取标题主对象、正文争议点与竞品关系", () => {
  const queries = buildLocalEngagementResearchQueries({
    summary: "苹果折叠屏迟到入场，为轻薄牺牲部分影像与解锁配置，并与华为、小米方案形成对比",
    topic: "吹不动！苹果首款折叠屏根本没封神，迟到8年进场照样翻车",
    subjects: ["Mate XT2", "苹果首款折叠屏根本没封神", "迟到8年进场照样翻车"],
    keyFacts: [
      "苹果折叠屏为了轻薄砍掉潜望长焦",
      "Face ID换成侧边Touch ID",
      "零折痕方案依旧有行业通用折痕",
      "华为Mate XT2有三折叠和鸿蒙多窗办公",
      "小米硬件堆料但铰链和大屏适配仍有短板"
    ],
    discussionAngles: ["苹果华为小米折叠屏对比"],
    skepticalAngles: ["零折痕是否成立", "轻薄是否值得牺牲配置"],
    anchorTerms: ["苹果折叠屏", "Face ID", "Touch ID", "潜望长焦", "折痕", "华为", "小米", "Mate XT2"]
  });

  assert.deepEqual(queries, [
    "苹果折叠屏",
    "苹果折叠屏 折痕 轻薄",
    "苹果 华为 小米 折叠屏 对比"
  ]);
});

test("人物事件稿优先使用具体主体，不截断成长标题残片", () => {
  const queries = buildLocalEngagementResearchQueries({
    summary: "旭旭宝宝挑战 CF 世界冠军",
    topic: "枪王任怡旭职业生涯首秀 顶流主播硬刚CF世界冠军 旭旭宝宝大闹CF运输船",
    subjects: ["M4 A1", "枪王任怡旭职业生涯首秀", "旭旭宝宝大闹CF运输船", "穿越火线", "cf"],
    keyFacts: ["运输船首局拿下12杀"],
    discussionAngles: ["职业选手与主播对战"],
    skepticalAngles: [],
    anchorTerms: ["旭旭宝宝", "CF", "运输船"]
  });

  assert.match(queries[0], /旭旭宝宝|枪王任怡旭/);
  assert.doesNotMatch(queries[0], /大闹C$/);
  assert.equal(queries.some((query) => query.includes("旭旭宝宝在CF运输船")), false);
});

test("目标平台没有热评时不能用另一平台数量冒充达标", () => {
  const comments = Array.from({ length: 35 }, (_, index) => ({ text: `B站评论${index}` }));
  const rows = [
    { source: "bilibili" as const, comments },
    { source: "douyin" as const, comments: [] }
  ];

  assert.equal(countTargetPlatformResearchComments(rows, "douyin"), 0);
  assert.equal(countTargetPlatformResearchComments(rows, "bilibili"), 35);
});

test("历史样本必须与当前正文存在语义命中", () => {
  const brief = {
    summary: "旭旭宝宝挑战 CF 世界冠军",
    topic: "旭旭宝宝大闹CF运输船",
    subjects: ["旭旭宝宝", "穿越火线"],
    keyFacts: ["运输船首局拿下12杀"],
    discussionAngles: ["职业选手与主播对战"],
    skepticalAngles: [],
    anchorTerms: ["CF", "运输船"]
  };

  assert.equal(hasResearchSemanticMatch({
    text: "运输船还是那个熟悉的味道",
    query: "旭旭宝宝 CF",
    videoTitle: "旭旭宝宝挑战世界冠军"
  }, brief), true);
  assert.equal(hasResearchSemanticMatch({
    text: "折叠屏还是得看系统和生态",
    query: "苹果折叠屏",
    videoTitle: "小米折叠手机体验"
  }, brief), false);
});

test("搜索词本身不能替错误视频和无关评论证明相关", () => {
  const brief = {
    summary: "花百万点陪玩，惨遭拒单",
    topic: "Whys跨圈擂台约战，杀进率土除三害",
    subjects: ["Whys", "率土之滨", "王浩宇", "wise", "呆皇"],
    keyFacts: ["wise 给自己挂了100万一小时的陪玩费", "呆皇下单后双方线下打擂台"],
    discussionAngles: ["三角洲与率土之滨跨圈约战"],
    skepticalAngles: [],
    anchorTerms: ["Whys", "率土之滨", "王浩宇", "呆皇"]
  };

  assert.equal(hasResearchSemanticMatch({
    text: "去国贸和skp都撑不过一个小时",
    query: "100万一小时",
    videoTitle: "100万一小时内花完，怎么办？"
  }, brief, ["Whys", "率土之滨", "王浩宇"], ["100万", "陪玩", "擂台"]), false);
  assert.equal(hasResearchSemanticMatch({
    text: "一个敢挂一个敢点",
    query: "Whys 呆皇",
    videoTitle: "王浩宇史上最贵的单子：100万一小时"
  }, brief, ["Whys", "率土之滨", "王浩宇"], ["100万", "陪玩", "擂台"]), true);
  assert.equal(hasResearchSemanticMatch({
    text: "这对也太好磕了",
    query: "王浩宇 率土之滨",
    videoTitle: "王浩宇和山爱一的cp这么好磕"
  }, brief, ["Whys", "率土之滨", "王浩宇"], ["100万", "陪玩", "擂台"]), false);
});

test("AI 检索计划必须使用正文里的主题主体，泛词不能单独入选", () => {
  const brief = {
    summary: "花百万点陪玩，惨遭拒单",
    topic: "Whys跨圈擂台约战，杀进率土除三害",
    subjects: ["Whys", "率土之滨", "王浩宇", "wise", "呆皇"],
    keyFacts: ["wise 给自己挂了100万一小时的陪玩费", "呆皇下单后双方线下打擂台"],
    discussionAngles: ["三角洲与率土之滨跨圈约战"],
    skepticalAngles: [],
    anchorTerms: ["Whys", "率土之滨", "王浩宇", "呆皇"]
  };

  assert.deepEqual(normalizeEngagementResearchPlan(brief, {
    queries: ["100万一小时", "Whys 呆皇 陪玩", "王浩宇 率土之滨", "王浩宇 100万"],
    anchors: ["100万一小时", "Whys", "率土之滨", "王浩宇"],
    eventTerms: ["100万", "陪玩", "擂台"]
  }), {
    queries: ["Whys 呆皇 陪玩", "王浩宇 100万"],
    anchors: ["Whys", "率土之滨", "王浩宇"],
    eventTerms: ["100万", "陪玩", "擂台"]
  });
  assert.throws(() => normalizeEngagementResearchPlan(brief, {
    queries: ["王浩宇 0人头"],
    anchors: ["王浩宇"],
    eventTerms: ["0人头"]
  }), /事件锚点/);
});

test("AI 检索计划允许从同一事件扩一层到正文明确相关的话题", () => {
  const brief = {
    summary: "AI 外接大脑可以长期记忆并自动提醒待办",
    topic: "AI 外接大脑长期记忆",
    subjects: ["AI 外接大脑", "AI助手"],
    keyFacts: ["可以长期记忆聊天内容", "支持日历提醒", "用户担心隐私和收费"],
    discussionAngles: ["AI待办", "AI日历", "第二大脑"],
    skepticalAngles: ["长期记忆是否可靠", "隐私与本地存储", "会员收费"],
    anchorTerms: ["AI助手", "长期记忆", "日历提醒"]
  };

  assert.deepEqual(normalizeEngagementResearchPlan(brief, {
    queries: ["AI助手 长期记忆"],
    referenceQueries: ["AI待办 隐私", "第二大脑 会员收费", "AI"],
    anchors: ["AI助手"],
    eventTerms: ["长期记忆"]
  }), {
    queries: ["AI助手 长期记忆", "AI待办 隐私", "第二大脑 会员收费"],
    anchors: ["AI助手"],
    eventTerms: ["长期记忆"]
  });
});

test("全网评论调研不再使用固定评论类别比例", async () => {
  const source = await import("../src/lib/engagement-research");
  assert.equal("buildEngagementResearchLaneSequence" in source, false);
});

test("爆款视频阈值只在没有命中时逐档放宽", () => {
  assert.equal(selectFallbackMetricThreshold([62_000, 18_000], 50_000, [20_000, 5_000]), 50_000);
  assert.equal(selectFallbackMetricThreshold([42_000, 18_000], 50_000, [20_000, 5_000]), 20_000);
  assert.equal(selectFallbackMetricThreshold([2_000], 50_000, [20_000, 5_000]), 0);
  assert.equal(selectFallbackMetricThreshold([180_000], 150_000, [80_000, 30_000]), 150_000);
});

test("相关视频搜索在抓评论前排除输入视频本身", () => {
  assert.equal(isExcludedRelatedVideo("7684475511262825737", ["7684475511262825737"]), true);
  assert.equal(isExcludedRelatedVideo("BV1ABC123456", ["bv1abc123456"]), true);
  assert.equal(isExcludedRelatedVideo("7682995913781972258", ["7684475511262825737"]), false);
});

test("高一致营销模板会被识别为人机评论区", () => {
  const analysis = analyzeCoordinatedCommentSection([
    "真的太好用了，效率直接拉满！",
    "颜值在线实力也在线，闭眼入不亏",
    "用了以后幸福感提升太多，真心推荐",
    "质感满满，性价比真的拉满了",
    "功能全面又实用，这波直接冲",
    "体验感绝了，买到就是赚到",
    "细节做得很到位，值得入手",
    "这才是年轻人的首选，已经安排上了"
  ]);

  assert.equal(analysis.quarantined, true);
  assert.ok(analysis.signals.marketingRatio >= 0.75);
  assert.match(analysis.reasons.join("；"), /广告结论|购买号召|营销话术/);
});

test("商单视频下的自然分歧评论不会仅因商业属性被误杀", () => {
  const analysis = analyzeCoordinatedCommentSection([
    "这价格我还是先看看吧",
    "有没有人说下真实续航？",
    "镜头那段没看懂，为啥突然切了",
    "我用上一代，最大问题其实是发热",
    "笑死，评论区已经有人开始算分期了",
    "别急着冲，等第一批用户反馈",
    "外观确实好看，但这个颜色不耐脏吧",
    "路过蹲一个半年后的评测"
  ]);

  assert.equal(analysis.quarantined, false);
  assert.ok(analysis.signals.naturalStanceRatio >= 0.5);
});

test("一个视频命中人机评论源后整组评论全部隔离", () => {
  const samples = [
    { platform: "douyin" as const, videoId: "ad-video", text: "模板夸赞一" },
    { platform: "douyin" as const, videoId: "ad-video", text: "看起来像真人的一条" },
    { platform: "douyin" as const, videoId: "organic-video", text: "正常评论" },
    { platform: "bilibili" as const, videoId: "ad-video", text: "不同平台同 ID 不连坐" }
  ];

  assert.deepEqual(
    filterQuarantinedVideoCommentSamples(samples, ["douyin:ad-video"]),
    [samples[2], samples[3]]
  );
});

test("带用户 @ 的评论不会进入热评研究或最终候选", () => {
  assert.equal(containsPlatformUserMention("@某用户 这个说得对"), true);
  assert.equal(containsPlatformUserMention("＠某用户 这个说得对"), true);
  assert.equal(containsPlatformUserMention("这个说得对"), false);
  assert.equal(hasResearchSemanticMatch({
    text: "@某用户 Wise拒绝了100万陪玩单",
    query: "Wise 100万陪玩",
    videoTitle: "Wise拒绝100万陪玩单"
  }, {
    summary: "花百万点陪玩，惨遭拒单",
    topic: "Whys跨圈擂台约战",
    subjects: ["Wise", "呆皇", "率土之滨"],
    keyFacts: ["Wise拒绝100万陪玩单"],
    discussionAngles: [],
    skepticalAngles: [],
    anchorTerms: ["Wise", "呆皇", "率土之滨", "100万", "陪玩"]
  }, ["Wise", "呆皇", "率土之滨"], ["100万", "陪玩"]), false);
});

test("评论调研同时抓双平台，并向目标平台倾斜", () => {
  assert.deepEqual(buildPlatformResearchTasks("苹果折叠屏", "bilibili", true), [
    { source: "bilibili", query: "苹果折叠屏", videoLimit: 6 },
    { source: "douyin", query: "苹果折叠屏", videoLimit: 2 }
  ]);
  assert.deepEqual(buildPlatformResearchTasks("苹果折叠屏", "douyin", true), [
    { source: "douyin", query: "苹果折叠屏", videoLimit: 6 },
    { source: "bilibili", query: "苹果折叠屏", videoLimit: 2 }
  ]);
  assert.deepEqual(buildPlatformResearchTasks("苹果折痕", "bilibili", false), [
    { source: "bilibili", query: "苹果折痕", videoLimit: 3 }
  ]);
  assert.deepEqual(buildPlatformResearchTasks("苹果折痕", "douyin", false), [
    { source: "douyin", query: "苹果折痕", videoLimit: 3 }
  ]);
});
