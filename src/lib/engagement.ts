import { chatComplete } from "./ai";
import {
  getBilibiliComments,
  getBilibiliVideoReference,
  getDouyinRelatedTopicComments,
  getDouyinTopComments
} from "./opencli";
import {
  getAccountSummary,
  getProjectSummary,
  readTranscript,
  resolveAccount,
  resolveDraft,
  resolveProject,
  saveVideoAssetFields,
  updateDraftAssets
} from "./storage";
import {
  Draft,
  DraftCommentAsset,
  DraftDanmakuAsset,
  Platform
} from "./types";
import { clampText, nowIso, shortHash } from "./utils";

type SourceContext = {
  platform: Platform;
  accountId: string;
  accountName: string;
  comments: string[];
  relatedComments: string[];
  relatedQuery?: string;
  commentStyle?: string;
  danmaku: string[];
  transcripts: string[];
};

export async function generateDraftEngagement(input: {
  draftId: string;
  commentCount: number;
  danmakuCount: number;
}) {
  const resolved = await resolveDraft(input.draftId);
  const draft = resolved.draft;
  const contexts = await buildSourceContexts(draft);
  const commentCount = clampCount(input.commentCount, 1, 200, 50);
  const danmakuCount = clampCount(input.danmakuCount, 1, 300, 100);
  const comments = await generateComments(draft, contexts, commentCount);
  const bilibiliContexts = contexts.filter((context) => context.platform === "bilibili");
  const danmaku = bilibiliContexts.length ? await generateDanmaku(draft, bilibiliContexts, danmakuCount) : null;

  const next = await updateDraftAssets(draft.id, (current) => ({
    ...current,
    comments: {
      generatedAt: nowIso(),
      requestedCount: commentCount,
      usedModel: comments.usedModel,
      fallback: comments.fallback,
      fallbackReason: comments.fallbackReason,
      items: comments.items
    },
    danmaku: danmaku
      ? {
          generatedAt: nowIso(),
          requestedCount: danmakuCount,
          usedModel: danmaku.usedModel,
          fallback: danmaku.fallback,
          fallbackReason: danmaku.fallbackReason,
          items: danmaku.items
        }
      : current.danmaku
  }));

  return {
    draft: next,
    comments: next.assets?.comments,
    danmaku: next.assets?.danmaku,
    supportsDanmaku: Boolean(bilibiliContexts.length)
  };
}

async function buildSourceContexts(draft: Draft) {
  if (draft.targetType === "project") {
    const project = await resolveProject(draft.projectId);
    const summary = await getProjectSummary(project);
    const contexts = await Promise.all(
      summary.sourceAccounts.map((source) => buildAccountSourceContext(source.platform, source.id, source.name, [], draft))
    );
    return contexts;
  }

  return [await buildAccountSourceContext(draft.platform, draft.accountId, draft.accountName, draft.styleRef.videoIds || [], draft)];
}

async function buildAccountSourceContext(
  platform: Platform,
  accountId: string,
  accountName: string,
  sourceVideoIds: string[] = [],
  draft?: Draft
): Promise<SourceContext> {
  const account = await resolveAccount(platform, accountId);
  const summary = await getAccountSummary(account);
  const contextVideos = prioritizeVideos(summary.videos, sourceVideoIds).slice(0, 10);
  const related = platform === "douyin" && draft ? await collectDouyinRelatedCommentSamples(draft) : null;
  const relatedComments = related?.comments || [];
  if (platform === "douyin" && !relatedComments.length) {
    throw new Error(`没有采集到抖音相关话题评论样本：${related?.query || "未生成有效搜索词"}`);
  }
  const comments = platform === "douyin" ? relatedComments : await collectCommentSamples(platform, accountId, contextVideos);
  const commentStyle = comments.length >= 8 ? await analyzeCommentStyle(platform, accountName, comments) : "";
  const danmaku = platform === "bilibili" ? await collectDanmakuSamples(accountId, contextVideos) : [];
  const transcriptSamples = await Promise.all(
    contextVideos.slice(0, 3).map(async (video) => {
      const transcript = await readTranscript(platform, accountId, video.id);
      return transcript.trim() ? `《${video.title}》\n${clampText(transcript, 900)}` : "";
    })
  );

  return {
    platform,
    accountId,
    accountName,
    comments,
    relatedComments,
    relatedQuery: related?.query,
    commentStyle,
    danmaku,
    transcripts: transcriptSamples.filter(Boolean)
  };
}

async function collectCommentSamples(platform: Platform, accountId: string, videos: Awaited<ReturnType<typeof getAccountSummary>>["videos"]) {
  if (platform === "bilibili") {
    const rows = await Promise.all(
      videos.slice(0, 5).map((video) =>
        getBilibiliComments(video, 30)
          .then((comments) => comments.map((comment) => comment.text))
          .catch(() => [])
      )
    );
    return uniqueText(rows.flat()).slice(0, 120);
  }

  const fromVideo = videos.flatMap((video) => video.topComments || []);
  const account = await resolveAccount(platform, accountId);
  const refreshed = await getDouyinTopComments(account, { limit: 30, commentLimit: 20 }).catch(() => []);
  return cleanCommentSamples([...fromVideo, ...refreshed]).slice(0, 180);
}

async function collectDouyinRelatedCommentSamples(draft: Draft) {
  const query = buildDouyinRelatedCommentQuery(draft);
  if (!query) return { query: "", comments: [] };
  const result = await getDouyinRelatedTopicComments(query, { videoLimit: 6, commentLimit: 20 });
  return {
    query: result.query,
    comments: cleanCommentSamples(result.comments).slice(0, 120)
  };
}

async function collectDanmakuSamples(accountId: string, videos: Awaited<ReturnType<typeof getAccountSummary>>["videos"]) {
  const samples: string[] = [];
  for (const video of videos.slice(0, 3)) {
    if (video.danmakuSamples?.length) {
      samples.push(...video.danmakuSamples);
      continue;
    }
    const collected = await fetchBilibiliDanmaku(video).catch(() => []);
    if (collected.length) {
      samples.push(...collected);
      await saveVideoAssetFields("bilibili", accountId, video.id, {
        danmakuSamples: collected,
        raw: {
          ...(typeof video.raw === "object" && video.raw ? video.raw : {}),
          danmakuSampledAt: nowIso()
        }
      }).catch(() => undefined);
    }
  }
  return uniqueText(samples).slice(0, 180);
}

async function fetchBilibiliDanmaku(video: Awaited<ReturnType<typeof getAccountSummary>>["videos"][number]) {
  const reference = await getBilibiliVideoReference(video);
  if (!reference?.cid) return [];
  const response = await fetch(`https://comment.bilibili.com/${encodeURIComponent(reference.cid)}.xml`, {
    headers: {
      "User-Agent": "Mozilla/5.0 style-library"
    }
  });
  if (!response.ok) return [];
  const xml = await response.text();
  return [...xml.matchAll(/<d\b[^>]*>([\s\S]*?)<\/d>/g)]
    .map((match) => decodeXml(match[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 120);
}

async function generateComments(draft: Draft, contexts: SourceContext[], count: number) {
  const samples = contexts
    .map(
      (context) =>
        `平台：${context.platform}\n账号：${context.accountName}\n相关话题搜索词：${context.relatedQuery || "无"}\n评论区语感分析：\n${context.commentStyle || "暂无"}\n相关话题真实热评：\n${context.relatedComments.slice(0, 70).join("\n") || "暂无"}\n账号评论样本：\n${context.comments.filter((comment) => !context.relatedComments.includes(comment)).slice(0, 50).join("\n") || "暂无"}`
    )
    .join("\n\n---\n\n");
  const result = await chatComplete(
    [
      {
        role: "system",
        content:
          "你是中文短视频评论策划助手。请学习账号真实评论区语感，为新文案生成像普通观众会发的热评池。不要生成用户名，不要攻击、造谣、色情、歧视或引导刷量。只输出 JSON 数组，每项为字符串。"
      },
      {
        role: "user",
        content: `文案标题：${draft.title}\n文案内容：\n${clampText(draft.content, 4000)}\n\n真实评论区参考：\n${samples}\n\n请生成 ${count} 条观众评论。要求：优先模仿“相关话题真实热评”的语气、长度、标点、立场和梗，账号评论样本只作为辅助；短中长混合，包含提问、共鸣、玩梗、补充观点、轻度反驳；不要写成客服话术、营销话术、总结文案或AI评论；避免重复。`
      }
    ],
    "medium"
  );
  const parsed = parseStringArray(result.text);
  const texts = parsed.length ? parsed : buildFallbackComments(draft, contexts, count);
  return {
    usedModel: result.model,
    fallback: result.fallback || !parsed.length,
    fallbackReason: result.fallbackReason || (!parsed.length ? "模型没有返回可解析评论，已使用本地模板。" : undefined),
    items: texts.slice(0, count).map((text, index) => makeCommentItem(text, contexts[index % Math.max(contexts.length, 1)]?.platform || "bilibili", index))
  };
}

async function analyzeCommentStyle(platform: Platform, accountName: string, comments: string[]) {
  const result = await chatComplete(
    [
      {
        role: "system",
        content:
          "你是中文短视频评论区语感分析助手。只基于给定真实评论样本，总结观众会怎么说话，不要创作评论。输出 6 条以内中文要点。"
      },
      {
        role: "user",
        content: `平台：${platform}\n账号：${accountName}\n真实评论样本：\n${comments.slice(0, 120).join("\n")}\n\n请分析这些评论的：常见句长、口头禅/语气词、标点习惯、玩梗方式、提问方式、情绪强度，以及生成时必须避免的机器味。`
      }
    ],
    "medium"
  );
  return result.text.trim() || "";
}

async function generateDanmaku(draft: Draft, contexts: SourceContext[], count: number) {
  const samples = contexts
    .map((context) => `账号：${context.accountName}\n弹幕样本：\n${context.danmaku.slice(0, 70).join("\n") || "暂无弹幕样本"}`)
    .join("\n\n---\n\n");
  const result = await chatComplete(
    [
      {
        role: "system",
        content:
          "你是 B站弹幕策划助手。请基于文案生成可用于剪辑参考的弹幕时间表。只输出 JSON 数组，每项为 {\"timeSec\":数字,\"text\":\"弹幕\"}。弹幕要短、像真实观众，避免低俗攻击和重复刷屏。"
      },
      {
        role: "user",
        content: `文案：\n${clampText(draft.content, 4200)}\n\n参考弹幕：\n${samples}\n\n请生成 ${count} 条弹幕。时间点按约 ${estimateDurationSec(draft.content)} 秒口播均匀但有疏密变化分布。`
      }
    ],
    "medium"
  );
  const parsed = parseDanmakuArray(result.text);
  const items = parsed.length ? parsed : buildFallbackDanmaku(draft, count);
  return {
    usedModel: result.model,
    fallback: result.fallback || !parsed.length,
    fallbackReason: result.fallbackReason || (!parsed.length ? "模型没有返回可解析弹幕，已使用本地模板。" : undefined),
    items: items.slice(0, count).map((item, index) => ({
      id: `danmaku-${index + 1}-${shortHash(`${item.timeSec}-${item.text}`)}`,
      timeSec: Math.max(0, Math.round(item.timeSec)),
      text: item.text.trim()
    }))
  };
}

function buildFallbackComments(draft: Draft, contexts: SourceContext[], count: number) {
  const seeds = [
    "这段说得挺扎心",
    "先收藏，回头按这个思路试一下",
    "开头就把我说进来了",
    "这个角度之前真没想到",
    "评论区有没有同样情况的",
    "感觉可以展开讲一期",
    "这句可以直接记下来",
    "比单纯讲方法更有用",
    "终于有人把这件事说清楚了",
    "后面那个判断很关键"
  ];
  const platformHint = contexts.map((context) => context.platform).includes("bilibili") ? "B站" : "抖音";
  return Array.from({ length: count }, (_, index) => {
    const seed = seeds[index % seeds.length];
    return index % 5 === 0 ? `${seed}，${draft.title.slice(0, 14)}这块太真实了` : `${seed}。`;
  }).map((text, index) => (index % 11 === 0 ? `${text} ${platformHint}观众集合` : text));
}

function buildFallbackDanmaku(draft: Draft, count: number): DraftDanmakuAsset[] {
  const duration = estimateDurationSec(draft.content);
  const seeds = ["来了", "这句重点", "真实", "先暂停记一下", "懂了", "这个角度可以", "有点东西", "前方高能", "说到点上了", "收藏了"];
  return Array.from({ length: count }, (_, index) => ({
    id: `danmaku-${index + 1}-${shortHash(`${draft.id}-${index}`)}`,
    timeSec: Math.round((duration / Math.max(count, 1)) * index),
    text: seeds[index % seeds.length]
  }));
}

function makeCommentItem(text: string, platform: Platform, index: number): DraftCommentAsset {
  return {
    id: `comment-${index + 1}-${shortHash(text)}`,
    platform,
    text: text.trim()
  };
}

function parseStringArray(text: string) {
  const parsed = parseJsonFromText(text);
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { comments?: unknown[] }).comments)
      ? (parsed as { comments: unknown[] }).comments
      : [];
  return uniqueText(values.map((value) => (typeof value === "string" ? value : ""))).filter(Boolean);
}

function parseDanmakuArray(text: string) {
  const parsed = parseJsonFromText(text);
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { danmaku?: unknown[] }).danmaku)
      ? (parsed as { danmaku: unknown[] }).danmaku
      : [];
  return values
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const object = value as Record<string, unknown>;
      const text = typeof object.text === "string" ? object.text.trim() : "";
      const timeSec = Number(object.timeSec ?? object.time ?? object.at ?? 0);
      return text ? { timeSec: Number.isFinite(timeSec) ? timeSec : 0, text } : null;
    })
    .filter((item): item is { timeSec: number; text: string } => Boolean(item));
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) || trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (!match?.[1]) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function prioritizeVideos<T extends { id: string }>(videos: T[], sourceVideoIds: string[]) {
  if (!sourceVideoIds.length) return videos;
  const preferred = new Set(sourceVideoIds);
  return [...videos].sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)));
}

type CommentQueryCandidate = {
  value: string;
  score: number;
  index: number;
  count: number;
};

function buildDouyinRelatedCommentQuery(draft: Draft) {
  const candidates: CommentQueryCandidate[] = [];
  let index = 0;
  const addCandidate = (value: string, score: number) => {
    const normalized = normalizeCommentQueryTerm(value);
    if (!isUsableCommentQueryTerm(normalized)) return;
    candidates.push({
      value: normalized,
      score: score + commentQueryTermScore(normalized),
      index,
      count: 1
    });
    index += 1;
  };

  const primarySource = draft.content;
  const supportingSource = `${draft.input || ""}\n${draft.prompt}`;
  for (const term of extractCommentQueryHashtags(primarySource)) {
    addCandidate(term, 6_000);
  }

  for (const term of extractCommentQueryHashtags(supportingSource)) {
    addCandidate(term, 1_000);
  }

  for (const title of extractDraftTitleTexts(draft)) {
    addCandidate(title, 5_000);
    for (const term of extractCommentQueryTerms(title)) {
      addCandidate(term, 4_800);
    }
  }

  for (const term of extractCommentQueryTerms(primarySource)) {
    addCandidate(term, 2_400);
  }

  for (const term of extractCommentQueryTerms(supportingSource)) {
    addCandidate(term, 300);
  }

  const best = new Map<string, CommentQueryCandidate>();
  for (const candidate of candidates) {
    const key = candidate.value.toLowerCase();
    const current = best.get(key);
    if (!current) {
      best.set(key, candidate);
      continue;
    }
    best.set(key, {
      value: current.score >= candidate.score ? current.value : candidate.value,
      score: Math.max(current.score, candidate.score) + Math.min(current.count, 6) * 25,
      index: Math.min(current.index, candidate.index),
      count: current.count + 1
    });
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 6)
    .map((candidate) => candidate.value)
    .join(" ")
    .trim();
}

function extractCommentQueryHashtags(source: string) {
  return [...source.matchAll(/#[\t ]*([\u4e00-\u9fa5A-Za-z0-9_]{2,24})/g)].map((match) => match[1]);
}

function extractDraftTitleTexts(draft: Draft) {
  const candidates = [
    draft.title,
    ...extractInlineTitleTexts(draft.content),
    ...extractInlineTitleTexts(draft.prompt)
  ];
  return uniqueText(candidates.map(cleanCommentQueryTitle).filter(Boolean));
}

function extractInlineTitleTexts(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const titles: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/^[#>\s-]+/, "").trim();
    const inline = line.match(/^(?:标题|题目|名称)\s*[：:]\s*(.+)$/);
    if (inline?.[1]) titles.push(inline[1]);
    if (/^(?:标题|题目|名称)$/.test(line) && lines[index + 1]) titles.push(lines[index + 1]);
  }
  return titles;
}

function extractCommentQueryTerms(source: string) {
  const normalized = stripCommentQueryNoise(source)
    .replace(/[#*_`>]+/g, " ")
    .replace(/[，,。.!！?？；;：:、｜|/\\()[\]{}<>《》“”"‘’]+/g, "\n");
  const terms: string[] = [];
  for (const raw of normalized.split(/\s+/)) {
    const cleaned = normalizeCommentQueryTerm(raw);
    if (isUsableCommentQueryTerm(cleaned)) terms.push(cleaned);
    if (/[\u4e00-\u9fa5]/.test(cleaned) && Array.from(cleaned).length > 8) {
      terms.push(...extractChineseSubTerms(cleaned));
    }
  }
  return uniqueText(terms);
}

function extractChineseSubTerms(value: string) {
  const segments = segmentChineseWords(value);
  const terms = segments.filter((word) => isUsableCommentQueryTerm(word));
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isUsableCommentQueryTerm(segments[index]) || !isUsableCommentQueryTerm(segments[index + 1])) continue;
    const combined = normalizeCommentQueryTerm(`${segments[index]}${segments[index + 1]}`);
    if (isUsableCommentQueryTerm(combined)) terms.push(combined);
  }
  return uniqueText(terms);
}

function segmentChineseWords(value: string) {
  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter("zh", { granularity: "word" })
      : null;
  if (!segmenter) return [];
  return [...segmenter.segment(value)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => normalizeCommentQueryTerm(segment.segment))
    .filter(Boolean);
}

function stripCommentQueryNoise(source: string) {
  return source
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/v\.douyin\.com\/\S+/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b[a-zA-Z]\s*@\s*[a-zA-Z.]+\b/g, " ")
    .replace(/复制此链接.*?(?:观看视频|$)/g, " ")
    .replace(/打开Dou音搜索|打开抖音搜索|直接观看视频/g, " ");
}

function cleanCommentQueryTitle(value: string) {
  return normalizeCommentQueryTerm(
    value
      .replace(/#[\t ]*[\u4e00-\u9fa5A-Za-z0-9_]{2,24}/g, " ")
      .replace(/^(标题|题目|名称|正文|文案|口播稿)\s*[：:]?/i, " ")
  );
}

function normalizeCommentQueryTerm(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^[\s#>*_`"'“”‘’《》-]+|[\s#>*_`"'“”‘’《》-]+$/g, "")
    .replace(/^(?:关于|最近|这个|那个|一条|一篇|一些|一个|一种|写一条|生成|保留|素材|核心|信息|话题角)+/g, "")
    .replace(/(?:的|了|啊|吧|吗|呢|呀|哦|哈)$/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9._-]+/g, "")
    .trim();
}

function isUsableCommentQueryTerm(value: string) {
  if (!value) return false;
  const lower = value.toLowerCase();
  const length = Array.from(value).length;
  if (length < 2 || length > 14) return false;
  if (COMMENT_QUERY_STOP_WORDS.has(lower)) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^[a-z]\.[a-z]/i.test(value)) return false;
  if (/^(?:am|pm)$/i.test(value)) return false;
  if (/^[\u4e00-\u9fa5]{2}$/.test(value) && COMMENT_QUERY_SHORT_STOP_WORDS.has(value)) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(value);
}

const COMMENT_QUERY_STOP_WORDS = new Set([
  "关于",
  "最近",
  "写一条",
  "文案",
  "视频",
  "评论",
  "弹幕",
  "生成",
  "一个",
  "这种",
  "不是",
  "因为",
  "所以",
  "但是",
  "这个",
  "我们",
  "他们",
  "粉丝",
  "账号",
  "标题",
  "题目",
  "名称",
  "正文",
  "口播",
  "口播正文",
  "素材",
  "核心",
  "信息",
  "话题",
  "话题角",
  "热点",
  "内容启发搜索",
  "复制此链接",
  "直接观看视频",
  "dou音搜索",
  "抖音搜索",
  "ai",
  "bro"
]);

const COMMENT_QUERY_SHORT_STOP_WORDS = new Set([
  "视频",
  "评论",
  "弹幕",
  "素材",
  "核心",
  "信息",
  "话题",
  "热点",
  "账号",
  "文案",
  "生成",
  "保留",
  "最近",
  "这个",
  "那个",
  "因为",
  "所以",
  "但是",
  "我们",
  "他们",
  "大家",
  "有人",
  "没有",
  "什么",
  "怎么",
  "直接",
  "观看"
]);

function commentQueryTermScore(value: string) {
  const length = Array.from(value).length;
  const hasChinese = /[\u4e00-\u9fa5]/.test(value);
  if (/^[A-Za-z]/.test(value)) return 120 + Math.min(length, 24);
  if (hasChinese && length >= 3 && length <= 7) return 180 - Math.abs(length - 4) * 8;
  return Math.max(20, 100 - Math.abs(length - 6) * 6);
}

function cleanCommentSamples(values: string[]) {
  return uniqueText(values)
    .map((value) => value.replace(/^"+|"+$/g, "").trim())
    .filter((value) => value.length >= 2 && value.length <= 140)
    .filter((value) => !/^\{.*\}$/.test(value) && !/^\[.*\]$/.test(value))
    .filter((value) => !isLikelyCommentNoise(value));
}

function isLikelyCommentNoise(value: string) {
  const text = value.trim();
  if (/^@/.test(text)) return true;
  if (/^作者$|^刚刚[·・]|^\d+\s*[分钟前小时天前]/.test(text)) return true;
  if (/© 抖音|京ICP|京公网安备|许可证|营业执照|用户服务协议|隐私政策|联系我们|友情链接|下载抖音|抖音电商|举报/.test(text)) return true;
  if (/^用户[_\d]+$/.test(text) || /^[\w.-]{1,18}$/.test(text)) return true;
  if (/相互尊重|期待正片|不好.*评论|直接删除|Peace|控评|净化|反黑|做数据|养号|必须留|听前辈|艾特我/i.test(text)) return true;
  if (/大家别太媚韩|粉丝一直攻击|别来沾边|抱走|不约|别吵|别带/i.test(text)) return true;
  if (/^[#\s\p{L}\p{N}]+$/u.test(text) && text.replace(/[#\s]/g, "").length <= 1) return true;
  if (text.length > 90 && /[，,].*[，,].*[，,].*[，,]/.test(text)) return true;
  if (text.length > 100 && /因为|所以|但是|而且|同时|如果|虽然/.test(text)) return true;
  return false;
}

function clampCount(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function estimateDurationSec(content: string) {
  const text = content.replace(/\s+/g, "");
  return Math.max(30, Math.min(600, Math.round(text.length / 4.2)));
}

function decodeXml(input: string) {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
