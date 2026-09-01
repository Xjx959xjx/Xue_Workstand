import { chatCompleteStrict, webSearchCompleteStrict } from "./ai";
import { classifyEngagementCommentIntent, type EngagementCommentIntent } from "./engagement-style";
import {
  getBilibiliRelatedTopicComments,
  getDouyinRelatedTopicComments
} from "./opencli";
import { readEngagementCache, writeEngagementCache } from "./storage";
import { clampText, nowIso, shortHash } from "./utils";

export type EngagementResearchBrief = {
  summary: string;
  topic: string;
  subjects: string[];
  keyFacts: string[];
  discussionAngles: string[];
  skepticalAngles: string[];
  anchorTerms: string[];
};

export type EngagementResearchLane =
  | "direct"
  | "recent"
  | "legacy"
  | "newcomer"
  | "life"
  | "platform"
  | "reply";

type CommentIntentBuckets = Record<EngagementCommentIntent, number>;

export type EngagementResearchSourceStat = {
  source: "bilibili" | "douyin" | "forum";
  status: "completed" | "partial" | "failed";
  videoCount: number;
  commentCount: number;
  error?: string;
};

export type EngagementCommentResearch = {
  usedQueries: string[];
  failedQueries: string[];
  relatedVideoCount: number;
  relatedCommentCount: number;
  forumSourceCount: number;
  forumCommentCount: number;
  replySampleCount: number;
  longCommentCount: number;
  lengthBuckets: {
    short: number;
    medium: number;
    long: number;
  };
  intentBuckets: CommentIntentBuckets;
  sourceStats: EngagementResearchSourceStat[];
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

const ENGAGEMENT_RESEARCH_VERSION = "engagement-research-v4";
const RESEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PARTIAL_RESEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_RESEARCH_QUERIES = 3;
const PLATFORM_RESEARCH_CONCURRENCY = 3;

type PlatformResearchRow = {
  source: "bilibili" | "douyin";
  query: string;
  videos: Array<{ id: string }>;
  comments: string[];
  replyCommentCount: number;
  error?: string;
};

type ForumResearch = {
  sourceCount: number;
  discussionCount: number;
  samples: string[];
  themes: string[];
  questions: string[];
  objections: string[];
  chatterAngles: string[];
  error?: string;
};

export async function buildEngagementCommentResearch(
  brief: EngagementResearchBrief,
  options: { signal?: AbortSignal } = {}
): Promise<EngagementCommentResearch> {
  throwIfAborted(options.signal);
  const cacheKey = shortHash(`${ENGAGEMENT_RESEARCH_VERSION}:${JSON.stringify({
    summary: brief.summary,
    topic: brief.topic,
    subjects: brief.subjects,
    keyFacts: brief.keyFacts
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
  if (!queries.length) {
    throw new Error("全网调研没有提取到可用搜索词，请补充具体作品、产品、人物或版本名称后重试。");
  }

  const [platformRows, forum] = await Promise.all([
    collectPlatformResearch(queries, options.signal),
    collectForumResearch(brief, queries, options.signal)
  ]);
  throwIfAborted(options.signal);

  const platformComments = uniqueText(platformRows.flatMap((row) => row.comments)).slice(0, 180);
  const successfulPlatformRows = platformRows.filter((row) => !row.error);
  if (!platformComments.length) {
    const detail = uniqueText(platformRows.map((row) => row.error || "")).join("；");
    throw new Error(
      `全网调研没有抓到 B站或抖音相关视频的真实评论，已停止生成。${detail ? ` ${detail}` : "请稍后重试或检查 opencli 浏览器状态。"}`
    );
  }

  const researchSamples = uniqueText([...platformComments, ...forum.samples]).slice(0, 200);
  const summarized = await summarizeResearchSamples(brief, queries, researchSamples, forum, options.signal);
  const sourceStats = buildSourceStats(platformRows, forum);
  const failedQueries = platformRows
    .filter((row) => row.error)
    .map((row) => `${formatSource(row.source)}｜${row.query}：${row.error}`);
  const partialReasons = [
    queryPlan.error,
    ...sourceStats.filter((source) => source.status !== "completed").map((source) => `${formatSource(source.source)}：${source.error || "覆盖不完整"}`)
  ].filter(Boolean) as string[];
  const lengthBuckets = summarizeLengthBuckets(researchSamples);
  const intentBuckets = summarizeIntentBuckets(researchSamples);
  const videoKeys = new Set(
    successfulPlatformRows.flatMap((row) => row.videos.map((video) => `${row.source}:${video.id}`))
  );
  const research: EngagementCommentResearch = {
    usedQueries: queries,
    failedQueries,
    relatedVideoCount: videoKeys.size,
    relatedCommentCount: researchSamples.length,
    forumSourceCount: forum.sourceCount,
    forumCommentCount: forum.discussionCount || forum.samples.length,
    replySampleCount: platformRows.reduce((sum, row) => sum + row.replyCommentCount, 0),
    longCommentCount: lengthBuckets.long,
    lengthBuckets,
    intentBuckets,
    sourceStats,
    themes: uniqueText([...summarized.themes, ...forum.themes]).slice(0, 16),
    phrases: summarized.phrases,
    questions: uniqueText([...summarized.questions, ...forum.questions]).slice(0, 14),
    objections: uniqueText([...summarized.objections, ...forum.objections]).slice(0, 14),
    recentTopics: summarized.recentTopics,
    legacyTopics: summarized.legacyTopics,
    playerLifeAngles: summarized.playerLifeAngles,
    platformAngles: summarized.platformAngles,
    replyAngles: summarized.replyAngles,
    longCommentPatterns: summarized.longCommentPatterns,
    chatterAngles: uniqueText([...summarized.chatterAngles, ...forum.chatterAngles]).slice(0, 12),
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
  const candidates = uniqueText([
    ...brief.subjects,
    ...brief.anchorTerms,
    brief.topic,
    brief.summary
  ])
    .map(cleanSearchQuery)
    .filter(isUsefulSearchQuery);
  const primary = candidates[0] || "";
  if (!primary) return [];
  const secondary = candidates
    .slice(1)
    .filter((value) => !searchKey(primary).includes(searchKey(value)) && !searchKey(value).includes(searchKey(primary)))
    .slice(0, MAX_RESEARCH_QUERIES - 1);
  return uniqueText([
    primary,
    ...secondary.map((value) => cleanSearchQuery(`${primary} ${value}`))
  ]).slice(0, MAX_RESEARCH_QUERIES);
}

export function buildEngagementResearchLaneSequence(count: number, startIndex = 0): EngagementResearchLane[] {
  if (count <= 0) return [];
  const order: EngagementResearchLane[] = ["direct", "recent", "legacy", "newcomer", "life", "platform", "reply"];
  const targets: Record<EngagementResearchLane, number> = {
    direct: Math.round(count * 0.25),
    recent: Math.round(count * 0.2),
    legacy: Math.round(count * 0.2),
    newcomer: Math.round(count * 0.15),
    life: Math.round(count * 0.08),
    platform: Math.round(count * 0.07),
    reply: 0
  };
  targets.reply = Math.max(0, count - order.reduce((sum, lane) => sum + targets[lane], 0));
  while (order.reduce((sum, lane) => sum + targets[lane], 0) > count) {
    const lane = order.find((candidate) => candidate !== "reply" && targets[candidate] > 0);
    if (!lane) break;
    targets[lane] -= 1;
  }

  const emitted = Object.fromEntries(order.map((lane) => [lane, 0])) as Record<EngagementResearchLane, number>;
  const sequence: EngagementResearchLane[] = [];
  for (let index = 0; index < count; index += 1) {
    const lane = order
      .filter((candidate) => emitted[candidate] < targets[candidate])
      .sort((left, right) => {
        const leftDeficit = (targets[left] * (index + 1)) / count - emitted[left];
        const rightDeficit = (targets[right] * (index + 1)) / count - emitted[right];
        return rightDeficit - leftDeficit || order.indexOf(left) - order.indexOf(right);
      })[0] || "direct";
    emitted[lane] += 1;
    sequence.push(lane);
  }
  if (!startIndex || sequence.length < 2) return sequence;
  const offset = startIndex % sequence.length;
  return [...sequence.slice(offset), ...sequence.slice(0, offset)];
}

export function formatEngagementCommentResearch(research: EngagementCommentResearch) {
  return [
    `采样覆盖：相关视频 ${research.relatedVideoCount} 个 / 评论与讨论点 ${research.relatedCommentCount} 条 / 论坛来源 ${research.forumSourceCount} 个`,
    formatList("检索词", research.usedQueries),
    formatList("真实评论区母题", research.themes),
    formatList("近期版本与事件", research.recentTopics),
    formatList("老玩家旧账与生态", research.legacyTopics),
    formatList("萌新自然问题", research.questions),
    formatList("玩家生活与时间成本", research.playerLifeAngles),
    formatList("名人、平台梗与圈层闲聊", research.platformAngles),
    formatList("互怼、追问与回复链角度", research.replyAngles),
    formatList("观望与反对点", research.objections),
    formatList("可借鉴的短口语词", research.phrases),
    formatList("长评结构", research.longCommentPatterns),
    formatList("轻度跑题角度", research.chatterAngles),
    research.summaryError ? `覆盖提醒：${research.summaryError}` : ""
  ].filter(Boolean).join("\n");
}

export function formatEngagementResearchLane(lane: EngagementResearchLane) {
  const labels: Record<EngagementResearchLane, string> = {
    direct: "视频直评：只抓当前视频一个细节，不做完整总结",
    recent: "近期话题：接同游戏/同品类最近版本、活动、玩法或热点，不编新闻",
    legacy: "老玩家旧账：聊长期槽点、生态、收益、平衡或历史包袱，只用调研里出现的母题",
    newcomer: "萌新问题：像第一次刷到的人，只问一个下载、资格、玩法、配置或成本问题",
    life: "玩家生活：从上班、时间、学习成本、练号或消费压力轻度跑题，不冒充亲历",
    platform: "平台与圈层梗：名人、主播、配音、艾特朋友或平台语感，不造谣、不生成真实用户名",
    reply: "回复链：像直接接某条热评的追问、反驳或互怼；单独看也能懂，不虚构用户名"
  };
  return labels[lane];
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

async function planEngagementResearchQueries(
  brief: EngagementResearchBrief,
  localQueries: string[],
  signal?: AbortSignal
) {
  try {
    const result = await chatCompleteStrict(
      [
        {
          role: "system",
          content: "你是中文短视频评论区检索词规划员。只输出 JSON，不解释。"
        },
        {
          role: "user",
          content: `请为跨平台评论区调研生成 3 个短检索词，供 B站、抖音和论坛搜索。

要求：
1. 第一条锁定作品/产品/人物主体；第二条锁定当前版本、事件或具体卖点；第三条覆盖更宽的玩家生态、长期槽点或使用讨论。
2. 每条 2—24 个字，不写“评论、论坛、评测、视频、热搜”，不添加素材里没有的年份、型号或版本。
3. 输出 {"queries":["...","...","..."]}。

主题：${brief.topic}
主体：${brief.subjects.join("、")}
事实：${brief.keyFacts.slice(0, 8).join("；")}
角度：${brief.discussionAngles.slice(0, 6).join("；")}`
        }
      ],
      "low",
      { signal, maxOutputTokens: 360 }
    );
    const object = parseJsonObject(result.text);
    const planned = normalizeList(object?.queries, MAX_RESEARCH_QUERIES)
      .map(cleanSearchQuery)
      .filter(isUsefulSearchQuery);
    const queries = uniqueText([...planned, ...localQueries]).slice(0, MAX_RESEARCH_QUERIES);
    return queries.length
      ? { queries, error: undefined as string | undefined }
      : { queries: localQueries, error: "模型检索词不可用，已使用本地关键词。" };
  } catch (error) {
    throwIfAborted(signal);
    return {
      queries: localQueries,
      error: `模型检索词规划失败，已使用本地关键词：${formatError(error)}`
    };
  }
}

async function collectPlatformResearch(queries: string[], signal?: AbortSignal) {
  const tasks = queries.flatMap((query) => ([
    { source: "bilibili" as const, query },
    { source: "douyin" as const, query }
  ]));
  return mapWithConcurrency(tasks, PLATFORM_RESEARCH_CONCURRENCY, async (task): Promise<PlatformResearchRow> => {
    throwIfAborted(signal);
    try {
      const result = task.source === "bilibili"
        ? await getBilibiliRelatedTopicComments(task.query, { videoLimit: 2, commentLimit: 18, replyLimit: 8, signal })
        : await getDouyinRelatedTopicComments(task.query, { videoLimit: 2, commentLimit: 18, signal });
      return {
        ...task,
        videos: result.videos.map((video) => ({ id: video.id })),
        comments: uniqueText(result.comments).slice(0, 36),
        replyCommentCount: "replyCommentCount" in result ? result.replyCommentCount : 0,
        error: result.comments.length ? undefined : "没有返回可用评论"
      };
    } catch (error) {
      throwIfAborted(signal);
      return { ...task, videos: [], comments: [], replyCommentCount: 0, error: formatError(error) };
    }
  });
}

async function collectForumResearch(
  brief: EngagementResearchBrief,
  queries: string[],
  signal?: AbortSignal
): Promise<ForumResearch> {
  try {
    const result = await webSearchCompleteStrict(
      [
        {
          role: "system",
          content: "你是公开论坛讨论研究员。必须使用 web_search，优先搜索 Reddit、NGA、贴吧、巴哈姆特、官方社区和垂直论坛。只输出 JSON；不得复制长段原文，不得输出用户名。"
        },
        {
          role: "user",
          content: `请搜索与下面主题近期相关的论坛帖子和真实回复，并把观点改写成简短研究样本。

主题：${brief.summary}
主体：${brief.subjects.join("、")}
检索词：${queries.join("、")}
源内事实：${brief.keyFacts.slice(0, 6).join("；")}

返回 JSON：
{
  "sourceCount": 论坛来源数量,
  "discussionCount": 实际采用的讨论点数量,
  "samples": ["对论坛回复的短改写，15—30条"],
  "themes": ["论坛集中讨论母题，5—10条"],
  "questions": ["真实追问，4—8条"],
  "objections": ["反对、担心或旧账，4—8条"],
  "chatterAngles": ["可轻度跑题的圈内话题，3—6条"]
}

没有找到实际帖子回复时 sourceCount 必须为 0，不要用常识伪造。`
        }
      ],
      "medium",
      { signal, maxOutputTokens: 1800 }
    );
    const object = parseJsonObject(result.text);
    if (!object) throw new Error("论坛检索结果没有解析到 JSON");
    const sourceCount = clampInteger(object.sourceCount, 0, 30);
    const samples = normalizeList(object.samples, 36);
    if (!sourceCount || !samples.length) {
      throw new Error("联网搜索没有取得可用论坛回复");
    }
    return {
      sourceCount,
      discussionCount: clampInteger(object.discussionCount, samples.length, 100),
      samples,
      themes: normalizeList(object.themes, 12),
      questions: normalizeList(object.questions, 10),
      objections: normalizeList(object.objections, 10),
      chatterAngles: normalizeList(object.chatterAngles, 8)
    };
  } catch (error) {
    throwIfAborted(signal);
    return {
      sourceCount: 0,
      discussionCount: 0,
      samples: [],
      themes: [],
      questions: [],
      objections: [],
      chatterAngles: [],
      error: `论坛检索失败：${formatError(error)}`
    };
  }
}

async function summarizeResearchSamples(
  brief: EngagementResearchBrief,
  queries: string[],
  samples: string[],
  forum: ForumResearch,
  signal?: AbortSignal
) {
  const result = await chatCompleteStrict(
    [
      {
        role: "system",
        content: "你是评论区研究员。只从真实样本中提炼讨论结构，不生成最终评论，不照抄样本，不添加新闻或事实。只输出 JSON。"
      },
      {
        role: "user",
        content: `当前视频：${brief.summary}
检索词：${queries.join("、")}

B站/抖音真实评论与论坛讨论改写样本：
${samples.slice(0, 140).map((sample) => `- ${clampText(sample, 180)}`).join("\n")}

论坛已取得 ${forum.sourceCount} 个来源、${forum.discussionCount} 个讨论点。

请输出 JSON：
{
  "themes": ["评论区母题，8—14条"],
  "phrases": ["短口语词或圈内词，不是完整句，10—20个"],
  "questions": ["萌新和普通玩家真实会问的问题，6—12条"],
  "objections": ["观望、质疑和担心，6—12条"],
  "recentTopics": ["近期版本、活动、玩法或热点讨论，5—10条"],
  "legacyTopics": ["老玩家旧账、生态、平衡、收益或长期槽点，5—10条"],
  "playerLifeAngles": ["上班、时间、学习成本、消费或练号压力，4—8条"],
  "platformAngles": ["名人、主播、配音、平台梗、艾特朋友等角度，3—7条"],
  "replyAngles": ["适合形成追问、反驳、互怼回复链的观点冲突，4—8条"],
  "longCommentPatterns": ["长评论常见口语结构，4—8条"],
  "chatterAngles": ["轻跑题但仍属于圈层的话题，4—8条"]
}`
      }
    ],
    "medium",
    { signal, maxOutputTokens: 1900 }
  );
  const object = parseJsonObject(result.text);
  if (!object) throw new Error("跨平台评论母题提炼失败：模型没有返回可解析 JSON。");
  return {
    themes: normalizeList(object.themes, 16),
    phrases: normalizeList(object.phrases, 24),
    questions: normalizeList(object.questions, 14),
    objections: normalizeList(object.objections, 14),
    recentTopics: normalizeList(object.recentTopics, 12),
    legacyTopics: normalizeList(object.legacyTopics, 12),
    playerLifeAngles: normalizeList(object.playerLifeAngles, 10),
    platformAngles: normalizeList(object.platformAngles, 10),
    replyAngles: normalizeList(object.replyAngles, 10),
    longCommentPatterns: normalizeList(object.longCommentPatterns, 10),
    chatterAngles: normalizeList(object.chatterAngles, 10)
  };
}

function buildSourceStats(platformRows: PlatformResearchRow[], forum: ForumResearch): EngagementResearchSourceStat[] {
  const platformStats = (["bilibili", "douyin"] as const).map((source): EngagementResearchSourceStat => {
    const rows = platformRows.filter((row) => row.source === source);
    const videoCount = new Set(rows.flatMap((row) => row.videos.map((video) => video.id))).size;
    const commentCount = uniqueText(rows.flatMap((row) => row.comments)).length;
    const errors = uniqueText(rows.map((row) => row.error || ""));
    return {
      source,
      status: commentCount ? (errors.length ? "partial" : "completed") : "failed",
      videoCount,
      commentCount,
      error: errors.length ? errors.join("；") : undefined
    };
  });
  return [
    ...platformStats,
    {
      source: "forum",
      status: forum.error ? "failed" : "completed",
      videoCount: 0,
      commentCount: forum.discussionCount || forum.samples.length,
      error: forum.error
    }
  ];
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
    .slice(0, 32);
}

function isUsefulSearchQuery(value: string) {
  if (value.length < 2) return false;
  if (/^(?:粘贴文案|视频链接|评论素材|生成评论|评论区|平台自然|原评增强)$/.test(value)) return false;
  return /[\u4e00-\u9fa5A-Za-z0-9]/.test(value);
}

function searchKey(value: string) {
  return value.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").toLowerCase();
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

function normalizeList(value: unknown, limit: number) {
  return uniqueText(Array.isArray(value) ? value.map((item) => String(item || "")) : []).slice(0, limit);
}

function clampInteger(value: unknown, min: number, max: number) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function formatList(label: string, values: string[]) {
  return values.length ? `${label}：\n${values.map((value) => `- ${value}`).join("\n")}` : "";
}

function formatSource(source: EngagementResearchSourceStat["source"]) {
  if (source === "bilibili") return "B站";
  if (source === "douyin") return "抖音";
  return "论坛";
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

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("任务已停止");
}
