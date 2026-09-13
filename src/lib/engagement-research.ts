import { chatCompleteStrict } from "./ai";
import { classifyEngagementCommentIntent, type EngagementCommentIntent } from "./engagement-style";
import {
  getBilibiliRelatedTopicComments,
  getDouyinRelatedTopicComments
} from "./opencli";
import { containsPlatformUserMention } from "./opencli-normalizers";
import { readEngagementCache, updateEngagementCache, writeEngagementCache } from "./storage";
import type { Platform } from "./types";
import { nowIso, shortHash } from "./utils";

export type EngagementResearchBrief = {
  summary: string;
  topic: string;
  subjects: string[];
  keyFacts: string[];
  discussionAngles: string[];
  skepticalAngles: string[];
  anchorTerms: string[];
};

type CommentIntentBuckets = Record<EngagementCommentIntent, number>;

export type EngagementResearchSourceStat = {
  source: "bilibili" | "douyin";
  status: "completed" | "partial" | "failed";
  videoCount: number;
  commentCount: number;
  error?: string;
};

export type EngagementCommentResearch = {
  usedQueries: string[];
  searchAnchors: string[];
  searchEventTerms: string[];
  failedQueries: string[];
  relatedVideoCount: number;
  relatedCommentCount: number;
  freshCommentCount: number;
  targetPlatformCommentCount: number;
  matchedLibraryCommentCount: number;
  replySampleCount: number;
  longCommentCount: number;
  lengthBuckets: {
    short: number;
    medium: number;
    long: number;
  };
  intentBuckets: CommentIntentBuckets;
  sourceStats: EngagementResearchSourceStat[];
  hotComments: string[];
  reusableComments: string[];
  sampleLibraryCount: number;
  themes: string[];
  phrases: string[];
  questions: string[];
  objections: string[];
  recentTopics: string[];
  legacyTopics: string[];
  playerLifeAngles: string[];
  platformAngles: string[];
  replyAngles: string[];
  longCommentPatterns: string[];
  chatterAngles: string[];
  summaryError?: string;
  cacheHit: boolean;
};

const ENGAGEMENT_RESEARCH_VERSION = "engagement-research-v14";
const RESEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PARTIAL_RESEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_RESEARCH_QUERIES = 3;
const TARGET_PLATFORM_VIDEO_LIMIT = 6;
const TARGET_PLATFORM_SECONDARY_QUERY_VIDEO_LIMIT = 3;
const SECONDARY_PLATFORM_VIDEO_LIMIT = 2;
const HOT_COMMENT_LIBRARY_KEY = "hot-comments";
const SEARCH_ENTITIES = [
  "苹果", "Apple", "华为", "Huawei", "小米", "Xiaomi", "荣耀", "OPPO", "vivo", "三星", "Samsung",
  "一加", "魅族", "联想", "ThinkPad", "戴尔", "Dell", "惠普", "HP", "索尼", "Sony", "任天堂", "微软"
];
const SEARCH_CATEGORIES = [
  "三折叠", "折叠屏", "折叠手机", "直板旗舰", "手机", "电脑", "笔记本", "平板", "耳机", "键盘", "鼠标",
  "摄像头", "显示器", "汽车", "游戏", "电影", "电视剧", "综艺"
];
const SEARCH_FEATURES = [
  "折痕", "Face ID", "Touch ID", "潜望长焦", "铰链", "大屏适配", "多窗办公", "鸿蒙", "iOS", "轻薄",
  "续航", "影像", "价格", "性价比", "配置", "发热", "性能", "屏幕", "系统", "生态"
];

type HotCommentSample = {
  platform: Platform;
  query: string;
  videoId: string;
  videoTitle: string;
  videoMetric: number;
  videoPublishedAt?: string;
  text: string;
  likes: number;
  replies: number;
  collectedAt: string;
  sourceKind?: "related_video" | "library";
};

type HotCommentLibrary = {
  schemaVersion: 1;
  updatedAt: string;
  samples: HotCommentSample[];
};

type PlatformResearchRow = {
  source: "bilibili" | "douyin";
  query: string;
  videos: Array<{ id: string; title: string; metric: number; publishedAt?: string }>;
  comments: HotCommentSample[];
  replyCommentCount: number;
  thresholdLabel: string;
  fallbackReason?: string;
  error?: string;
};

export async function buildEngagementCommentResearch(
  brief: EngagementResearchBrief,
  options: { platform?: Platform; excludedVideoIds?: string[]; signal?: AbortSignal } = {}
): Promise<EngagementCommentResearch> {
  throwIfAborted(options.signal);
  const cacheKey = shortHash(`${ENGAGEMENT_RESEARCH_VERSION}:${JSON.stringify({
    platform: options.platform,
    summary: brief.summary,
    topic: brief.topic,
    subjects: brief.subjects,
    keyFacts: brief.keyFacts,
    excludedVideoIds: uniqueText(options.excludedVideoIds || []).sort()
  })}`);
  const cached = await readEngagementCache<{
    engineVersion: string;
    cachedAt: string;
    research: Omit<EngagementCommentResearch, "cacheHit">;
  }>("research", cacheKey);
  if (cached && isUsableResearchCache(cached)) {
    return { ...cached.research, cacheHit: true };
  }

  const localQueries = buildLocalEngagementResearchQueries(brief);
  const queryPlan = await planEngagementResearchQueries(brief, localQueries, options.signal);
  const queries = queryPlan.queries;
  const searchAnchors = queryPlan.anchors;
  const searchEventTerms = queryPlan.eventTerms;

  const targetPlatform = options.platform || "douyin";
  const platformRows = await collectPlatformResearch(
    queries,
    targetPlatform,
    options.excludedVideoIds || [],
    options.signal
  );
  throwIfAborted(options.signal);

  const freshSamples = dedupeHotCommentSamples(platformRows
    .flatMap((row) => row.comments)
    .filter((sample) => !containsPlatformUserMention(sample.text)));
  const sourceStats = buildSourceStats(platformRows);
  if (!freshSamples.length) {
    const detail = uniqueText(platformRows.map((row) => row.error || "")).join("；");
    throw new Error(
      `${formatSource(options.platform || "douyin")}调研没有抓到相关视频的真实热评，已停止生成。${detail ? ` ${detail}` : "请稍后重试或检查 opencli 浏览器状态。"}`
    );
  }
  const rankedFreshSamples = rankHotComments(
    freshSamples,
    brief,
    options.platform,
    searchAnchors,
    searchEventTerms
  );
  if (!rankedFreshSamples.length) {
    throw new Error(
      `搜索抓到了 ${freshSamples.length} 条评论，但相关视频均未同时命中主体锚点（${searchAnchors.join("、")}）和事件锚点（${searchEventTerms.join("、")}），已停止混入无关评论。请重试关键词规划。`
    );
  }
  const sampleLibrary = await appendHotCommentLibrary(rankedFreshSamples);
  const rankedSamples = rankedFreshSamples.slice(0, 240);
  const researchSamples = uniqueText(rankedSamples.map((sample) => sample.text));
  const platformComments = uniqueText(rankedFreshSamples.map((sample) => sample.text));
  const targetPlatformCommentCount = uniqueText(
    rankedFreshSamples
      .filter((sample) => sample.platform === targetPlatform)
      .map((sample) => sample.text)
  ).length;
  const reusableComments = uniqueText(rankedSamples
    .filter((sample) => isDirectlyReusableHotComment(
      sample,
      brief,
      options.platform,
      searchAnchors,
      searchEventTerms
    ))
    .map((sample) => sample.text))
    .slice(0, 240);
  const failedQueries = platformRows
    .filter((row) => row.error)
    .map((row) => `${formatSource(row.source)}｜${row.query}：${row.error}`);
  const partialReasons = [
    ...sourceStats.filter((source) => source.status !== "completed").map((source) => `${formatSource(source.source)}：${source.error || "覆盖不完整"}`)
  ].filter(Boolean) as string[];
  const lengthBuckets = summarizeLengthBuckets(researchSamples);
  const intentBuckets = summarizeIntentBuckets(researchSamples);
  const videoKeys = new Set(rankedFreshSamples.map((sample) => `${sample.platform}:${sample.videoId}`));
  const research: EngagementCommentResearch = {
    usedQueries: queries,
    searchAnchors,
    searchEventTerms,
    failedQueries,
    relatedVideoCount: videoKeys.size,
    relatedCommentCount: researchSamples.length,
    freshCommentCount: platformComments.length,
    targetPlatformCommentCount,
    matchedLibraryCommentCount: 0,
    replySampleCount: platformRows.reduce((sum, row) => sum + row.replyCommentCount, 0),
    longCommentCount: lengthBuckets.long,
    lengthBuckets,
    intentBuckets,
    sourceStats,
    hotComments: researchSamples.slice(0, 80),
    reusableComments,
    sampleLibraryCount: sampleLibrary.samples.length,
    themes: queries,
    phrases: [],
    questions: researchSamples.filter((text) => /[?？]|吗|么|如何|怎么|多少|能不能|会不会/.test(text)).slice(0, 14),
    objections: researchSamples.filter((text) => /但是|不过|问题|担心|贵|不值|别|难|坑|算了/.test(text)).slice(0, 14),
    recentTopics: [],
    legacyTopics: [],
    playerLifeAngles: [],
    platformAngles: [],
    replyAngles: [],
    longCommentPatterns: researchSamples.filter((text) => Array.from(text).length >= 36).slice(0, 10),
    chatterAngles: [],
    summaryError: partialReasons.length ? uniqueText(partialReasons).join("；") : undefined,
    cacheHit: false
  };

  await writeEngagementCache("research", cacheKey, {
    engineVersion: ENGAGEMENT_RESEARCH_VERSION,
    cachedAt: nowIso(),
    research: stripCacheHit(research)
  });
  return research;
}

export function buildLocalEngagementResearchQueries(brief: EngagementResearchBrief) {
  const sourceText = [
    brief.topic,
    brief.summary,
    ...brief.subjects,
    ...brief.keyFacts,
    ...brief.discussionAngles,
    ...brief.skepticalAngles,
    ...brief.anchorTerms
  ].join(" ");
  const titleText = cleanSearchQuery(brief.topic);
  const entities = findSearchTerms(sourceText, SEARCH_ENTITIES);
  const titleEntities = findSearchTerms(titleText, SEARCH_ENTITIES);
  const categories = findSearchTerms(sourceText, SEARCH_CATEGORIES);
  const titleCategories = findSearchTerms(titleText, SEARCH_CATEGORIES);
  const primaryEntity = titleEntities[0] || entities[0] || "";
  const primaryCategory = titleCategories[0] || categories[0] || "";
  const rankedAtoms = rankSearchAtoms([
    brief.summary,
    brief.topic,
    ...brief.subjects,
    ...brief.anchorTerms
  ], sourceText);
  const primaryAtom = rankedAtoms[0] || cleanPrimaryTopic(titleText);
  const companionAtom = rankedAtoms.find((value) => {
    const primaryKey = searchKey(primaryAtom);
    const valueKey = searchKey(value);
    return valueKey !== primaryKey
      && !primaryKey.includes(valueKey)
      && !valueKey.includes(primaryKey)
      && Array.from(`${primaryAtom} ${value}`).length <= 20;
  });
  const primary = cleanSearchQuery(
    primaryEntity && primaryCategory
      ? `${primaryEntity}${primaryCategory}`
      : `${primaryAtom}${companionAtom ? ` ${companionAtom}` : ""}`
  );
  if (!primary) return [];

  const features = rankSearchFeatures(sourceText)
    .filter((feature) => !searchKey(primary).includes(searchKey(feature)))
    .slice(0, 2);
  const featureQuery = features.length ? cleanSearchQuery(`${primary} ${features.join(" ")}`) : "";
  const comparisonEntities = entities.filter((entity) => !sameSearchEntity(entity, primaryEntity));
  const comparisonQuery = comparisonEntities.length
    ? cleanSearchQuery(`${primaryEntity || primary} ${comparisonEntities.slice(0, 2).join(" ")} ${primaryCategory || ""} 对比`)
    : "";
  const fallbackTerms = rankedAtoms
    .filter((value) => isUsefulSearchQuery(value) && !searchKey(primary).includes(searchKey(value)))
    .slice(0, 3);
  return uniqueText([
    primary,
    featureQuery,
    comparisonQuery,
    ...fallbackTerms
  ]).filter(isUsefulSearchQuery).slice(0, MAX_RESEARCH_QUERIES);
}

export async function planEngagementResearchQueries(
  brief: EngagementResearchBrief,
  localCandidates: string[] = [],
  signal?: AbortSignal
) {
  throwIfAborted(signal);
  const prompt = `根据下面正文规划 2—3 个相关视频检索词，并分别提取主体锚点和事件锚点。

必须遵守：
1. 主体锚点使用人物名、账号名、作品名、游戏名、品牌+品类、产品全名等唯一主体。
2. 事件锚点使用能区分“这一次具体事件”的金额+行为、版本+变化、对象+动作等短词，例如“100万”“陪玩”“拒单”“跨圈擂台”。
3. 每个检索词必须同时包含至少一个主体锚点和一个事件锚点。有多个主体时优先组合，以排除同词不同事件。
4. 禁止把金额、日期、时长、战绩、情绪词或正文里的完整句子单独当检索词，例如只搜“100万一小时”“0人头”“翻车”。
5. 主体锚点和事件锚点都必须原样出现在提供的标题、主体或事实中，不得猜测或补充新名字。
6. 锚点应尽量短且可组合：主体优先“率土之滨”而不是“游戏”，事件优先“100万”+“陪玩”而不是复制整句。
7. 检索词 2—24 个字，不写“评论、论坛、评测、视频、热搜”。
8. 输出格式：{"queries":["..."],"anchors":["..."],"eventTerms":["..."]}。

标题：${brief.topic}
一句话：${brief.summary}
主体候选：${brief.subjects.join("、")}
正文事实：${brief.keyFacts.slice(0, 12).join("；")}
锚点候选：${brief.anchorTerms.join("、")}
本地机械候选（只能参考，不能直接照收）：${localCandidates.join("、") || "无"}`;
  let previousOutput = "";
  let previousError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const correction = attempt > 1
      ? `\n\n上一次输出未通过程序校验：${previousError}\n上一次输出：${previousOutput}\n请重新规划，不能只改格式。`
      : "";
    const result = await chatCompleteStrict(
      [
        {
          role: "system",
          content: "你是中文短视频检索词规划员。你的任务是从正文中识别唯一主体和具体事件，再生成能搜到同一主题相关视频的关键词。只输出 JSON，不解释。"
        },
        {
          role: "user",
          content: `${prompt}${correction}`
        }
      ],
      "medium",
      { signal, maxOutputTokens: 620 }
    );
    throwIfAborted(signal);
    if (result.fallback || !result.text.trim()) {
      previousError = result.fallbackReason || "模型没有返回内容";
      previousOutput = result.text.trim();
      continue;
    }
    previousOutput = result.text.trim();
    const object = parseJsonObject(result.text);
    if (!object) {
      previousError = "模型没有返回可解析的 JSON";
      continue;
    }
    try {
      return normalizeEngagementResearchPlan(brief, object);
    } catch (error) {
      previousError = formatError(error);
    }
  }
  throw new Error(`AI 检索词规划连续两次不合格：${previousError || "没有返回可用关键词"}`);
}

export function normalizeEngagementResearchPlan(
  brief: EngagementResearchBrief,
  value: Record<string, unknown>
) {
  const sourceKey = searchKey([
    brief.topic,
    brief.summary,
    ...brief.subjects,
    ...brief.keyFacts,
    ...brief.anchorTerms
  ].join(" "));
  const anchors = uniqueText(normalizeStringList(value.anchors, 8)
    .map(cleanSearchAnchor)
    .filter((anchor) => {
      const key = searchKey(anchor);
      return key.length >= 2
        && sourceKey.includes(key)
        && !isWeakResearchMatchTerm(key)
        && !isGenericSearchAtom(anchor)
        && isIdentitySearchAnchor(anchor);
    }))
    .slice(0, 6);
  if (!anchors.length) {
    throw new Error("AI 检索词规划失败：没有提取到正文中真实存在的主题主体，请补充人物、作品、品牌或产品名称后重试。");
  }

  const eventTerms = uniqueText(normalizeStringList(value.eventTerms, 8)
    .map(cleanSearchAnchor)
    .filter((term) => {
      const key = searchKey(term);
      return key.length >= 2
        && sourceKey.includes(key)
        && !isWeakResearchEventTerm(key)
        && !isGenericSearchAtom(term);
    }))
    .slice(0, 6);
  if (!eventTerms.length) {
    throw new Error("AI 检索词规划失败：没有提取到能区分本次事件、版本或卖点的事件锚点。");
  }

  const anchorKeys = anchors.map(searchKey);
  const eventKeys = eventTerms.map(searchKey);
  const queries = uniqueText(normalizeStringList(value.queries, MAX_RESEARCH_QUERIES * 2)
    .map(cleanSearchQuery)
    .filter((query) => {
      const key = searchKey(query);
      return isUsefulSearchQuery(query)
        && anchorKeys.some((anchor) => key.includes(anchor))
        && eventKeys.some((term) => key.includes(term));
    }))
    .slice(0, MAX_RESEARCH_QUERIES);
  if (queries.length < 2) {
    throw new Error("AI 检索词规划失败：至少需要 2 个同时包含主题主体和具体事件的有效关键词。");
  }
  return { queries, anchors, eventTerms };
}

function rankSearchAtoms(values: string[], sourceText: string) {
  const atoms = uniqueText(values.flatMap(extractSearchAtoms));
  const lowerSource = sourceText.toLowerCase();
  return atoms
    .filter((value) => isUsefulSearchQuery(value) && !isModelOnlySearchTerm(value) && !isGenericSearchAtom(value))
    .map((value, index) => {
      const length = Array.from(value).length;
      const occurrences = countTextOccurrences(lowerSource, value.toLowerCase());
      const genericPenalty = /^(?:世界冠军|顶流主播|职业生涯|首次|首秀|游戏|视频|产品|体验|测评)$/.test(value) ? 20 : 0;
      const score = occurrences * 12
        + (length >= 4 && length <= 10 ? 10 : 0)
        + (length <= 2 ? -12 : 0)
        - genericPenalty
        - index * 0.01;
      return { value, score };
    })
    .sort((left, right) => right.score - left.score)
    .map(({ value }) => value);
}

function isGenericSearchAtom(value: string) {
  return /^(?:引发讨论|引发热议|相关讨论|网友讨论|大家讨论|职业生涯|职业生涯首秀|首次|首秀|首次亮相|首次登场|世界冠军|顶流主播|游戏|视频|产品|体验|测评)$/.test(value);
}

function extractSearchAtoms(value: string) {
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[#《》“”"'，。！？、；:：|()（）\[\]【】]/g, " ")
    .replace(/(?:职业生涯首秀|职业生涯|首次亮相|首次登场)/g, " ");
  return cleaned
    .split(/\s+|(?:在|挑战|大闹|约战|硬刚|对战|大战|实测|测评|体验|发布|上线|加入|拿下|成为)/g)
    .map((item) => cleanSearchQuery(item))
    .filter((item) => Array.from(item).length >= 2 && Array.from(item).length <= 14);
}

function findSearchTerms(text: string, candidates: string[]) {
  const lower = text.toLowerCase();
  return candidates.filter((candidate) => lower.includes(candidate.toLowerCase()));
}

function rankSearchFeatures(text: string) {
  const lower = text.toLowerCase();
  return SEARCH_FEATURES
    .map((feature, index) => ({
      feature,
      index,
      count: countTextOccurrences(lower, feature.toLowerCase())
    }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .map(({ feature }) => feature);
}

function countTextOccurrences(text: string, term: string) {
  if (!term) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = text.indexOf(term, cursor)) >= 0) {
    count += 1;
    cursor += term.length;
  }
  return count;
}

function sameSearchEntity(left: string, right: string) {
  const aliases = [
    ["苹果", "Apple"], ["华为", "Huawei"], ["小米", "Xiaomi"], ["三星", "Samsung"],
    ["索尼", "Sony"], ["戴尔", "Dell"], ["惠普", "HP"]
  ];
  const leftKey = left.toLowerCase();
  const rightKey = right.toLowerCase();
  return aliases.some((group) => group.some((value) => value.toLowerCase() === leftKey) && group.some((value) => value.toLowerCase() === rightKey));
}

function cleanPrimaryTopic(value: string) {
  return cleanSearchQuery(value
    .replace(/吹不动|吹爆|封神|根本没|根本不|照样|彻底炸锅|翻车|拉胯|离谱|打脸|开摆|姗姗来迟/g, " ")
    .replace(/迟到\s*\d+\s*年|进场|首款|终于/g, " "));
}

export function formatEngagementCommentResearch(research: EngagementCommentResearch) {
  return [
    `热评覆盖：相关视频 ${research.relatedVideoCount} 个 / 真实抓取 ${research.freshCommentCount} 条（目标平台 ${research.targetPlatformCommentCount} 条） / 语义命中历史样本 ${research.matchedLibraryCommentCount} 条 / 最终参考 ${research.relatedCommentCount} 条 / 可直接复用 ${research.reusableComments.length} 条`,
    formatList("AI 主题锚点", research.searchAnchors),
    formatList("AI 事件锚点", research.searchEventTerms),
    formatList("检索词", research.usedQueries),
    formatList("按正文相关度排序的热评", research.hotComments.slice(0, 36)),
    research.summaryError ? `覆盖提醒：${research.summaryError}` : ""
  ].filter(Boolean).join("\n");
}

function isUsableResearchCache(cached: {
  engineVersion: string;
  cachedAt: string;
  research: Omit<EngagementCommentResearch, "cacheHit">;
} | null): cached is {
  engineVersion: string;
  cachedAt: string;
  research: Omit<EngagementCommentResearch, "cacheHit">;
} {
  if (!cached || cached.engineVersion !== ENGAGEMENT_RESEARCH_VERSION || !cached.research?.relatedCommentCount) return false;
  const age = Date.now() - Date.parse(cached.cachedAt);
  if (!Number.isFinite(age) || age < 0) return false;
  const ttl = cached.research.summaryError ? PARTIAL_RESEARCH_CACHE_TTL_MS : RESEARCH_CACHE_TTL_MS;
  return age <= ttl;
}

export function buildPlatformResearchTasks(query: string, targetPlatform: Platform, isPrimaryQuery: boolean) {
  const secondaryPlatform: Platform = targetPlatform === "bilibili" ? "douyin" : "bilibili";
  if (!isPrimaryQuery) {
    return [{
      source: targetPlatform,
      query,
      videoLimit: TARGET_PLATFORM_SECONDARY_QUERY_VIDEO_LIMIT
    }];
  }
  return [
    {
      source: targetPlatform,
      query,
      videoLimit: TARGET_PLATFORM_VIDEO_LIMIT
    },
    {
      source: secondaryPlatform,
      query,
      videoLimit: SECONDARY_PLATFORM_VIDEO_LIMIT
    }
  ];
}

async function collectPlatformResearch(
  queries: string[],
  platform: Platform | undefined,
  excludedVideoIds: string[],
  signal?: AbortSignal
) {
  const rows: PlatformResearchRow[] = [];
  const targetPlatform = platform || "douyin";
  for (const [index, query] of queries.entries()) {
    const wave = await Promise.all(
      buildPlatformResearchTasks(query, targetPlatform, index === 0)
        .map((task) => collectPlatformResearchRow(task, excludedVideoIds, signal))
    );
    rows.push(...wave);
  }
  return rows;
}

async function collectPlatformResearchRow(
  task: { source: Platform; query: string; videoLimit: number },
  excludedVideoIds: string[],
  signal?: AbortSignal
): Promise<PlatformResearchRow> {
  throwIfAborted(signal);
  try {
    const collectedAt = nowIso();
    const result = task.source === "bilibili"
      ? await getBilibiliRelatedTopicComments(task.query, {
          videoLimit: task.videoLimit, commentLimit: 50, replyLimit: 8, minViews: 150_000, excludedVideoIds, signal
        })
      : await getDouyinRelatedTopicComments(task.query, {
          videoLimit: task.videoLimit, commentLimit: 50, minLikes: 50_000, excludedVideoIds, signal
        });
    const videos = task.source === "bilibili"
      ? result.videos.map((video) => ({
          id: video.id, title: video.title, metric: "views" in video ? video.views : 0, publishedAt: video.publishedAt
        }))
      : result.videos.map((video) => ({
          id: video.id, title: video.title, metric: video.likes, publishedAt: video.publishedAt
        }));
    const videoMap = new Map(videos.map((video) => [video.id, video]));
    const comments = result.commentSamples.map((comment) => {
      const video = videoMap.get(comment.videoId);
      return {
        platform: task.source,
        query: task.query,
        videoId: comment.videoId,
        videoTitle: comment.videoTitle,
        videoMetric: video?.metric || 0,
        videoPublishedAt: video?.publishedAt,
        text: comment.text,
        likes: comment.likes,
        replies: comment.replies,
        collectedAt,
        sourceKind: "related_video"
      } satisfies HotCommentSample;
    });
    const appliedThreshold = "appliedMinViews" in result ? result.appliedMinViews : result.appliedMinLikes;
    const thresholdLabel = task.source === "bilibili"
      ? `播放≥${formatMetric(appliedThreshold)}`
      : `点赞≥${formatMetric(appliedThreshold)}`;
    const fallbackReason = task.source === "bilibili" && appliedThreshold < 150_000
      ? `未找到播放量达到 15 万的相关视频，已降至${thresholdLabel}`
      : task.source === "douyin" && appliedThreshold < 50_000
        ? `未找到点赞达到 5 万的相关视频，已降至${thresholdLabel}`
        : undefined;
    return {
      ...task,
      videos,
      comments: dedupeHotCommentSamples(comments),
      replyCommentCount: "replyCommentCount" in result ? result.replyCommentCount : 0,
      thresholdLabel,
      fallbackReason,
      error: comments.length ? undefined : "没有返回可用热评"
    };
  } catch (error) {
    throwIfAborted(signal);
    return { ...task, videos: [], comments: [], replyCommentCount: 0, thresholdLabel: "未命中", error: formatError(error) };
  }
}

async function appendHotCommentLibrary(freshSamples: HotCommentSample[]) {
  return updateEngagementCache<HotCommentLibrary>("samples", HOT_COMMENT_LIBRARY_KEY, (current) => {
    if (current && (current.schemaVersion !== 1 || !Array.isArray(current.samples))) {
      throw new Error("评论热评样本库版本不兼容，请先备份后再处理。");
    }
    const existing = current?.samples || [];
    return {
      schemaVersion: 1,
      updatedAt: nowIso(),
      samples: dedupeHotCommentSamples([...freshSamples, ...existing])
    };
  });
}

function rankHotComments(
  samples: HotCommentSample[],
  brief: EngagementResearchBrief,
  platform: Platform | undefined,
  searchAnchors: string[],
  searchEventTerms: string[]
) {
  return samples
    .map((sample) => ({
      sample,
      score: hotCommentRelevanceScore(sample, brief, platform, searchAnchors, searchEventTerms)
    }))
    .filter(({ sample, score }) => hasResearchSemanticMatch(
      sample,
      brief,
      searchAnchors,
      searchEventTerms
    ) && score >= 12)
    .sort((left, right) => right.score - left.score || right.sample.likes - left.sample.likes)
    .map(({ sample }) => sample);
}

export function hasResearchSemanticMatch(
  sample: Pick<HotCommentSample, "text" | "query" | "videoTitle">,
  brief: EngagementResearchBrief,
  searchAnchors: string[] = [],
  searchEventTerms: string[] = []
) {
  if (containsPlatformUserMention(sample.text)) return false;
  const commentKey = searchKey(sample.text);
  const videoTitleKey = searchKey(sample.videoTitle);
  const anchors = searchAnchors.map(searchKey).filter(Boolean);
  const eventTerms = searchEventTerms.map(searchKey).filter(Boolean);
  const videoAnchorMatches = anchors.filter((anchor) => videoTitleKey.includes(anchor));
  const commentAnchorMatches = anchors.filter((anchor) => commentKey.includes(anchor));
  if (anchors.length) {
    const videoEventMatches = eventTerms.filter((term) => videoTitleKey.includes(term));
    const commentEventMatches = eventTerms.filter((term) => commentKey.includes(term));
    return (
      hasStrongResearchAnchorMatch(videoAnchorMatches)
      && (!eventTerms.length || hasStrongResearchEventMatch(videoEventMatches))
    ) || (
      hasStrongResearchAnchorMatch(commentAnchorMatches)
      && (!eventTerms.length || hasStrongResearchEventMatch(commentEventMatches))
    );
  }

  const terms = buildResearchMatchTerms(brief).map(searchKey).filter(Boolean);
  const commentMatches = terms.filter((term) => commentKey.includes(term));
  return hasStrongResearchAnchorMatch(commentMatches);
}

function hotCommentRelevanceScore(
  sample: HotCommentSample,
  brief: EngagementResearchBrief,
  platform: Platform | undefined,
  searchAnchors: string[],
  searchEventTerms: string[]
) {
  const commentKey = searchKey(sample.text);
  const videoTitleKey = searchKey(sample.videoTitle);
  const terms = buildResearchMatchTerms(brief);
  let score = platform && sample.platform === platform ? 5 : 0;
  const titleAnchorMatches = searchAnchors.map(searchKey).filter((term) => videoTitleKey.includes(term));
  const titleEventMatches = searchEventTerms.map(searchKey).filter((term) => videoTitleKey.includes(term));
  if (
    hasStrongResearchAnchorMatch(titleAnchorMatches)
    && hasStrongResearchEventMatch(titleEventMatches)
  ) {
    score += 30;
  }
  for (const term of terms) {
    const key = searchKey(term);
    if (!key) continue;
    if (commentKey.includes(key)) score += key.length >= 6 ? 14 : 9;
    else if (videoTitleKey.includes(key)) score += key.length >= 6 ? 7 : 4;
  }
  score += Math.min(10, Math.log10(Math.max(sample.likes, 0) + 1) * 2.2);
  score += Math.min(6, Math.log10(Math.max(sample.videoMetric, 0) + 1));
  const publishedAt = sample.videoPublishedAt ? Date.parse(sample.videoPublishedAt) : 0;
  if (publishedAt) {
    const ageDays = Math.max(0, (Date.now() - publishedAt) / 86_400_000);
    if (ageDays <= 30) score += 6;
    else if (ageDays <= 180) score += 3;
    else if (ageDays <= 365) score += 1;
  }
  return score;
}

function isDirectlyReusableHotComment(
  sample: HotCommentSample,
  brief: EngagementResearchBrief,
  platform: Platform | undefined,
  searchAnchors: string[],
  searchEventTerms: string[]
) {
  const platformFit = !platform || sample.platform === platform;
  if (!platformFit) return false;
  const titleAnchorMatches = searchAnchors
    .map(searchKey)
    .filter((term) => term && searchKey(sample.videoTitle).includes(term));
  const titleEventMatches = searchEventTerms
    .map(searchKey)
    .filter((term) => term && searchKey(sample.videoTitle).includes(term));
  if (sample.sourceKind === "related_video") {
    return hasStrongResearchAnchorMatch(titleAnchorMatches)
      && hasStrongResearchEventMatch(titleEventMatches);
  }
  const commentKey = searchKey(sample.text);
  const matchedTerms = buildResearchMatchTerms(brief)
    .map(searchKey)
    .filter((term) => term && commentKey.includes(term));
  const strongMatch = matchedTerms.some((term) => term.length >= 4);
  const multipleMatches = new Set(matchedTerms).size >= 2;
  return strongMatch || multipleMatches;
}

function hasStrongResearchAnchorMatch(matches: string[]) {
  const uniqueMatches = new Set(matches.filter((term) => !isWeakResearchMatchTerm(term)));
  return [...uniqueMatches].some((term) => term.length >= 3) || uniqueMatches.size >= 2;
}

function hasStrongResearchEventMatch(matches: string[]) {
  return new Set(matches.filter((term) => !isWeakResearchEventTerm(term))).size >= 1;
}

function buildResearchMatchTerms(brief: EngagementResearchBrief) {
  return uniqueText([
    ...brief.subjects,
    ...brief.anchorTerms,
    brief.topic,
    ...brief.keyFacts.flatMap((value) => value.split(/[，、：:（）()\s]/))
  ])
    .map((value) => value.replace(/[^\u4e00-\u9fa5A-Za-z0-9.+%-]/g, "").trim())
    .filter((value) => value.length >= 2 && value.length <= 24 && !isWeakResearchMatchTerm(searchKey(value)))
    .slice(0, 48);
}

function dedupeHotCommentSamples(samples: HotCommentSample[]) {
  const seen = new Set<string>();
  return samples.filter((sample) => {
    const key = hotCommentSampleKey(sample);
    if (!sample.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hotCommentSampleKey(sample: Pick<HotCommentSample, "platform" | "videoId" | "text">) {
  return `${sample.platform}\n${sample.videoId}\n${searchKey(sample.text)}`;
}

export function countTargetPlatformResearchComments(
  rows: Array<{ source: Platform; comments: Array<{ text: string }> }>,
  targetPlatform: Platform
) {
  return uniqueText(
    rows
      .filter((row) => row.source === targetPlatform)
      .flatMap((row) => row.comments.map((comment) => comment.text))
  ).length;
}

function formatMetric(value: number) {
  if (value >= 10_000) return `${Number((value / 10_000).toFixed(1))}万`;
  return String(value);
}

function buildSourceStats(platformRows: PlatformResearchRow[]): EngagementResearchSourceStat[] {
  const platformStats = (["bilibili", "douyin"] as const).map((source): EngagementResearchSourceStat => {
    const rows = platformRows.filter((row) => row.source === source);
    const videoCount = new Set(rows.flatMap((row) => row.videos.map((video) => video.id))).size;
    const commentCount = dedupeHotCommentSamples(rows.flatMap((row) => row.comments)).length;
    const errors = uniqueText(rows.flatMap((row) => [row.error || "", row.fallbackReason || ""]));
    return {
      source,
      status: commentCount ? (errors.length ? "partial" : "completed") : "failed",
      videoCount,
      commentCount,
      error: errors.length ? errors.join("；") : undefined
    };
  });
  return platformStats;
}

function summarizeLengthBuckets(samples: string[]) {
  return samples.reduce((buckets, sample) => {
    const length = Array.from(sample).length;
    if (length >= 36) buckets.long += 1;
    else if (length >= 13) buckets.medium += 1;
    else buckets.short += 1;
    return buckets;
  }, { short: 0, medium: 0, long: 0 });
}

function summarizeIntentBuckets(samples: string[]): CommentIntentBuckets {
  const buckets: CommentIntentBuckets = {
    reaction: 0,
    question: 0,
    price: 0,
    comparison: 0,
    skeptical: 0,
    experience: 0,
    follow: 0,
    chatter: 0
  };
  samples.forEach((sample) => {
    buckets[classifyEngagementCommentIntent(sample)] += 1;
  });
  return buckets;
}

function stripCacheHit(research: EngagementCommentResearch): Omit<EngagementCommentResearch, "cacheHit"> {
  const cached: Partial<EngagementCommentResearch> = { ...research };
  delete cached.cacheHit;
  return cached as Omit<EngagementCommentResearch, "cacheHit">;
}

function cleanSearchQuery(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[#《》“”"'，。！？、；:：|()（）\[\]【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

function cleanSearchAnchor(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[#《》“”"'，。！？、；:：|()（）\[\]【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

function isModelOnlySearchTerm(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return true;
  const latinOrDigitCount = (compact.match(/[A-Za-z0-9]/g) || []).length;
  return latinOrDigitCount / Array.from(compact).length >= 0.6;
}

function isUsefulSearchQuery(value: string) {
  if (value.length < 2) return false;
  if (/^(?:粘贴文案|视频链接|评论素材|生成评论|评论区)$/.test(value)) return false;
  return /[\u4e00-\u9fa5A-Za-z0-9]/.test(value);
}

function isWeakResearchMatchTerm(value: string) {
  const key = searchKey(value);
  if (!key || /^(?:一个|这个|那个|不是|就是|还是|已经|自己|直接|然后|不过|但是|因为|所以|感觉|真的|可以|没有|怎么|什么|多少|内容|用户|玩家|评论|产品|视频|游戏|事件|事情|问题|时候|现在|大家|pro|max|plus)$/.test(key)) {
    return true;
  }
  return /^\d+(?:万|元|秒|分钟|小时|天|年|月|日|点|号|人头|杀|把|次)/.test(key)
    || /^\d+$/.test(key);
}

function isWeakResearchEventTerm(value: string) {
  const key = searchKey(value);
  if (!key || key.length < 2) return true;
  return /^(?:一个|这个|那个|不是|就是|还是|已经|自己|直接|然后|不过|但是|因为|所以|感觉|真的|可以|没有|怎么|什么|多少|内容|用户|玩家|评论|产品|视频|游戏|事件|事情|问题|时候|现在|大家|翻车|离谱|pro|max|plus)$/.test(key)
    || /^\d+(?:秒|分钟|小时|天|年|月|日|点|号|人头|杀|把|次)$/.test(key)
    || /^\d+$/.test(key);
}

function isIdentitySearchAnchor(value: string) {
  return Array.from(value).length <= 12
    && !/自己|本想|没想到|挂了|下单|拒单|约战|擂台|一小时|人头|翻车|挑战|发布|上线|加入/.test(value);
}

function searchKey(value: string) {
  return value.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").toLowerCase();
}

function normalizeStringList(value: unknown, limit: number) {
  return uniqueText(
    Array.isArray(value)
      ? value.map((item) => typeof item === "string" ? item : "")
      : []
  ).slice(0, limit);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function formatList(label: string, values: string[]) {
  return values.length ? `${label}：\n${values.map((value) => `- ${value}`).join("\n")}` : "";
}

function formatSource(source: EngagementResearchSourceStat["source"]) {
  if (source === "bilibili") return "B站";
  return "抖音";
}

function formatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  return message.replace(/\s+/g, " ").trim().slice(0, 220) || "未知错误";
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => {
    if (!value) return false;
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("任务已停止");
}
