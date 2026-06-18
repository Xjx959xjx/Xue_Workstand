import { chatCompleteStrict, getChatRuntimeConfig } from "./ai";
import {
  getBilibiliRelatedTopicComments,
  getDouyinRelatedTopicComments,
  getBilibiliVideoReference
} from "./opencli";
import {
  getAccountSummary,
  getProjectSummary,
  resolveAccount,
  resolveDraft,
  resolveProject,
  saveEngagementRecord,
  saveVideoAssetFields,
  updateDraftAssets
} from "./storage";
import { transcribeLinkSource } from "./transcription";
import {
  Draft,
  DraftCommentAsset,
  EngagementRecord,
  Platform
} from "./types";
import { clampText, nowIso, shortHash } from "./utils";

type EngagementContent = {
  id: string;
  title: string;
  content: string;
  prompt?: string;
  input?: string;
};

type EngagementOptions = {
  includeComments?: boolean;
  commentCount?: number;
  includeDanmaku?: boolean;
  danmakuCount?: number;
};

export type GenerateEngagementInput = EngagementOptions & (
  | { sourceType: "draft"; draftId: string }
  | { sourceType: "text"; title?: string; text: string }
  | { sourceType: "url"; url: string }
);

export type GenerateEngagementOptions = {
  signal?: AbortSignal;
};

type SourceContext = {
  platform: Platform;
  accountId: string;
  accountName: string;
  danmaku: string[];
};

type CommentSourceBrief = {
  summary: string;
  topic: string;
  subjects: string[];
  keyFacts: string[];
  audiencePersonas: string[];
  viewerScenes: string[];
  discussionAngles: string[];
  skepticalAngles: string[];
  mustAvoid: string[];
  anchorTerms: string[];
};

type CommentRelatedResearch = {
  usedQueries: string[];
  failedQueries: string[];
  relatedVideoCount: number;
  relatedCommentCount: number;
  longCommentCount: number;
  lengthBuckets: {
    short: number;
    medium: number;
    long: number;
  };
  intentBuckets: CommentIntentBuckets;
  themes: string[];
  phrases: string[];
  questions: string[];
  objections: string[];
  longCommentPatterns: string[];
  chatterAngles: string[];
  summaryError?: string;
};

type CommentIntent =
  | "reaction"
  | "question"
  | "price"
  | "comparison"
  | "skeptical"
  | "experience"
  | "follow"
  | "chatter";

type CommentIntentBuckets = Record<CommentIntent, number>;

type CommentEntityCorrection = {
  from: string;
  to: string;
  stage: "brief" | "relatedResearch" | "comment";
};

type CommentEntityGuard = {
  allowedModels: string[];
  allowedModelKeys: Set<string>;
};

const COMMENT_GENERATION_BATCH_SIZE = 25;
const COMMENT_PROMPT_VARIANTS = [
  "这批偏向第一反应式短评，多给共鸣、代入、随手接话的感觉；不要都写成完整判断句。",
  "这批偏向挑具体卖点、配置、价格或使用场景接话，不要空泛夸好。",
  "这批偏向提问、追问、补充观点，让评论区像有人继续接话；问题句不要都用“会不会/是不是”。",
  "这批偏向经验对照和个人感受，像把自己的经历往里套一下。",
  "这批偏向轻度反转、意外点和细节观察，不要写成总结。",
  "这批偏向实用判断和真实取舍，像在评论区说自己会不会这么做。",
  "这批偏向真实观望和保留意见，可以问缺点、门槛、适不适合自己。",
  "这批偏向围观感和讨论感，像在跟其他观众一起看热闹。"
] as const;
const COMMENT_MODEL_CONCURRENCY = clampCount(Number.parseInt(process.env.ENGAGEMENT_MODEL_CONCURRENCY || "", 10), 1, 4, 4);
const COMMENT_GENERATION_MAX_ROUNDS = 3;
const ENABLE_MODEL_COMMENT_GENERATION =
  getChatRuntimeConfig().configured && process.env.ENGAGEMENT_MODEL_COMMENTS !== "0";
const KNOWN_ENGAGEMENT_TERM_CORRECTIONS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /脉冲\s*G87\s*V?2/gi, replacement: "迈从G87V2" },
  { pattern: /脉冲\s*G87/gi, replacement: "迈从G87" },
  { pattern: /\bwin\s*75\b/gi, replacement: "Rainy75" },
  { pattern: /锐奇\s*五/g, replacement: "锐七五" },
  { pattern: /\bA?ATK\s*I\s*S6\s*L?\b/gi, replacement: "ATK RS6" },
  { pattern: /\bA\s*ATK\s*RS6\s*L?\b/gi, replacement: "ATK RS6" },
  { pattern: /\b(?:ATK\s*)?RS\s*6\s*L\b/gi, replacement: "ATK RS6" },
  { pattern: /黑\s*GMK87/g, replacement: "黑爵MK87" },
  { pattern: /\btape\s*7\s*接口/gi, replacement: "Type-C接口" },
  { pattern: /27\s*件紧凑布局/g, replacement: "87键紧凑布局" },
  { pattern: /今年6月8是直降/g, replacement: "今年618是直降" }
];

export async function generateEngagement(input: GenerateEngagementInput, runOptions: GenerateEngagementOptions = {}) {
  throwIfAborted(runOptions.signal);
  const options = normalizeEngagementOptions(input);
  if (!options.includeComments && !options.includeDanmaku) {
    throw new Error("请至少选择评论或弹幕。");
  }

  const prepared = await prepareEngagementSource(input, options, runOptions.signal);
  throwIfAborted(runOptions.signal);
  const commentsPromise = options.includeComments
    ? generateComments(prepared.content, prepared.contexts, options.commentCount, prepared.platform, runOptions.signal)
    : Promise.resolve(null);
  const danmakuPromise = options.includeDanmaku
    ? generateDanmaku(prepared.content, prepared.contexts, options.danmakuCount, runOptions.signal)
    : Promise.resolve(null);
  const [comments, danmaku] = await Promise.all([commentsPromise, danmakuPromise]);
  throwIfAborted(runOptions.signal);

  let draft: Draft | undefined;
  if (prepared.draft) {
    draft = await updateDraftAssets(prepared.draft.id, (current) => ({
      ...current,
      comments: comments
        ? {
            generatedAt: nowIso(),
            requestedCount: options.commentCount,
            usedModel: comments.usedModel,
            fallback: comments.fallback,
            fallbackReason: comments.fallbackReason,
            diagnostics: comments.diagnostics,
            items: comments.items
          }
        : current.comments,
      danmaku: danmaku
        ? {
            generatedAt: nowIso(),
            requestedCount: options.danmakuCount,
            usedModel: danmaku.usedModel,
            fallback: danmaku.fallback,
            fallbackReason: danmaku.fallbackReason,
            items: danmaku.items
          }
        : current.danmaku
    }));
  }

  const record = await saveEngagementRecord({
    sourceType: input.sourceType,
    title: prepared.content.title,
    sourceAccountName: prepared.sourceAccountName,
    sourceUrl: prepared.sourceUrl,
    resolvedUrl: prepared.resolvedUrl,
    platform: prepared.platform,
    draftId: prepared.draft?.id,
    sourceText: prepared.content.content,
    options,
    comments: comments
      ? {
          generatedAt: nowIso(),
          requestedCount: options.commentCount,
          usedModel: comments.usedModel,
          fallback: comments.fallback,
          fallbackReason: comments.fallbackReason,
          diagnostics: comments.diagnostics,
          items: comments.items
        }
      : undefined,
    danmaku: danmaku
      ? {
          generatedAt: nowIso(),
          requestedCount: options.danmakuCount,
          usedModel: danmaku.usedModel,
          fallback: danmaku.fallback,
          fallbackReason: danmaku.fallbackReason,
          items: danmaku.items
        }
      : undefined,
    fallback: Boolean(comments?.fallback || danmaku?.fallback || prepared.fallback),
    fallbackReason: [prepared.fallbackReason, comments?.fallbackReason, danmaku?.fallbackReason]
      .filter(Boolean)
      .join("；") || undefined
  });

  return {
    draft,
    record,
    comments: record.comments,
    danmaku: record.danmaku
  };
}

export async function generateDraftEngagement(input: {
  draftId: string;
  commentCount: number;
  danmakuCount: number;
}) {
  const resolved = await resolveDraft(input.draftId);
  const supportsDanmaku = draftSupportsBilibili(resolved.draft);
  const result = await generateEngagement({
    sourceType: "draft",
    draftId: input.draftId,
    includeComments: true,
    commentCount: input.commentCount,
    includeDanmaku: supportsDanmaku,
    danmakuCount: input.danmakuCount
  });
  const next = result.draft ?? resolved.draft;
  return {
    draft: next,
    comments: next.assets?.comments,
    danmaku: next.assets?.danmaku,
    supportsDanmaku
  };
}

async function buildSourceContexts(draft: Draft, options: { includeDanmaku: boolean }) {
  if (draft.targetType === "project") {
    const project = await resolveProject(draft.projectId);
    const summary = await getProjectSummary(project);
    const contexts = await Promise.all(
      summary.sourceAccounts.map((source) => buildAccountSourceContext(source.platform, source.id, source.name, [], options))
    );
    return contexts;
  }

  return [await buildAccountSourceContext(draft.platform, draft.accountId, draft.accountName, draft.styleRef.videoIds || [], options)];
}

async function prepareEngagementSource(input: GenerateEngagementInput, options: EngagementRecord["options"], signal?: AbortSignal): Promise<{
  content: EngagementContent;
  contexts: SourceContext[];
  platform: Platform | "unknown";
  draft?: Draft;
  sourceUrl?: string;
  resolvedUrl?: string;
  sourceAccountName?: string;
  fallback?: boolean;
  fallbackReason?: string;
}> {
  throwIfAborted(signal);
  if (input.sourceType === "draft") {
    const resolved = await resolveDraft(input.draftId);
    const draft = resolved.draft;
    const contexts = await buildSourceContexts(draft, { includeDanmaku: options.includeDanmaku });
    const platform = draft.targetType === "project" ? contexts[0]?.platform || "unknown" : draft.platform;
    return {
      content: draftToEngagementContent(draft),
      contexts,
      platform,
      draft
    };
  }

  if (input.sourceType === "text") {
    const text = normalizeKnownEngagementTerms(input.text.trim());
    if (!text) throw new Error("请粘贴文案后再生成。");
    return {
      content: {
        id: `text-${shortHash(text)}`,
        title: normalizeKnownEngagementTerms(input.title?.trim() || makeEngagementTitle(text, "粘贴文案")),
        content: text,
        prompt: "",
        input: text
      },
      contexts: [],
      platform: "unknown"
    };
  }

  const url = input.url.trim();
  if (!url) throw new Error("请填写视频链接。");
  try {
    const result = await transcribeLinkSource({ url, signal });
    if (result.source === "metadata" || !result.text.trim()) {
      throw new Error(result.fallbackReason || "只解析到视频标题，没有取得可用于评论生成的视频文稿。");
    }
    const content = {
      id: `url-${shortHash(result.resolvedUrl || result.url || url)}`,
      title: normalizeKnownEngagementTerms(result.title || makeEngagementTitle(result.text || url, "视频链接")),
      content: normalizeKnownEngagementTerms(result.text),
      prompt: "",
      input: url
    };
    return {
      content,
      contexts: [],
      platform: result.platform,
      sourceUrl: result.url,
      resolvedUrl: result.resolvedUrl,
      sourceAccountName: result.sourceAccountName,
      fallback: result.fallback,
      fallbackReason: result.fallbackReason
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "链接内容读取失败";
    if (/暂不支持|没有解析到/.test(message)) {
      throw new Error(`暂不支持从这个链接生成评论。请使用 B站/抖音视频链接，或改用粘贴文案。${message ? `（${message}）` : ""}`);
    }
    throw error;
  }
}

function normalizeEngagementOptions(input: EngagementOptions): EngagementRecord["options"] {
  return {
    includeComments: input.includeComments ?? true,
    commentCount: clampCount(input.commentCount ?? 100, 1, 200, 100),
    includeDanmaku: input.includeDanmaku ?? false,
    danmakuCount: clampCount(input.danmakuCount ?? 50, 1, 300, 50)
  };
}

function draftToEngagementContent(draft: Draft): EngagementContent {
  return {
    id: draft.id,
    title: normalizeKnownEngagementTerms(draft.title),
    content: normalizeKnownEngagementTerms(draft.content),
    prompt: draft.prompt ? normalizeKnownEngagementTerms(draft.prompt) : draft.prompt,
    input: draft.input ? normalizeKnownEngagementTerms(draft.input) : draft.input
  };
}

function normalizeKnownEngagementTerms(text: string) {
  return KNOWN_ENGAGEMENT_TERM_CORRECTIONS.reduce(
    (current, correction) => current.replace(correction.pattern, correction.replacement),
    text
  );
}

function buildCommentEntityGuard(source: EngagementContent): CommentEntityGuard {
  const inputText = source.input && !/^https?:\/\//i.test(source.input.trim()) ? source.input : "";
  const sourceText = normalizeKnownEngagementTerms([
    source.title,
    source.content,
    source.prompt || "",
    inputText
  ].join("\n"));
  const allowedModels = uniqueText(extractModelLikeTerms(sourceText));
  return {
    allowedModels,
    allowedModelKeys: new Set(allowedModels.map(toModelKey))
  };
}

function draftSupportsBilibili(draft: Draft) {
  if (draft.targetType !== "project") return draft.platform === "bilibili";
  return Boolean(draft.styleRef.sourceAccountIds?.some((id) => id.startsWith("bilibili:")));
}

function makeEngagementTitle(content: string, fallback: string) {
  const firstLine = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 32) : fallback;
}

async function buildAccountSourceContext(
  platform: Platform,
  accountId: string,
  accountName: string,
  sourceVideoIds: string[] = [],
  options: { includeDanmaku: boolean }
): Promise<SourceContext> {
  let danmaku: string[] = [];
  if (options.includeDanmaku && platform === "bilibili") {
    const account = await resolveAccount(platform, accountId);
    const summary = await getAccountSummary(account);
    const contextVideos = prioritizeVideos(summary.videos, sourceVideoIds).slice(0, 10);
    danmaku = await collectDanmakuSamples(accountId, contextVideos);
  }

  return {
    platform,
    accountId,
    accountName,
    danmaku
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

async function generateComments(
  source: EngagementContent,
  contexts: SourceContext[],
  count: number,
  platform: Platform | "unknown",
  signal?: AbortSignal
) {
  if (!ENABLE_MODEL_COMMENT_GENERATION) {
    throw new Error("当前未启用评论模型，已关闭本地兜底。请先配置对话模型后再生成评论。");
  }
  const parsed: string[] = [];
  const entityGuard = buildCommentEntityGuard(source);
  const sourceBriefResult = await buildCommentSourceBrief(source, platform, entityGuard, signal);
  const sourceBrief = sourceBriefResult.brief;
  const relatedResearchResult = normalizeCommentRelatedResearch(
    await buildRelatedCommentResearch(sourceBrief, platform, entityGuard, signal),
    entityGuard
  );
  const relatedResearch = relatedResearchResult.research;
  const batchResults: {
    index: number;
    requestedCount: number;
    parsedCount: number;
    model: string;
    fallback: boolean;
    fallbackReason?: string;
  }[] = [];
  let usedModel = "model";
  let nextBatchIndex = 0;
  let round = 0;
  let selected = selectCommentSamples(parsed, sourceBrief, entityGuard, count);
  const targetLongCommentCount = getTargetLongCommentCount(count);
  const targetIntentBuckets = buildTargetCommentIntentBuckets(count, relatedResearch);

  while (needsMoreCommentSamples(selected, count, targetLongCommentCount, targetIntentBuckets) && round < COMMENT_GENERATION_MAX_ROUNDS) {
    throwIfAborted(signal);
    const missingCount = Math.max(count - selected.items.length, 0);
    const outputPreview = pickCommentSamplesForOutput(selected.items, count, targetLongCommentCount, targetIntentBuckets);
    const missingLongCount = Math.max(targetLongCommentCount - countLongComments(outputPreview), 0);
    const previewIntentBuckets = summarizeCommentIntentBuckets(outputPreview);
    const forceLongComments = missingLongCount > 0 && (selected.items.length >= count || round >= 1);
    const forceIntent = !forceLongComments && selected.items.length >= count
      ? findMissingCommentIntent(previewIntentBuckets, targetIntentBuckets)
      : undefined;
    const requestCount = forceLongComments || forceIntent
      ? Math.min(COMMENT_GENERATION_BATCH_SIZE, Math.max(missingLongCount + 8, 12))
      : missingCount < COMMENT_GENERATION_BATCH_SIZE
      ? Math.min(COMMENT_GENERATION_BATCH_SIZE, Math.max(missingCount + 8, 12))
      : missingCount;
    const batches = buildCommentGenerationBatches(requestCount, nextBatchIndex);

    for (let start = 0; start < batches.length; start += COMMENT_MODEL_CONCURRENCY) {
      throwIfAborted(signal);
      const wave = batches.slice(start, start + COMMENT_MODEL_CONCURRENCY);
      const recentComments = selected.items.slice(-120);
      const waveResults = await Promise.all(
        wave.map(async (batch, waveIndex) => {
          throwIfAborted(signal);
          const result = await chatCompleteStrict(
            [
              {
                role: "system",
                content:
                  "你是中文短视频评论区里的随机路人，不是策划、评测师、客服或文案。评论要短中长混合、散、口语化；长一点的评论也要像路人把自己的顾虑、场景或圈内吹水顺手打出来，不像认真写作业。以给定素材和相关评论母题为边界，允许少量同品类/同圈层轻跑题，但不要编具体新闻、销量或真人经历，不要照抄真实评论，不要生成用户名，不要攻击、造谣、色情、歧视或引导刷量。只输出 JSON 数组，每项为字符串。"
              },
              {
                role: "user",
                content: buildCommentBatchPrompt({
                  source,
                  sourceBrief,
                  entityGuard,
                  relatedResearch,
                  batchIndex: batch.index,
                  batchOrder: start + waveIndex + 1,
                  totalBatches: batches.length,
                  batchCount: batch.count,
                  existingComments: recentComments,
                  forceLongComments,
                  forceIntent,
                  targetIntentBuckets
                })
              }
            ],
            "low",
            { signal }
          );
          throwIfAborted(signal);
          if (result.fallback || !result.text.trim()) {
            throw new Error(result.fallbackReason || "模型没有返回可用评论，请重试或更换模型。");
          }
          const batchParsed = parseStringArray(result.text);
          if (!batchParsed.length) {
            throw new Error("模型返回了内容，但没有解析到可用评论，请重试或更换模型。");
          }
          return { batch, batchParsed, result };
        })
      );

      waveResults
        .sort((left, right) => left.batch.index - right.batch.index)
        .forEach(({ batch, batchParsed, result }) => {
          parsed.push(...batchParsed);
          usedModel = result.model || usedModel;
          batchResults.push({
            index: batch.index,
            requestedCount: batch.count,
            parsedCount: batchParsed.length,
            model: result.model,
            fallback: false
          });
        });
    }

    nextBatchIndex += batches.length;
    round += 1;
    selected = selectCommentSamples(parsed, sourceBrief, entityGuard, count);
    if (!needsMoreCommentSamples(selected, count, targetLongCommentCount, targetIntentBuckets)) break;
  }

  const selection = selectCommentSamples(parsed, sourceBrief, entityGuard, count);
  const texts = pickCommentSamplesForOutput(selection.items, count, targetLongCommentCount, targetIntentBuckets);
  if (texts.length < count) {
    throw new Error(`模型只返回了 ${texts.length} 条可用评论，未达到 ${count} 条，请重试或更换模型。`);
  }
  const outputLengthBuckets = summarizeCommentLengthBuckets(texts.slice(0, count));
  const outputIntentBuckets = summarizeCommentIntentBuckets(texts.slice(0, count));
  const diagnostics = {
    sourceBrief: toCommentSourceBriefDiagnostics(sourceBrief),
    entityGuard: toCommentEntityGuardDiagnostics(entityGuard, [
      ...sourceBriefResult.entityCorrections,
      ...relatedResearchResult.entityCorrections,
      ...selection.entityCorrections
    ]),
    relatedResearch: toRelatedCommentResearchDiagnostics(relatedResearch),
    research: [toRelatedCommentResearchSummary(relatedResearch)],
    generation: {
      mode: "model_batch" as const,
      requestedCount: count,
      batchSize: COMMENT_GENERATION_BATCH_SIZE,
      batchCount: batchResults.length,
      parsedCount: texts.length,
      completedCount: texts.length,
      supplementedCount: 0,
      targetLongCommentCount,
      lengthBuckets: outputLengthBuckets,
      targetIntentBuckets,
      intentBuckets: outputIntentBuckets,
      lowSignalRejectedCount: selection.lowSignalRejectedCount,
      syntheticRejectedCount: selection.syntheticRejectedCount,
      nearDuplicateRejectedCount: selection.nearDuplicateRejectedCount,
      repeatedStyleRejectedCount: selection.repeatedStyleRejectedCount,
      entityCorrectedCount: selection.entityCorrectedCount,
      unsupportedEntityRejectedCount: selection.unsupportedEntityRejectedCount,
      batches: batchResults
    }
  };
  return {
    usedModel,
    fallback: false,
    fallbackReason: undefined,
    diagnostics,
    items: texts.slice(0, count).map((text, index) => makeCommentItem(text, contexts[index % Math.max(contexts.length, 1)]?.platform || platform, index))
  };
}

function buildCommentGenerationBatches(count: number, startIndex = 0) {
  const batches: { index: number; count: number }[] = [];
  let remaining = count;
  while (remaining > 0) {
    const nextCount = Math.min(COMMENT_GENERATION_BATCH_SIZE, remaining);
    batches.push({ index: startIndex + batches.length, count: nextCount });
    remaining -= nextCount;
  }
  return batches;
}

function buildCommentBatchPrompt(input: {
  source: EngagementContent;
  sourceBrief: CommentSourceBrief;
  entityGuard: CommentEntityGuard;
  relatedResearch: CommentRelatedResearch;
  batchIndex: number;
  batchOrder: number;
  totalBatches: number;
  batchCount: number;
  existingComments: string[];
  forceLongComments: boolean;
  forceIntent?: CommentIntent;
  targetIntentBuckets: CommentIntentBuckets;
}) {
  const variant = COMMENT_PROMPT_VARIANTS[input.batchIndex % COMMENT_PROMPT_VARIANTS.length];
  return `文案标题：${input.source.title}

评论锚点地图：
${formatCommentSourceBrief(input.sourceBrief)}

型号一致性约束：
${formatCommentEntityGuard(input.entityGuard)}

相关爆款评论母题（从同单品/同品类评论区提炼，只学关注点，严禁照抄）：
${formatRelatedCommentResearch(input.relatedResearch)}

原始文案节选（只用于核对，不要逐句复读）：
${clampText(input.source.content, 2200)}

请生成 ${input.batchCount} 条观众评论。这是当前一轮的第 ${input.batchOrder}/${input.totalBatches} 批，只输出本批 JSON 数组。

本批偏向：
${variant}

本批形态配比：
${buildCommentShapePlan(input.batchCount, { forceLongComments: input.forceLongComments })}

评论角色配比参考：
${formatCommentIntentBuckets(input.targetIntentBuckets)}
${input.forceIntent ? `\n本批重点补：${formatForcedCommentIntent(input.forceIntent)}` : ""}

要求：
1. 每条像真实网友在刷短视频时随手发的评论，不要每条都完整、工整、有结论。
2. 绝大多数评论至少贴住一个具体锚点：产品/人物/事件名、数字、配置、价格、画面、场景、槽点或疑问；少量吹水可以先聊同品类/同圈层最近在卷什么，但要能回到一个锚点、场景或疑问。
3. 短评要有半句、短问句、只接一个梗的碎片句；允许省主语、接上文、回复感和没头没尾的口水话。
4. 长评要像真实观众补充自己的场景、顾虑或取舍，不要像评测总结。
5. 不要把每条都写成“XX听着不错，但我这种人还要看YY”或“型号 + 有点/会不会/是不是”的工整句式。
6. 语气自然，口语化，别像总结、复盘、客服、营销，也别像商详页复读。
7. 不要全是夸，不要全都“种草/心动/真香”；可以有人担心缺点、质感、预算、适配场景。
8. 不要机械重复标题里的词，不要每条都以“这”开头。
9. 避免“这条”“这次信息量”“画面感”“莫名合理”“热梗现场”“产品力”“需求场景”“适合人群”这类明显模板味表达。
10. 少用“确实、感觉、适合、路线、定位、配置、普通人、对我来说、我这种”这些词；要用也别连着用。
11. 可以模拟目标观众的即时反应、犹豫、追问和轻吐槽；不要写“已下单/用了很久/回购”这类需要真实经历背书的话。
12. 和其他批次拉开一点表达角度，不要像同一个人连续刷屏。
13. 允许少量轻跑题吹水，比如键盘圈/外设圈/数码圈最近都在卷磁轴、铝坨坨、618 价格；不要写具体未证实新闻，不要把吹水写成科普段子。
14. 英文数字型号只能使用“型号一致性约束”里的写法；不要凭感觉加 L、Pro、V2、Max 等源内没有的后缀。

已生成评论，后续不要重复：
${input.existingComments.join("\n") || "暂无"}`;
}

async function generateDanmaku(source: EngagementContent, contexts: SourceContext[], count: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  const samples = contexts
    .map((context) => `账号：${context.accountName}\n弹幕样本：\n${context.danmaku.slice(0, 70).join("\n") || "暂无弹幕样本"}`)
    .join("\n\n---\n\n") || "暂无弹幕样本，请按正文节奏生成自然短弹幕。";
  const result = await chatCompleteStrict(
    [
      {
        role: "system",
        content:
          "你是 B站弹幕策划助手。请基于文案生成可用于剪辑参考的弹幕时间表。只输出 JSON 数组，每项为 {\"timeSec\":数字,\"text\":\"弹幕\"}。弹幕要短、像真实观众，避免低俗攻击和重复刷屏。"
      },
      {
        role: "user",
        content: `文案：\n${clampText(source.content, 3000)}\n\n参考弹幕：\n${samples}\n\n请生成 ${count} 条弹幕，按正文节奏自然分布。`
      }
    ],
    "low",
    { signal }
  );
  throwIfAborted(signal);
  const parsed = parseDanmakuArray(result.text);
  if (!parsed.length) {
    throw new Error(result.fallbackReason || "模型返回了内容，但没有解析到可用弹幕，请重试或更换模型。");
  }
  if (parsed.length < count) {
    throw new Error(`模型只返回了 ${parsed.length} 条可用弹幕，未达到 ${count} 条，请重试或更换模型。`);
  }
  return {
    usedModel: result.model,
    fallback: false,
    fallbackReason: undefined,
    items: parsed.slice(0, count).map((item, index) => ({
      id: `danmaku-${index + 1}-${shortHash(`${item.timeSec}-${item.text}`)}`,
      timeSec: Math.max(0, Math.round(item.timeSec)),
      text: item.text.trim()
    }))
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("任务已停止");
  }
}

async function buildCommentSourceBrief(
  source: EngagementContent,
  platform: Platform | "unknown",
  entityGuard: CommentEntityGuard,
  signal?: AbortSignal
): Promise<{ brief: CommentSourceBrief; entityCorrections: CommentEntityCorrection[] }> {
  throwIfAborted(signal);
  const result = await chatCompleteStrict(
    [
      {
        role: "system",
        content:
          "你是中文短视频评论生成前的素材分析员。只提取素材里明确出现的信息，帮助后续评论贴住视频细节。不要写评论，不要编造素材外事实。只输出 JSON 对象。"
      },
      {
        role: "user",
        content: `平台：${platform}
标题：${source.title}

素材：
${clampText(buildCommentBriefSourceText(source), 9000)}

请输出 JSON 对象，字段必须完整：
{
  "summary": "一句话概括视频真正讲什么",
  "topic": "评论区会围绕什么话题聊",
  "subjects": ["具体产品/人物/游戏/事件名，最多 8 个"],
  "keyFacts": ["素材里明说的具体事实、卖点、数字、价格、配置、缺点或结论，8-14 条"],
  "audiencePersonas": ["最可能被这条视频吸引、愿意在冷启动评论区接话的观众类型，6-10 个"],
  "viewerScenes": ["观众会代入的真实场景，4-8 条"],
  "discussionAngles": ["适合评论区接话的角度，8-12 条"],
  "skepticalAngles": ["自然的疑问、保留意见或可能的反向观点，4-8 条"],
  "mustAvoid": ["没有材料不要写或容易写假的内容，4-8 条"],
  "anchorTerms": ["评论里可以自然出现的源内关键词、型号、参数、价格、场景词，15-30 个"]
}

额外要求：
- 产品推荐/测评素材优先提炼型号、价格/优惠、核心配置、使用场景、明确短板。
- 涉及英文数字型号时，只按素材明文写法提取，不要自行补 L、Pro、Max、V2 等后缀。
- 游戏/热点素材优先提炼人物、活动、福利、时间、争议点、玩家代入场景。
- audiencePersonas 要从视频内容推导目标观众，比如预算党、宿舍党、FPS玩家、观望党、老玩家、吐槽党，不要依赖已有评论。
- anchorTerms 要短，保留原文说法，不要塞完整句子。
- 如果素材信息很少，就如实输出少量锚点，不要补常识。`
      }
    ],
    "medium",
    { signal }
  );
  throwIfAborted(signal);
  if (result.fallback || !result.text.trim()) {
    throw new Error(result.fallbackReason || "模型没有返回可用的评论锚点，请重试或更换模型。");
  }
  return normalizeCommentSourceBrief(parseJsonFromText(result.text), source, entityGuard);
}

function buildCommentBriefSourceText(source: EngagementContent) {
  return [
    source.prompt ? `生成提示：\n${source.prompt}` : "",
    source.input && source.input !== source.content ? `原始输入：\n${source.input}` : "",
    `正文：\n${source.content}`
  ].filter(Boolean).join("\n\n---\n\n");
}

function normalizeCommentSourceBrief(
  parsed: unknown,
  source: EngagementContent,
  entityGuard: CommentEntityGuard
): { brief: CommentSourceBrief; entityCorrections: CommentEntityCorrection[] } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模型返回了内容，但没有解析到评论锚点 JSON，请重试或更换模型。");
  }
  const object = parsed as Record<string, unknown>;
  const brief = {
    summary: normalizeBriefString(object.summary) || makeEngagementTitle(source.content, source.title),
    topic: normalizeBriefString(object.topic) || source.title,
    subjects: normalizeBriefList(object.subjects, 8),
    keyFacts: normalizeBriefList(object.keyFacts, 14),
    audiencePersonas: normalizeBriefList(object.audiencePersonas, 10),
    viewerScenes: normalizeBriefList(object.viewerScenes, 8),
    discussionAngles: normalizeBriefList(object.discussionAngles, 12),
    skepticalAngles: normalizeBriefList(object.skepticalAngles, 8),
    mustAvoid: normalizeBriefList(object.mustAvoid, 8),
    anchorTerms: normalizeBriefList(object.anchorTerms, 30)
  };
  const guardedBrief = normalizeCommentSourceBriefEntities({
    ...brief,
    anchorTerms: uniqueText([
      ...brief.anchorTerms,
      ...brief.subjects,
      ...extractSourceAnchorTerms(`${source.title}\n${source.content}`)
    ]).slice(0, 40)
  }, entityGuard);
  if (!guardedBrief.brief.keyFacts.length && !guardedBrief.brief.discussionAngles.length && !guardedBrief.brief.anchorTerms.length) {
    throw new Error("评论锚点为空，无法生成贴合素材的评论。请补充更完整的文案或链接。");
  }
  return guardedBrief;
}

function normalizeCommentSourceBriefEntities(brief: CommentSourceBrief, entityGuard: CommentEntityGuard) {
  const corrections: CommentEntityCorrection[] = [];
  const normalizeText = (value: string) => {
    const result = normalizeTextWithEntityGuard(value, entityGuard, "brief");
    corrections.push(...result.corrections);
    return result.text;
  };
  const normalizeList = (values: string[]) => uniqueText(values.map(normalizeText).filter(Boolean));
  return {
    brief: {
      summary: normalizeText(brief.summary),
      topic: normalizeText(brief.topic),
      subjects: normalizeList(brief.subjects),
      keyFacts: normalizeList(brief.keyFacts),
      audiencePersonas: normalizeList(brief.audiencePersonas),
      viewerScenes: normalizeList(brief.viewerScenes),
      discussionAngles: normalizeList(brief.discussionAngles),
      skepticalAngles: normalizeList(brief.skepticalAngles),
      mustAvoid: normalizeList(brief.mustAvoid),
      anchorTerms: normalizeList(brief.anchorTerms).slice(0, 40)
    },
    entityCorrections: uniqueEntityCorrections(corrections)
  };
}

function normalizeCommentRelatedResearch(research: CommentRelatedResearch, entityGuard: CommentEntityGuard) {
  const corrections: CommentEntityCorrection[] = [];
  const normalizeText = (value: string) => {
    const result = normalizeTextWithEntityGuard(value, entityGuard, "relatedResearch");
    corrections.push(...result.corrections);
    return result.text;
  };
  const normalizeList = (values: string[]) => uniqueText(values.map(normalizeText).filter(Boolean));
  return {
    research: {
      ...research,
      themes: normalizeList(research.themes),
      phrases: normalizeList(research.phrases),
      questions: normalizeList(research.questions),
      objections: normalizeList(research.objections),
      longCommentPatterns: normalizeList(research.longCommentPatterns),
      chatterAngles: normalizeList(research.chatterAngles)
    },
    entityCorrections: uniqueEntityCorrections(corrections)
  };
}

function normalizeTextWithEntityGuard(
  value: string,
  entityGuard: CommentEntityGuard,
  stage: CommentEntityCorrection["stage"]
) {
  let text = normalizeKnownEngagementTerms(value);
  const corrections: CommentEntityCorrection[] = [];
  for (const term of extractModelLikeTerms(text)) {
    const correction = findModelEntityCorrection(term, entityGuard);
    if (!correction) continue;
    const nextText = replaceModelTerm(text, term, correction);
    if (nextText === text) continue;
    text = nextText;
    corrections.push({ from: term, to: correction, stage });
  }
  return { text, corrections: uniqueEntityCorrections(corrections) };
}

function findUnsupportedModelTerms(value: string, entityGuard: CommentEntityGuard) {
  return uniqueText(
    extractModelLikeTerms(value).filter((term) => {
      const key = toModelKey(term);
      return !entityGuard.allowedModelKeys.has(key) && !findModelEntityCorrection(term, entityGuard) && isSuspiciousModelVariant(key, entityGuard);
    })
  );
}

function findModelEntityCorrection(term: string, entityGuard: CommentEntityGuard) {
  const key = toModelKey(term);
  if (!key || entityGuard.allowedModelKeys.has(key)) return "";
  return entityGuard.allowedModels
    .slice()
    .sort((left, right) => toModelKey(right).length - toModelKey(left).length)
    .find((allowed) => {
      const allowedKey = toModelKey(allowed);
      const extra = key.startsWith(allowedKey) ? key.slice(allowedKey.length) : "";
      return allowedKey.length >= 4 && /^[A-Z]{1,2}$/.test(extra);
    }) || "";
}

function isSuspiciousModelVariant(key: string, entityGuard: CommentEntityGuard) {
  if (key.length < 4) return false;
  return entityGuard.allowedModels.some((allowed) => {
    const allowedKey = toModelKey(allowed);
    if (allowedKey.length < 4) return false;
    if (key.startsWith(allowedKey) || allowedKey.startsWith(key)) return true;
    return levenshteinDistance(key, allowedKey) <= 2 && sharesModelDigit(key, allowedKey);
  });
}

function sharesModelDigit(left: string, right: string) {
  const leftDigits = new Set(left.match(/\d/g) || []);
  return (right.match(/\d/g) || []).some((digit) => leftDigits.has(digit));
}

function replaceModelTerm(text: string, from: string, to: string) {
  const pattern = new RegExp(`\\b${escapeRegExp(from).replace(/\\s+/g, "\\s*")}\\b`, "gi");
  return text.replace(pattern, to);
}

function extractModelLikeTerms(text: string) {
  const terms = text.match(/\b[A-Za-z][A-Za-z0-9.+-]*(?:\s+[A-Za-z0-9.+-]+){0,2}\b/g) || [];
  return uniqueText(
    terms
      .flatMap((term) => [term, ...term.split(/\s+/)])
      .map((term) => term.replace(/\s+/g, " ").trim())
      .filter(isModelLikeTerm)
  );
}

function isModelLikeTerm(term: string) {
  const key = toModelKey(term);
  if (isBlockedModelKey(key)) return false;
  if (!/[A-Z]/.test(key) || !/\d/.test(key)) return false;
  if (key.length < 3 || key.length > 24) return false;
  return !/^\d+(?:MS|HZ|KHZ|MAH|MM|KG|G|K)$/.test(key);
}

function isBlockedModelKey(key: string) {
  return /^BV[A-Z0-9]{8,}$/i.test(key) ||
    /^AV\d{6,}$/i.test(key) ||
    /^B23[A-Z0-9]+$/i.test(key) ||
    /^TAPE\d+$/i.test(key) ||
    /^(?:HTTP|HTTPS|WWW|APP|FPS|CS|CS2)$/.test(key);
}

function toModelKey(term: string) {
  return term.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function uniqueEntityCorrections(corrections: CommentEntityCorrection[]) {
  const seen = new Set<string>();
  return corrections.filter((correction) => {
    if (!correction.from || !correction.to || correction.from === correction.to) return false;
    const key = `${correction.stage}\n${correction.from}\n${correction.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toCommentEntityGuardDiagnostics(entityGuard: CommentEntityGuard, corrections: CommentEntityCorrection[]) {
  return {
    allowedModels: entityGuard.allowedModels,
    correctedTerms: uniqueEntityCorrections(corrections).slice(0, 40)
  };
}

function formatCommentEntityGuard(entityGuard: CommentEntityGuard) {
  if (!entityGuard.allowedModels.length) {
    return "未识别到需要硬校验的英文数字型号；仍然不要自行编造型号、版本号或后缀。";
  }
  return [
    `可写型号：${entityGuard.allowedModels.join("、")}`,
    "如果要写英文数字型号，只能从上面选；不要把相近型号、搜索结果里的其他型号或自己猜的后缀写进评论。"
  ].join("\n");
}

function levenshteinDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    let previous = rows[0];
    rows[0] = rightIndex;
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = rows[leftIndex];
      rows[leftIndex] = Math.min(
        rows[leftIndex] + 1,
        rows[leftIndex - 1] + 1,
        previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return rows[left.length];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBriefString(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 180) : "";
}

function normalizeBriefList(value: unknown, limit: number) {
  const list = Array.isArray(value) ? value : [];
  return uniqueText(
    list
      .map((item) => normalizeBriefString(item))
      .filter((item) => item.length >= 2 && item.length <= 160)
  ).slice(0, limit);
}

function toCommentSourceBriefDiagnostics(brief: CommentSourceBrief) {
  return {
    summary: brief.summary,
    topic: brief.topic,
    subjects: brief.subjects,
    keyFacts: brief.keyFacts,
    audiencePersonas: brief.audiencePersonas,
    viewerScenes: brief.viewerScenes,
    discussionAngles: brief.discussionAngles,
    skepticalAngles: brief.skepticalAngles,
    anchorTerms: brief.anchorTerms
  };
}

function formatCommentSourceBrief(brief: CommentSourceBrief) {
  return [
    `一句话：${brief.summary}`,
    `话题：${brief.topic}`,
    formatBriefLines("主体/对象", brief.subjects),
    formatBriefLines("源内事实/卖点/槽点", brief.keyFacts),
    formatBriefLines("目标观众角色", brief.audiencePersonas),
    formatBriefLines("观众代入场景", brief.viewerScenes),
    formatBriefLines("可接话角度", brief.discussionAngles),
    formatBriefLines("可观望/追问角度", brief.skepticalAngles),
    formatBriefLines("评论锚点词", brief.anchorTerms),
    formatBriefLines("不要写", brief.mustAvoid)
  ].filter(Boolean).join("\n");
}

function formatBriefLines(label: string, values: string[]) {
  return values.length ? `${label}：\n${values.map((value) => `- ${value}`).join("\n")}` : "";
}

async function buildRelatedCommentResearch(
  brief: CommentSourceBrief,
  platform: Platform | "unknown",
  entityGuard: CommentEntityGuard,
  signal?: AbortSignal
): Promise<CommentRelatedResearch> {
  const queries = buildRelatedCommentQueries(brief, entityGuard);
  const empty = makeEmptyRelatedResearch(queries);
  if (!queries.length) return empty;

  const comments: string[] = [];
  let relatedVideoCount = 0;
  const failedQueries: string[] = [];

  for (const query of queries) {
    throwIfAborted(signal);
    try {
      const result = platform === "douyin"
        ? await getDouyinRelatedTopicComments(query, { videoLimit: 2, commentLimit: 15 })
        : await getBilibiliRelatedTopicComments(query, { videoLimit: 2, commentLimit: 15 });
      relatedVideoCount += result.videos.length;
      comments.push(...result.comments);
    } catch {
      failedQueries.push(query);
    }
  }

  const samples = uniqueText(comments).slice(0, 120);
  const lengthStats = summarizeCommentLengthBuckets(samples);
  const intentStats = summarizeCommentIntentBuckets(samples);
  if (!samples.length) {
    return {
      ...empty,
      failedQueries,
      relatedVideoCount,
      summaryError: failedQueries.length ? "相关评论抓取失败或无可用评论。" : "相关评论为空。"
    };
  }

  try {
    const summarized = await summarizeRelatedCommentSamples(brief, queries, samples, signal);
    return {
      ...summarized,
      usedQueries: queries,
      failedQueries,
      relatedVideoCount,
      relatedCommentCount: samples.length,
      longCommentCount: lengthStats.long,
      lengthBuckets: lengthStats,
      intentBuckets: intentStats
    };
  } catch (error) {
    return {
      ...empty,
      failedQueries,
      relatedVideoCount,
      relatedCommentCount: samples.length,
      longCommentCount: lengthStats.long,
      lengthBuckets: lengthStats,
      intentBuckets: intentStats,
      summaryError: error instanceof Error ? error.message : "相关评论母题提炼失败。"
    };
  }
}

function makeEmptyRelatedResearch(queries: string[]): CommentRelatedResearch {
  return {
    usedQueries: queries,
    failedQueries: [],
    relatedVideoCount: 0,
    relatedCommentCount: 0,
    longCommentCount: 0,
    lengthBuckets: {
      short: 0,
      medium: 0,
      long: 0
    },
    intentBuckets: makeEmptyCommentIntentBuckets(),
    themes: [],
    phrases: [],
    questions: [],
    objections: [],
    longCommentPatterns: [],
    chatterAngles: []
  };
}

function buildRelatedCommentQueries(brief: CommentSourceBrief, entityGuard: CommentEntityGuard) {
  const candidates = buildRelatedCommentSearchTerms(brief, entityGuard);
  const queries: string[] = [];

  for (const term of candidates) {
    if (queries.length >= 6) break;
    if (/[A-Za-z0-9]/.test(term)) {
      queries.push(`${term} 评测`);
      if (/G87/i.test(term)) queries.push(`${term} 版本`);
      if (/Rainy|锐七五/i.test(term)) queries.push(`${term} 麻将音`);
      if (/RS6|ATK/i.test(term)) queries.push(`${term} 磁轴`);
      continue;
    }
    queries.push(`${term} 评测`);
  }

  return uniqueText(queries).slice(0, 6);
}

function buildRelatedCommentSearchTerms(brief: CommentSourceBrief, entityGuard: CommentEntityGuard) {
  const subjectTerms = brief.subjects
    .map(cleanSearchQueryTerm)
    .filter(isUsefulRelatedSearchTerm);
  const anchorTerms = brief.anchorTerms
    .map(cleanSearchQueryTerm)
    .filter((term) => isUsefulRelatedSearchTerm(term) && isCompactSearchAnchor(term));
  const modelTerms = getSearchableModelTerms(entityGuard)
    .filter((term) => ![...subjectTerms, ...anchorTerms].some((existing) => includesModelKey(existing, term)));
  return removeCoveredSearchTerms(uniqueText([...subjectTerms, ...anchorTerms, ...modelTerms])).slice(0, 8);
}

function removeCoveredSearchTerms(terms: string[]) {
  return terms.filter((term, index) => {
    if (!isModelLikeTerm(term)) return true;
    return !terms.some((other, otherIndex) => {
      if (otherIndex >= index || !searchTermsShareModel(other, term)) return false;
      if (hasSearchFiller(term)) return true;
      if (isBrandedModelSearchTerm(other) && !isBrandedModelSearchTerm(term)) return true;
      return other.length <= term.length && includesModelKey(term, other);
    });
  });
}

function getSearchableModelTerms(entityGuard: CommentEntityGuard) {
  return entityGuard.allowedModels
    .filter((term) => {
      const key = toModelKey(term);
      return !entityGuard.allowedModels.some((other) => {
        const otherKey = toModelKey(other);
        return otherKey.length > key.length && otherKey.endsWith(key);
      });
    })
    .sort((left, right) => toModelKey(right).length - toModelKey(left).length);
}

function cleanSearchQueryTerm(value: string) {
  return value
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9.+%-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function isUsefulRelatedSearchTerm(term: string) {
  const key = toModelKey(term);
  if (term.length < 2 || isBlockedModelKey(key)) return false;
  if (/^(?:FPS|CS|CS2|APP|京东618|618|高考季|学生党|打工仔)$/i.test(term)) return false;
  if (hasSearchFiller(term)) return false;
  if (/(?:接口|Type-C|gasket|垫片|结构|主灯效|侧边灯效|灯效|毫安|小时|蓝牙|有线|热插拔|RGB|旋钮|彩屏|连接|2\.?4G)/i.test(term)) return false;
  if (/京东|618|优惠|直降|五折|凑单|满减/.test(term) && !/[A-Za-z0-9]/.test(term)) return false;
  if (/[A-Za-z]/.test(term)) {
    return isModelLikeTerm(term) || /[\u4e00-\u9fa5]{2,}.*[A-Za-z0-9]|[A-Za-z0-9].*[\u4e00-\u9fa5]{2,}/.test(term);
  }
  if (/\d/.test(term)) return false;
  return /轴|键盘|鼠标|耳机|电脑|手机|跑步机/.test(term) && !/^(?:游戏|桌面|办公室|宿舍|价格|版本)$/.test(term);
}

function isCompactSearchAnchor(term: string) {
  return term.length <= 18 && !/(这个|那种|听着|看着|是不是|怎么样|有没有|真|挺|很|太)$/.test(term);
}

function includesModelKey(value: string, model: string) {
  const valueKey = toModelKey(value);
  const modelKey = toModelKey(model);
  return modelKey.length >= 3 && valueKey.includes(modelKey);
}

function searchTermsShareModel(left: string, right: string) {
  const leftModels = extractModelLikeTerms(left).map(toModelKey);
  const rightModels = extractModelLikeTerms(right).map(toModelKey);
  return leftModels.some((leftModel) => rightModels.some((rightModel) => leftModel.includes(rightModel) || rightModel.includes(leftModel)));
}

function isBrandedModelSearchTerm(term: string) {
  return isModelLikeTerm(term) && /[\u4e00-\u9fa5]{2,}.*[A-Za-z0-9]|[A-Za-z0-9].*[\u4e00-\u9fa5]{2,}/.test(term);
}

function hasSearchFiller(term: string) {
  return /(这个|那个|入手|时候|听着|看着|链路|烟测|测试|生成|评论|怎么|如何|是不是|怎么样|有没有|真|挺|很|太)/.test(term);
}

function summarizeCommentLengthBuckets(samples: string[]) {
  return samples.reduce(
    (buckets, sample) => {
      const length = Array.from(sample).length;
      if (length >= 36) buckets.long += 1;
      else if (length >= 13) buckets.medium += 1;
      else buckets.short += 1;
      return buckets;
    },
    { short: 0, medium: 0, long: 0 }
  );
}

function makeEmptyCommentIntentBuckets(): CommentIntentBuckets {
  return {
    reaction: 0,
    question: 0,
    price: 0,
    comparison: 0,
    skeptical: 0,
    experience: 0,
    follow: 0,
    chatter: 0
  };
}

function summarizeCommentIntentBuckets(samples: string[]): CommentIntentBuckets {
  return samples.reduce((buckets, sample) => {
    buckets[classifyCommentIntent(sample)] += 1;
    return buckets;
  }, makeEmptyCommentIntentBuckets());
}

function classifyCommentIntent(value: string): CommentIntent {
  const text = value.trim();
  if (/^(?:cy|蹲|插眼|同问|码住|先收藏)/i.test(text) || /求链接|求个链接|有人买过吗|蹲反馈|蹲一个/.test(text)) return "follow";
  if (/^(?:cy|蹲|插眼|同问|求链接|求个链接|蹲反馈|蹲一个|码住|先收藏|有人买过吗)[。！!？?~～]*$/i.test(text)) return "follow";
  if (hasCommentChatterCue(text)) return "chatter";
  if (/对比|相比|比起来|和.+比|vs|VS|还是|哪个|哪把|怎么选|选.+还是/.test(text)) return "comparison";
  if (/价|到手|券|618|京东|便宜|贵|预算|五折|凑单|满减|优惠|直降|降价|蹲价|多钱|多少钱/.test(text)) return "price";
  if (/怕|担心|翻车|不稳|鸡肋|套路|观望|等等|别|尴尬|累不累|吵不吵|靠谱吗|稳不稳|会不会/.test(text)) return "skeptical";
  if (/[?？]|吗|么|有没有|咋|怎么|多少|哪/.test(text)) return "question";
  if (/我|宿舍|办公室|桌面|打游戏|码字|学生|高考|舍友|用过|买过|现在用|平时|日常/.test(text)) return "experience";
  return "reaction";
}

function hasCommentChatterCue(text: string) {
  return /键盘圈|外设圈|数码圈|客制化圈|圈里|圈内|吹水|热榜|热点|风向|卷成|卷到|都在卷|卷麻|铝坨坨|价格战/.test(text)
    || /(最近|这两年|今年|现在).{0,18}(键盘|外设|数码|磁轴|轴体|铝坨坨|客制化|量产).{0,18}(卷|火|热|多|价格|低价|离谱)/.test(text)
    || /(键盘|外设|数码|磁轴|轴体|铝坨坨|客制化|量产).{0,18}(最近|这两年|今年|现在).{0,18}(卷|火|热|多|价格|低价|离谱)/.test(text);
}

function buildTargetCommentIntentBuckets(count: number, relatedResearch: CommentRelatedResearch): CommentIntentBuckets {
  const hasRelatedSamples = relatedResearch.relatedCommentCount > 0;
  const base = hasRelatedSamples ? relatedResearch.intentBuckets : {
    reaction: 30,
    question: 18,
    price: 13,
    comparison: 8,
    skeptical: 12,
    experience: 12,
    follow: 3,
    chatter: 4
  };
  const total = Object.values(base).reduce((sum, value) => sum + value, 0) || 1;
  const targets = makeEmptyCommentIntentBuckets();
  for (const key of Object.keys(targets) as CommentIntent[]) {
    targets[key] = Math.round((base[key] / total) * count);
  }
  if (!hasRelatedSamples) {
    targets.question = Math.max(targets.question, Math.round(count * 0.12));
    targets.price = Math.max(targets.price, Math.round(count * 0.08));
    targets.skeptical = Math.max(targets.skeptical, Math.round(count * 0.08));
    targets.experience = Math.max(targets.experience, Math.round(count * 0.08));
    targets.follow = Math.max(targets.follow, Math.max(1, Math.round(count * 0.03)));
    targets.chatter = Math.max(targets.chatter, count >= 20 ? 1 : 0);
  } else {
    targets.question = base.question ? Math.max(targets.question, Math.round(count * 0.06)) : 0;
    targets.price = base.price ? Math.max(targets.price, Math.round(count * 0.04)) : 0;
    targets.skeptical = base.skeptical ? Math.max(targets.skeptical, Math.round(count * 0.04)) : 0;
    targets.experience = base.experience ? Math.max(targets.experience, Math.round(count * 0.04)) : 0;
    targets.follow = base.follow ? Math.max(targets.follow, Math.max(1, Math.round(count * 0.02))) : 0;
    targets.chatter = base.chatter ? Math.max(targets.chatter, Math.round(count * 0.02)) : 0;
  }
  balanceCommentIntentTargets(targets, count);
  return targets;
}

function balanceCommentIntentTargets(targets: CommentIntentBuckets, count: number) {
  const order: CommentIntent[] = ["reaction", "question", "price", "skeptical", "experience", "comparison", "follow", "chatter"];
  let total = order.reduce((sum, key) => sum + targets[key], 0);
  while (total > count) {
    const key = order.find((intent) => targets[intent] > 1);
    if (!key) break;
    targets[key] -= 1;
    total -= 1;
  }
  while (total < count) {
    targets.reaction += 1;
    total += 1;
  }
}

function formatCommentIntentBuckets(buckets: CommentIntentBuckets) {
  return [
    `普通反应 ${buckets.reaction}`,
    `追问 ${buckets.question}`,
    `价格党 ${buckets.price}`,
    `对比党 ${buckets.comparison}`,
    `观望质疑 ${buckets.skeptical}`,
    `场景经验 ${buckets.experience}`,
    `插眼同问 ${buckets.follow}`,
    `圈内吹水 ${buckets.chatter}`
  ].join(" / ");
}

function findMissingCommentIntent(current: CommentIntentBuckets, target: CommentIntentBuckets): CommentIntent | undefined {
  const priority: CommentIntent[] = ["follow", "question", "experience", "skeptical", "comparison", "price", "chatter"];
  return priority.find((intent) => current[intent] < getCommentIntentSoftMinimum(intent, target[intent]));
}

function getCommentIntentSoftMinimum(intent: CommentIntent, targetCount: number) {
  if (targetCount <= 0) return 0;
  if (intent === "follow" || intent === "comparison" || intent === "chatter") {
    return targetCount >= 2 ? 1 : 0;
  }
  return Math.max(1, Math.floor(targetCount * 0.5));
}

function formatForcedCommentIntent(intent: CommentIntent) {
  const descriptions: Record<CommentIntent, string> = {
    reaction: "普通反应，像第一眼看到后的短句，不要太完整。",
    question: "追问型评论，多问实际体验、版本、适配、缺点，不要自己回答。",
    price: "价格党评论，围绕到手价、券、618、值不值、买贵没买贵。",
    comparison: "对比党评论，拿同价位、旧键盘、其他型号或使用场景做取舍。",
    skeptical: "观望质疑评论，担心翻车、声音、延迟、续航、做工、售后或广告味。",
    experience: "场景经验评论，带宿舍、办公室、桌面、打游戏、码字、预算这些个人处境。",
    follow: "插眼同问评论，比如蹲反馈、同问、有人买过吗、求实际到手价，允许低信息但要像真人。",
    chatter: "圈内吹水/轻跑题评论，可以顺嘴聊同品类、键盘圈、外设圈、数码圈最近都在卷什么，但要回到本视频锚点或观众疑问，不要编具体新闻。"
  };
  return descriptions[intent];
}

async function summarizeRelatedCommentSamples(
  brief: CommentSourceBrief,
  queries: string[],
  samples: string[],
  signal?: AbortSignal
): Promise<Pick<CommentRelatedResearch, "themes" | "phrases" | "questions" | "objections" | "longCommentPatterns" | "chatterAngles">> {
  throwIfAborted(signal);
  const result = await chatCompleteStrict(
    [
      {
        role: "system",
        content:
          "你是评论区研究员。你只能从相关评论样本中提炼关注点、疑问、吐槽和口头表达，不要生成新评论，不要照抄原评论。只输出 JSON 对象。"
      },
      {
        role: "user",
        content: `原视频主题：${brief.summary}
原视频对象：${brief.subjects.join("、") || "未知"}
搜索词：
${queries.map((query) => `- ${query}`).join("\n")}

相关评论样本：
${samples.slice(0, 80).map((comment) => `- ${comment}`).join("\n")}

请输出 JSON 对象：
{
  "themes": ["评论区真实集中讨论的母题，8-12 条"],
  "phrases": ["可借鉴的短口语词/圈内词，不要整句，10-20 个"],
  "questions": ["适合冷启动评论里自然追问的问题，6-10 条"],
  "objections": ["自然的观望/质疑/担心点，6-10 条"],
  "longCommentPatterns": ["36字以上长评论常见结构，比如先说场景再问缺点/先报预算再比较/先吐槽再补充，6-10 条"],
  "chatterAngles": ["评论区里轻跑题/圈内吹水的角度，比如最近都在卷什么、同品类热点、数码圈闲聊，4-8 条；不要编具体新闻"]
}`
      }
    ],
    "low",
    { signal }
  );
  throwIfAborted(signal);
  if (result.fallback || !result.text.trim()) {
    throw new Error(result.fallbackReason || "相关评论母题提炼失败。");
  }
  const parsed = parseJsonFromText(result.text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("相关评论母题没有解析到 JSON。");
  }
  const object = parsed as Record<string, unknown>;
  return {
    themes: normalizeBriefList(object.themes, 12),
    phrases: normalizeBriefList(object.phrases, 20),
    questions: normalizeBriefList(object.questions, 10),
    objections: normalizeBriefList(object.objections, 10),
    longCommentPatterns: normalizeBriefList(object.longCommentPatterns, 10),
    chatterAngles: normalizeBriefList(object.chatterAngles, 8)
  };
}

function toRelatedCommentResearchDiagnostics(research: CommentRelatedResearch) {
  return {
    usedQueries: research.usedQueries,
    failedQueries: research.failedQueries,
    relatedVideoCount: research.relatedVideoCount,
    relatedCommentCount: research.relatedCommentCount,
    longCommentCount: research.longCommentCount,
    lengthBuckets: research.lengthBuckets,
    intentBuckets: research.intentBuckets,
    themes: research.themes,
    phrases: research.phrases,
    questions: research.questions,
    objections: research.objections,
    longCommentPatterns: research.longCommentPatterns,
    chatterAngles: research.chatterAngles,
    summaryError: research.summaryError
  };
}

function toRelatedCommentResearchSummary(research: CommentRelatedResearch) {
  return {
    originalCommentCount: 0,
    originalCommentUsed: 0,
    relatedCommentCount: research.relatedCommentCount,
    relatedCommentUsed: research.relatedCommentCount,
    relatedVideoCount: research.relatedVideoCount,
    relatedLongCommentCount: research.longCommentCount,
    relatedIntentBuckets: research.intentBuckets,
    usedQueries: research.usedQueries,
    failedQueries: research.failedQueries,
    skippedRelatedSearch: false
  };
}

function formatRelatedCommentResearch(research: CommentRelatedResearch) {
  if (!research.relatedCommentCount) {
    return research.summaryError || "暂无相关评论研究，按原文锚点和目标观众生成。";
  }
  return [
    formatBriefLines("搜索词", research.usedQueries),
    formatBriefLines("母题", research.themes),
    formatBriefLines("短口语词", research.phrases),
    formatBriefLines("自然追问", research.questions),
    formatBriefLines("观望/质疑点", research.objections),
    formatBriefLines("长评结构", research.longCommentPatterns),
    formatBriefLines("圈内吹水", research.chatterAngles),
    `长度分布：短 ${research.lengthBuckets.short} / 中 ${research.lengthBuckets.medium} / 长 ${research.lengthBuckets.long}`,
    `角色分布：${formatCommentIntentBuckets(research.intentBuckets)}`
  ].filter(Boolean).join("\n");
}

function buildCommentShapePlan(count: number, options: { forceLongComments?: boolean } = {}) {
  if (options.forceLongComments) {
    const longCount = clampCount(Math.round(count * 0.72), 6, count, count);
    return [
      `- 这批是在补长评论，至少 ${longCount} 条 36-90 字。`,
      "- 长评论必须像真实观众留言：先说自己的场景/预算/顾虑，或先顺嘴聊一句圈内最近在卷什么，再接一个具体锚点或问题。",
      "- 允许一条里有两个逗号或一个反问，但不要分点、不要总结、不要像客服答疑。",
      "- 其余可以是短句，用来打散节奏。"
    ].join("\n");
  }
  const shortCount = clampCount(Math.round(count * 0.28), 3, 8, 4);
  const questionCount = clampCount(Math.round(count * 0.22), 2, 7, 4);
  const fragmentCount = clampCount(Math.round(count * 0.2), 2, 6, 4);
  const skepticalCount = clampCount(Math.round(count * 0.16), 2, 5, 3);
  const mediumCount = clampCount(Math.round(count * 0.28), 3, 8, 4);
  const longCount = clampCount(Math.round(count * 0.2), 2, 7, 4);
  return [
    `- 至少 ${shortCount} 条 4-12 字短评，比如只接一个点、一个问号、一个吐槽。`,
    `- 至少 ${mediumCount} 条 13-26 字中短句，要有具体锚点和一句口语判断。`,
    `- 至少 ${longCount} 条 36-85 字长评论，写成真实观众的场景、顾虑、预算、对比或圈内吹水，不要写成评测结论。`,
    `- 至少 ${questionCount} 条只问一句，不要自己回答。`,
    `- 至少 ${fragmentCount} 条半句/碎片句，可以没句号，像评论区顺手打的。`,
    `- 至少 ${skepticalCount} 条轻微不买账或先观望，不要全在帮视频卖货。`,
    "- 短评里留一部分不写型号，只接视频语境或上一条评论的感觉，比如“这我真会看花”“买早的人沉默了”。",
    "- 长评论也要口语，允许逗号和停顿，允许少量轻跑题，但不要出现分点、总分总、产品力这类写稿腔。",
    "- 不要整批都短成关键词堆，也不要整批都像认真分析。",
    "- 同一种开头最多用 2 次；同一个锚点不要连续刷。"
  ].join("\n");
}

function getTargetLongCommentCount(count: number) {
  return Math.max(1, Math.round(count * 0.18));
}

function needsMoreCommentSamples(
  selection: CommentSelectionResult,
  count: number,
  targetLongCommentCount: number,
  targetIntentBuckets: CommentIntentBuckets
) {
  if (selection.items.length < count) return true;
  const outputPreview = pickCommentSamplesForOutput(selection.items, count, targetLongCommentCount, targetIntentBuckets);
  if (countLongComments(outputPreview) < targetLongCommentCount) return true;
  return Boolean(findMissingCommentIntent(summarizeCommentIntentBuckets(outputPreview), targetIntentBuckets));
}

function pickCommentSamplesForOutput(
  items: string[],
  count: number,
  targetLongCommentCount: number,
  targetIntentBuckets?: CommentIntentBuckets
) {
  const longItems = items.filter(isLongComment).slice(0, targetLongCommentCount);
  const picked = new Set(longItems);
  const output: string[] = [];
  for (const item of items) {
    if (picked.has(item) && output.length < targetLongCommentCount) {
      output.push(item);
    }
  }
  if (targetIntentBuckets) {
    const intentOrder: CommentIntent[] = ["follow", "question", "experience", "skeptical", "comparison", "price", "chatter"];
    for (const intent of intentOrder) {
      const already = output.filter((item) => classifyCommentIntent(item) === intent).length;
      const need = Math.max(getCommentIntentSoftMinimum(intent, targetIntentBuckets[intent]) - already, 0);
      if (!need) continue;
      let added = 0;
      for (const item of items) {
        if (output.length >= count || added >= need) break;
        if (picked.has(item) || classifyCommentIntent(item) !== intent) continue;
        picked.add(item);
        output.push(item);
        added += 1;
      }
    }
  }
  for (const item of items) {
    if (output.length >= count) break;
    if (picked.has(item)) continue;
    output.push(item);
  }
  return output.slice(0, count);
}

function countLongComments(items: string[]) {
  return items.filter(isLongComment).length;
}

function isLongComment(value: string) {
  return Array.from(value).length >= 36;
}

type CommentSelectionResult = {
  items: string[];
  lengthBuckets: {
    short: number;
    medium: number;
    long: number;
  };
  lowSignalRejectedCount: number;
  syntheticRejectedCount: number;
  nearDuplicateRejectedCount: number;
  repeatedStyleRejectedCount: number;
  entityCorrectedCount: number;
  unsupportedEntityRejectedCount: number;
  entityCorrections: CommentEntityCorrection[];
};

function selectCommentSamples(
  values: string[],
  sourceBrief: CommentSourceBrief | undefined,
  entityGuard: CommentEntityGuard,
  targetCount: number
): CommentSelectionResult {
  const anchorTerms = sourceBrief ? buildCommentAnchorTerms(sourceBrief) : [];
  const seen = new Set<string>();
  const styleCounts = new Map<string, number>();
  const repeatedStyleLimit = clampCount(Math.round(targetCount * 0.08), 4, 12, 8);
  const output: string[] = [];
  let lowSignalRejectedCount = 0;
  let syntheticRejectedCount = 0;
  let nearDuplicateRejectedCount = 0;
  let repeatedStyleRejectedCount = 0;
  let entityCorrectedCount = 0;
  let unsupportedEntityRejectedCount = 0;
  const entityCorrections: CommentEntityCorrection[] = [];
  for (const raw of values) {
    const normalized = normalizeGeneratedCommentText(raw, entityGuard);
    const value = normalized.text;
    entityCorrectedCount += normalized.corrections.length;
    entityCorrections.push(...normalized.corrections);
    if (value.length < 2 || value.length > 140 || /^\{.*\}$/.test(value) || /^\[.*\]$/.test(value)) {
      lowSignalRejectedCount += 1;
      continue;
    }
    if (findUnsupportedModelTerms(value, entityGuard).length) {
      unsupportedEntityRejectedCount += 1;
      continue;
    }
    if (isLowSignalComment(value, anchorTerms)) {
      lowSignalRejectedCount += 1;
      continue;
    }
    if (isSyntheticComment(value, anchorTerms)) {
      syntheticRejectedCount += 1;
      continue;
    }
    const key = commentFingerprint(value);
    if (!key || seen.has(key) || isNearDuplicateComment(value, output)) {
      nearDuplicateRejectedCount += 1;
      continue;
    }
    const styleKey = commentStyleFingerprint(value);
    const styleCount = styleKey ? styleCounts.get(styleKey) || 0 : 0;
    if (styleKey && styleCount >= repeatedStyleLimit) {
      repeatedStyleRejectedCount += 1;
      continue;
    }
    seen.add(key);
    if (styleKey) styleCounts.set(styleKey, styleCount + 1);
    output.push(value);
  }
  return {
    items: output,
    lengthBuckets: summarizeCommentLengthBuckets(output),
    lowSignalRejectedCount,
    syntheticRejectedCount,
    nearDuplicateRejectedCount,
    repeatedStyleRejectedCount,
    entityCorrectedCount,
    unsupportedEntityRejectedCount,
    entityCorrections: uniqueEntityCorrections(entityCorrections)
  };
}

function normalizeGeneratedCommentText(raw: unknown, entityGuard: CommentEntityGuard) {
  return normalizeTextWithEntityGuard(
    String(raw || "").replace(/^"+|"+$/g, "").replace(/^\d+[.、]\s*/, "").replace(/\s+/g, " ").trim(),
    entityGuard,
    "comment"
  );
}

function commentStyleFingerprint(value: string) {
  if (/会不会|会不会有|会不会太|会不会更/.test(value)) return "question-will";
  if (/是不是|算不算|能不能|可不可以/.test(value)) return "question-is";
  if (/真能|真的能|用得出来|感知/.test(value)) return "question-feel";
  if (/有点|有点儿|挺狠|太狠|压手|沉默/.test(value)) return "soft-judgment";
  if (/听着|看着|看起来|看上去/.test(value)) return "sensory-judgment";
  if (/别买错|买错|看清|盯紧|版本/.test(value)) return "version-warning";
  if (/差很多|差别大|差在哪|咋分|怎么选/.test(value)) return "comparison-question";
  if (/再蹲|蹲蹲|先蹲|蹲个/.test(value)) return "wait-and-see";
  if (/^(?:[A-Za-z0-9.+-]+|[\u4e00-\u9fa5A-Za-z0-9.+-]{2,12})(?:那|那个|这|这个)?/.test(value) && /[吗？?]$/.test(value)) {
    return "tidy-subject-question";
  }
  return "";
}

function buildCommentAnchorTerms(brief: CommentSourceBrief) {
  return uniqueText([
    ...brief.anchorTerms,
    ...brief.subjects,
    ...brief.keyFacts.flatMap(extractSourceAnchorTerms),
    ...brief.viewerScenes.flatMap(extractSourceAnchorTerms),
    ...brief.discussionAngles.flatMap(extractSourceAnchorTerms)
  ])
    .map((term) => term.replace(/[^\u4e00-\u9fa5A-Za-z0-9.+%-]/g, "").trim())
    .filter((term) => term.length >= 2 && !isGenericAnchorTerm(term))
    .slice(0, 80);
}

function isLowSignalComment(value: string, anchorTerms: string[]) {
  const normalized = normalizeCommentKey(value);
  if (!normalized) return true;
  const hasAnchor = anchorTerms.some((term) => value.includes(term));
  if (hasAnchor) return false;
  if (/^(不错|可以|真香|种草了|心动了|学到了|安排了|冲了|支持|好用|太真实了|有点东西|笑死|哈哈哈|确实)$/i.test(value)) return true;
  if (/^(这|这个|这波|感觉|真的|确实|有点|看完).{0,8}(不错|可以|实用|心动|种草|真香|离谱|合理|厉害|舒服)[。！!~～]*$/i.test(value)) return true;
  if (/^(被种草了|已经心动了|太会了|狠狠心动|狠狠爱了)[。！!~～]*$/i.test(value)) return true;
  return value.length <= 8 && /^(这|这个|这波|感觉|真的|确实|有点|太|很)/.test(value);
}

function isSyntheticComment(value: string, anchorTerms: string[]) {
  const hasAnchor = anchorTerms.some((term) => value.includes(term));
  const hasChatterCue = hasCommentChatterCue(value);
  const punctuationCount = (value.match(/[，,。！？!?]/g) || []).length;
  const aiWordCount = (value.match(/确实|感觉|适合|需求|路线|定位|配置|参数|普通人|对我来说|我这种|这个点|这点|至少|其实|反而|尤其|兼顾|取舍|场景/g) || []).length;
  const hasPolishedTurn = /(听着|看着|主打|核心|如果|虽然|不过|但).{0,18}(确实|感觉|适合|需求|路线|定位|配置|参数|普通人|对我来说|我这种|取舍)/.test(value);
  const hasReviewTone = /(核心卖点|需求场景|适合人群|产品力|配置拉满|定位清晰|取舍很明确|体验闭环)/.test(value);
  const hasHumanCue = /(我|想问|有没有|会不会|怕|担心|宿舍|办公室|预算|到手|买过|用过|纠结|观望|等|蹲|下单)/.test(value);

  if (hasReviewTone) return true;
  if (value.length >= 48 && punctuationCount >= 2 && aiWordCount >= 5 && !hasHumanCue) return true;
  if (value.length >= 36 && hasPolishedTurn && aiWordCount >= 4 && !hasHumanCue) return true;
  if (!hasAnchor && !hasChatterCue && value.length >= 32 && aiWordCount >= 3) return true;
  return false;
}

function isNearDuplicateComment(value: string, accepted: string[]) {
  const valueTokens = commentSimilarityTokens(value);
  if (valueTokens.length < 4) return false;
  return accepted.some((existing) => {
    const existingTokens = commentSimilarityTokens(existing);
    if (existingTokens.length < 4) return false;
    const overlap = valueTokens.filter((token) => existingTokens.includes(token)).length;
    const dice = (overlap * 2) / (valueTokens.length + existingTokens.length);
    return dice >= 0.68 || (overlap >= 9 && Math.min(valueTokens.length, existingTokens.length) <= 18);
  });
}

function commentSimilarityTokens(value: string) {
  const normalized = normalizeCommentKey(value);
  const tokens = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2));
  }
  for (const token of value.match(/[A-Za-z0-9.+%-]{2,}/g) || []) {
    tokens.add(token.toLowerCase());
  }
  return [...tokens];
}

function extractSourceAnchorTerms(text: string) {
  const terms = new Set<string>();
  const mixedTerms = text.match(/[\u4e00-\u9fa5]{0,6}[A-Za-z0-9][A-Za-z0-9.+%-]*[\u4e00-\u9fa5]{0,6}/g) || [];
  for (const term of mixedTerms) {
    const normalized = term.replace(/^[的了和是这那在有用把给到]+|[的了和是这那在有用把给到]+$/g, "").trim();
    if (normalized.length >= 2 && normalized.length <= 24 && !isGenericAnchorTerm(normalized)) terms.add(normalized);
  }
  const domainTerms = text.match(/[\u4e00-\u9fa5A-Za-z0-9.+%-]*(?:高考|学生党|打工人|宿舍|办公室|桌面|优惠|凑单|满减|价格|配色|彩屏|旋钮|灯效|续航|电池|三模|蓝牙|有线|热插拔|轴体|消音|填充|脚撑|手感|键盘|鼠标|耳机|电脑|手机|游戏|活动|福利|皮肤|补给|版本|回归|周年)[\u4e00-\u9fa5A-Za-z0-9.+%-]*/g) || [];
  for (const term of domainTerms) {
    const normalized = term.trim();
    if (normalized.length >= 2 && normalized.length <= 24 && !isGenericAnchorTerm(normalized)) terms.add(normalized);
  }
  return [...terms].slice(0, 50);
}

function isGenericAnchorTerm(term: string) {
  return /^(一个|这个|那个|视频|文案|评论|观众|东西|感觉|真的|可以|比较|不错|问题|时候|现在|大家|自己|一下|直接|素材|标题|正文|平台)$/.test(term);
}

function commentFingerprint(value: string) {
  return normalizeCommentKey(value)
    .replace(/(?:真没想到|这波可以|有点意思|我先观望|哈哈)+$/g, "")
    .replace(/[啊吧呀呢哦哈]+$/g, "");
}

function normalizeCommentKey(value: string) {
  return value
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, "")
    .toLowerCase();
}

function makeCommentItem(text: string, platform: Platform | "unknown", index: number): DraftCommentAsset {
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
  const jsonValues = uniqueText(values.map((value) => (typeof value === "string" ? value : ""))).filter(Boolean);
  return jsonValues.length ? jsonValues : parseLooseStringList(text);
}

function parseLooseStringList(text: string) {
  const values = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^```/.test(line))
    .map((line) => {
      const match = line.match(/^(?:\d{1,3}[.、)]|[-*•])\s*(.+)$/);
      return match?.[1] || "";
    })
    .map((line) => line.replace(/^["'“”]+|["'“”，,]+$/g, "").trim())
    .filter((line) => line.length >= 2 && line.length <= 140);
  return values.length >= 3 ? uniqueText(values) : [];
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

function clampCount(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function decodeXml(input: string) {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
