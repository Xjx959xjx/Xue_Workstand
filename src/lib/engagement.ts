import { chatCompleteStrict, getChatRuntimeConfig } from "./ai";
import {
  getBilibiliComments,
  getDouyinVideoCommentsByUrl
} from "./opencli";
import {
  classifyEngagementCommentIntent,
  commentStyleChannel,
  extractNativeEmotes,
  findUnsupportedNativeEmotes,
  formatEngagementStyleProfile,
  hasNativeEmote,
  loadEngagementStyleProfile,
  type EngagementCommentIntent,
  type EngagementStyleProfile
} from "./engagement-style";
import {
  buildEngagementTransportGuard,
  containsEngagementTransportLeak,
  sanitizeEngagementGenerationText,
  type EngagementTransportGuard
} from "./engagement-transport";
import {
  getAccountSummary,
  getProjectSummary,
  readEngagementCache,
  resolveAccount,
  resolveDraft,
  resolveEngagementRecord,
  resolveProject,
  saveEngagementRecord,
  updateEngagementRecord,
  updateDraftAssets,
  writeEngagementCache
} from "./storage";
import { extractFirstLinkFromInput } from "./platform-links";
import { transcribeLinkSource } from "./transcription";
import {
  Draft,
  DraftCommentAsset,
  DraftDanmakuAsset,
  EngagementGenerationMode,
  EngagementGenerationRequest,
  EngagementGenerationTimings,
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
  durationSec?: number;
  segments?: Array<{
    startSec: number;
    endSec: number;
    text: string;
  }>;
};

type EngagementOptions = {
  includeComments?: boolean;
  commentCount?: number;
  includeDanmaku?: boolean;
  danmakuCount?: number;
  generationMode?: EngagementGenerationMode;
  targetPlatform?: Platform;
};

type NormalizedEngagementOptions = EngagementRecord["options"] & {
  generationMode: EngagementGenerationMode;
};

export type GenerateEngagementInput = EngagementGenerationRequest;

export type EngagementGenerationProgress = {
  stage: "source" | "brief" | "research" | "generate" | "filter";
  message: string;
  progress: number;
  previewComments?: DraftCommentAsset[];
};

export type GenerateEngagementOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: EngagementGenerationProgress) => void | Promise<void>;
};

type SourceContext = {
  platform: Platform;
  accountId: string;
  accountName: string;
  comments: string[];
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

type CommentIntent = EngagementCommentIntent;

type CommentIntentBuckets = Record<CommentIntent, number>;

type CommentEntityCorrection = {
  from: string;
  to: string;
  stage: "brief" | "relatedResearch" | "comment";
};

type CommentEntityGuard = {
  allowedModels: string[];
  allowedModelKeys: Set<string>;
  blockedModels: string[];
  blockedModelKeys: Set<string>;
  aliases: Map<string, string>;
};

const ENGAGEMENT_ENGINE_VERSION = "engagement-v3.7";
const ENGAGEMENT_DANMAKU_ENGINE_VERSION = "danmaku-v2";
const ENGAGEMENT_SOURCE_CACHE_VERSION = "engagement-v3";
const ENGAGEMENT_BRIEF_CACHE_VERSION = "engagement-v3.2";
const COMMENT_GENERATION_BATCH_SIZE = 8;
const COMMENT_MODEL_CONCURRENCY = clampCount(Number.parseInt(process.env.ENGAGEMENT_MODEL_CONCURRENCY || "", 10), 1, 4, 4);
const DANMAKU_GENERATION_BATCH_SIZE = 16;
const DANMAKU_MODEL_CONCURRENCY = Math.min(COMMENT_MODEL_CONCURRENCY, 2);
const COMMENT_CANDIDATE_RATIO = clampRate(Number.parseFloat(process.env.ENGAGEMENT_COMMENT_CANDIDATE_RATIO || ""), 1.05, 1.5, 1.4);
const COMMENT_EXPLICIT_ANCHOR_RATE = 0.24;
const COMMENT_GENERATION_MAX_ROUNDS = 2;
const ENGAGEMENT_AUTO_SUPPLEMENT_MAX_PASSES = 2;
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
  { pattern: /今年6月8是直降/g, replacement: "今年618是直降" },
  { pattern: /漫步者家新出的\s*clip\s*s1/gi, replacement: "漫步者家新出的 LolliClip SE" },
  {
    pattern: /\b(?:roly\s+cap|lowly\s+cap|lolly\s+clip|lonely\s+(?:k\s+)?clip)\s+s(?:1|e)\b/gi,
    replacement: "LolliClip SE"
  },
  { pattern: /\bLHTC\s*5(?:\.0)?\b/gi, replacement: "LHDC 5.0" },
  { pattern: /\bdeep\s*sk\b/gi, replacement: "DeepSeek" },
  { pattern: /服役了34年/g, replacement: "服役了3、4年" },
  { pattern: /5\s*千瓦超广角/g, replacement: "5000万像素超广角" },
  { pattern: /\b7060\s*ma\b/gi, replacement: "7060mAh" },
  { pattern: /\bPY\s*4\b/gi, replacement: "Pocket 4" },
  { pattern: /大疆\s*POCKE\b/gi, replacement: "大疆 Pocket" },
  { pattern: /在\s*Poke\s*上/gi, replacement: "在 Pocket 上" },
  { pattern: /洛克西编码/g, replacement: "Log C 编码" },
  { pattern: /起售价不低于\s*(\d{3,6})\s*tb/gi, replacement: "起售价不低于$1元" }
];

export async function generateEngagement(input: GenerateEngagementInput, runOptions: GenerateEngagementOptions = {}) {
  let result = await generateEngagementPass(input, runOptions);
  let supplementPass = 0;

  while (supplementPass < ENGAGEMENT_AUTO_SUPPLEMENT_MAX_PASSES) {
    const gaps = getEngagementCountGaps(result.record);
    if (!gaps.commentCount && !gaps.danmakuCount) break;

    supplementPass += 1;
    await emitEngagementProgress(runOptions, {
      stage: "generate",
      message: `正在自动补齐：${formatEngagementGapSummary(gaps)}（第 ${supplementPass}/${ENGAGEMENT_AUTO_SUPPLEMENT_MAX_PASSES} 轮）`,
      progress: Math.min(98, 94 + supplementPass)
    });

    const currentRecord = result.record;
    try {
      const supplemented = await generateEngagementPass(
        {
          sourceType: "record",
          recordId: currentRecord.id,
          includeComments: gaps.commentCount > 0,
          commentCount: Math.max(gaps.commentCount, 1),
          includeDanmaku: gaps.danmakuCount > 0,
          danmakuCount: Math.max(gaps.danmakuCount, 1),
          generationMode: currentRecord.options.generationMode || "quick",
          targetPlatform: currentRecord.platform === "unknown"
            ? currentRecord.options.targetPlatform
            : currentRecord.platform
        },
        {
          signal: runOptions.signal,
          async onProgress(progress) {
            const mergedPreview = progress.previewComments?.length
              ? mergeCommentItems(currentRecord.comments?.items || [], progress.previewComments)
              : undefined;
            await runOptions.onProgress?.({
              ...progress,
              message: `自动补齐中：${progress.message}`,
              progress: Math.min(98, Math.max(95, 94 + Math.round(progress.progress * 0.04))),
              previewComments: mergedPreview
            });
          }
        }
      );
      result = supplemented;
    } catch (error) {
      throwIfAborted(runOptions.signal);
      const reason = error instanceof Error ? error.message : "模型没有返回可用内容";
      const fallbackReason = `自动补齐第 ${supplementPass} 轮失败：${reason}`;
      const record = await updateEngagementRecord(currentRecord.id, (record) => ({
        ...record,
        fallback: true,
        fallbackReason: uniqueText([record.fallbackReason || "", fallbackReason]).join("；")
      }));
      result = {
        ...result,
        record,
        comments: record.comments,
        danmaku: record.danmaku
      };
    }
  }

  if (supplementPass > 0) {
    const remaining = getEngagementCountGaps(result.record);
    await emitEngagementProgress(runOptions, {
      stage: "filter",
      message: remaining.commentCount || remaining.danmakuCount
        ? `自动补齐已结束，仍缺：${formatEngagementGapSummary(remaining)}`
        : "评论和弹幕已自动补齐",
      progress: 99,
      previewComments: result.record.comments?.items
    });
  }

  return result;
}

async function generateEngagementPass(input: GenerateEngagementInput, runOptions: GenerateEngagementOptions = {}) {
  const totalStartedAt = Date.now();
  throwIfAborted(runOptions.signal);
  const normalizedInput = normalizeEngagementSourceInput(input);
  const options = normalizeEngagementOptions(normalizedInput);
  if (!options.includeComments && !options.includeDanmaku) {
    throw new Error("请至少选择评论或弹幕。");
  }

  await emitEngagementProgress(runOptions, {
    stage: "source",
    message: normalizedInput.sourceType === "url" ? "正在转写链接视频，取得文稿后再生成评论" : normalizedInput.sourceType === "record" ? "正在读取原评论记录" : "正在整理素材",
    progress: 10
  });
  const sourceStartedAt = Date.now();
  const prepared = await prepareEngagementSource(normalizedInput, options, runOptions.signal);
  const sourceMs = Date.now() - sourceStartedAt;
  if (options.includeDanmaku && prepared.platform !== "bilibili") {
    throw new Error("弹幕只支持 B站内容。抖音内容请只生成评论，或把目标平台切换为 B站。");
  }
  await emitEngagementProgress(runOptions, {
    stage: "brief",
    message: options.generationMode === "reference" ? "正在整理素材并准备当前视频原评" : "正在提取评论锚点",
    progress: 24
  });
  throwIfAborted(runOptions.signal);
  const commentsPromise = options.includeComments
    ? generateComments({
        source: prepared.content,
        contexts: prepared.contexts,
        count: options.commentCount,
        platform: prepared.platform,
        sourceUrl: prepared.resolvedUrl || prepared.sourceUrl,
        generationMode: options.generationMode,
        excludedComments: prepared.existingRecord?.comments?.items.map((item) => item.text) || [],
        signal: runOptions.signal,
        onProgress: runOptions.onProgress
      })
    : Promise.resolve(null);
  const danmakuPromise = options.includeDanmaku
    ? generateDanmaku(
        prepared.content,
        prepared.contexts,
        options.danmakuCount,
        prepared.existingRecord?.danmaku?.items.map((item) => item.text) || [],
        runOptions.signal
      )
    : Promise.resolve(null);
  const [comments, danmaku] = await Promise.all([commentsPromise, danmakuPromise]);
  throwIfAborted(runOptions.signal);

  const timings: EngagementGenerationTimings = {
    sourceMs,
    briefMs: comments?.briefMs || 0,
    researchMs: comments?.researchMs || 0,
    generationMs: comments?.generationMs || 0,
    totalMs: Date.now() - totalStartedAt,
    cacheHits: uniqueCacheHits([...(prepared.cacheHits || []), ...(comments?.cacheHits || [])])
  };
  const savedComments = comments
    ? buildSavedCommentAsset(comments, options.commentCount, options.generationMode, timings)
    : undefined;
  const savedDanmaku = danmaku
    ? buildSavedDanmakuAsset(danmaku, options.danmakuCount)
    : undefined;

  let draft: Draft | undefined;
  if (prepared.draft) {
    draft = await updateDraftAssets(prepared.draft.id, (current) => ({
      ...current,
      comments: savedComments || current.comments,
      danmaku: savedDanmaku || current.danmaku
    }));
  }

  const record = prepared.existingRecord
    ? await updateEngagementRecord(prepared.existingRecord.id, (current) => {
        const targetCount = current.comments?.requestedCount || current.options.commentCount;
        const mergedItems = savedComments
          ? mergeCommentItems(current.comments?.items || [], savedComments.items).slice(0, targetCount)
          : current.comments?.items || [];
        const nextComments = savedComments
          ? {
              ...savedComments,
              requestedCount: targetCount,
              actualCount: mergedItems.length,
              partial: mergedItems.length < targetCount,
              diagnostics: mergeSupplementDiagnostics(
                current.comments?.diagnostics,
                savedComments.diagnostics,
                mergedItems.length - (current.comments?.items.length || 0),
                mergedItems,
                targetCount
              ),
              items: mergedItems
            }
          : current.comments;
        const targetDanmakuCount = current.danmaku?.requestedCount
          || (current.options.includeDanmaku ? current.options.danmakuCount : options.danmakuCount);
        const mergedDanmakuItems = savedDanmaku
          ? mergeDanmakuItems(current.danmaku?.items || [], savedDanmaku.items).slice(0, targetDanmakuCount)
          : current.danmaku?.items || [];
        const nextDanmaku = savedDanmaku
          ? {
              ...savedDanmaku,
              requestedCount: targetDanmakuCount,
              actualCount: mergedDanmakuItems.length,
              partial: mergedDanmakuItems.length < targetDanmakuCount,
              fallback: Boolean(current.danmaku?.fallback || savedDanmaku.fallback),
              fallbackReason: uniqueText([
                current.danmaku?.fallbackReason || "",
                savedDanmaku.fallbackReason || ""
              ]).join("；") || undefined,
              styleSampleCount: Math.max(current.danmaku?.styleSampleCount || 0, savedDanmaku.styleSampleCount || 0),
              styleVideoCount: Math.max(current.danmaku?.styleVideoCount || 0, savedDanmaku.styleVideoCount || 0),
              styleTopics: uniqueText([...(current.danmaku?.styleTopics || []), ...(savedDanmaku.styleTopics || [])]),
              engineVersion: savedDanmaku.engineVersion || current.danmaku?.engineVersion,
              diagnostics: mergeDanmakuDiagnostics(
                current.danmaku?.diagnostics,
                savedDanmaku.diagnostics,
                mergedDanmakuItems.length
              ),
              items: mergedDanmakuItems
            }
          : current.danmaku;
        return {
          ...current,
          options: {
            ...current.options,
            generationMode: options.generationMode,
            targetPlatform: prepared.platform === "unknown" ? options.targetPlatform : prepared.platform
          },
          comments: nextComments,
          danmaku: nextDanmaku,
          fallback: Boolean(nextComments?.fallback || nextDanmaku?.fallback || current.fallback),
          fallbackReason: [current.fallbackReason, prepared.fallbackReason, nextComments?.fallbackReason, nextDanmaku?.fallbackReason]
            .filter(Boolean)
            .join("；") || undefined
        };
      })
    : await saveEngagementRecord({
        sourceType: prepared.sourceType,
        title: prepared.content.title,
        sourceAccountName: prepared.sourceAccountName,
        sourceUrl: prepared.sourceUrl,
        resolvedUrl: prepared.resolvedUrl,
        platform: prepared.platform,
        draftId: prepared.draft?.id,
        sourceText: prepared.content.content,
        options: {
          ...options,
          targetPlatform: prepared.platform === "unknown" ? options.targetPlatform : prepared.platform
        },
        comments: savedComments,
        danmaku: savedDanmaku,
        fallback: Boolean(comments?.fallback || danmaku?.fallback || prepared.fallback),
        fallbackReason: [prepared.fallbackReason, comments?.fallbackReason, danmaku?.fallbackReason]
          .filter(Boolean)
          .join("；") || undefined
      });

  if (prepared.existingRecord?.draftId && (record.comments || record.danmaku)) {
    const updatedDraft = await updateDraftAssets(prepared.existingRecord.draftId, (current) => ({
      ...current,
      comments: record.comments || current.comments,
      danmaku: record.danmaku || current.danmaku
    }));
    draft = updatedDraft.targetType === "account" || updatedDraft.targetType === "project" ? updatedDraft : draft;
  }

  return {
    draft,
    record,
    comments: record.comments,
    danmaku: record.danmaku
  };
}

function getEngagementCountGaps(record: EngagementRecord) {
  const requestedCommentCount = record.comments?.requestedCount
    || (record.options.includeComments ? record.options.commentCount : 0);
  const requestedDanmakuCount = record.danmaku?.requestedCount
    || (record.options.includeDanmaku ? record.options.danmakuCount : 0);
  return {
    commentCount: Math.max(requestedCommentCount - (record.comments?.items.length || 0), 0),
    danmakuCount: Math.max(requestedDanmakuCount - (record.danmaku?.items.length || 0), 0)
  };
}

function formatEngagementGapSummary(gaps: { commentCount: number; danmakuCount: number }) {
  return [
    gaps.commentCount ? `${gaps.commentCount} 条评论` : "",
    gaps.danmakuCount ? `${gaps.danmakuCount} 条弹幕` : ""
  ].filter(Boolean).join("、");
}

async function emitEngagementProgress(
  options: GenerateEngagementOptions,
  progress: EngagementGenerationProgress
) {
  throwIfAborted(options.signal);
  await options.onProgress?.(progress);
}

function buildSavedCommentAsset(
  comments: Awaited<ReturnType<typeof generateComments>>,
  requestedCount: number,
  generationMode: EngagementGenerationMode,
  timings: EngagementGenerationTimings
) {
  return {
    generatedAt: nowIso(),
    requestedCount,
    actualCount: comments.items.length,
    partial: comments.items.length < requestedCount,
    generationMode,
    engineVersion: ENGAGEMENT_ENGINE_VERSION,
    timings,
    usedModel: comments.usedModel,
    fallback: comments.fallback,
    fallbackReason: comments.fallbackReason,
    diagnostics: comments.diagnostics,
    items: comments.items
  };
}

function buildSavedDanmakuAsset(
  danmaku: Awaited<ReturnType<typeof generateDanmaku>>,
  requestedCount: number
) {
  return {
    generatedAt: nowIso(),
    requestedCount,
    actualCount: danmaku.items.length,
    partial: danmaku.items.length < requestedCount,
    usedModel: danmaku.usedModel,
    fallback: danmaku.fallback,
    fallbackReason: danmaku.fallbackReason,
    engineVersion: ENGAGEMENT_DANMAKU_ENGINE_VERSION,
    timingBasis: danmaku.timingBasis,
    durationSec: danmaku.durationSec,
    styleSampleCount: danmaku.styleSampleCount,
    styleVideoCount: danmaku.styleVideoCount,
    styleTopics: danmaku.styleTopics,
    sameSecondRate: danmaku.sameSecondRate,
    repeatRate: danmaku.repeatRate,
    burstShare: danmaku.burstShare,
    diagnostics: danmaku.diagnostics,
    items: danmaku.items
  };
}

function mergeCommentItems(existing: DraftCommentAsset[], incoming: DraftCommentAsset[]) {
  const seen = new Set(existing.map((item) => commentFingerprint(item.text)));
  const merged = [...existing];
  for (const item of incoming) {
    const key = commentFingerprint(item.text);
    if (!key || seen.has(key) || isNearDuplicateComment(item.text, merged.map((entry) => entry.text))) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.map((item, index) => ({ ...item, id: `comment-${index + 1}-${shortHash(item.text)}` }));
}

function mergeDanmakuItems(existing: DraftDanmakuAsset[], incoming: DraftDanmakuAsset[]) {
  const merged = [...existing];
  const exactKeys = new Set(existing.map((item) => `${item.timeSec.toFixed(2)}:${commentFingerprint(item.text)}`));
  const textCounts = new Map<string, number>();
  existing.forEach((item) => {
    const key = commentFingerprint(item.text);
    if (key) textCounts.set(key, (textCounts.get(key) || 0) + 1);
  });
  for (const item of incoming) {
    const textKey = commentFingerprint(item.text);
    const exactKey = `${item.timeSec.toFixed(2)}:${textKey}`;
    if (!textKey || exactKeys.has(exactKey) || (textCounts.get(textKey) || 0) >= 3) continue;
    exactKeys.add(exactKey);
    textCounts.set(textKey, (textCounts.get(textKey) || 0) + 1);
    merged.push(item);
  }
  return merged
    .sort((left, right) => left.timeSec - right.timeSec)
    .map((item, index) => ({ ...item, id: `danmaku-${index + 1}-${shortHash(`${item.timeSec}-${item.text}`)}` }));
}

function mergeDanmakuDiagnostics(
  existing: NonNullable<NonNullable<Draft["assets"]>["danmaku"]>["diagnostics"],
  incoming: NonNullable<NonNullable<Draft["assets"]>["danmaku"]>["diagnostics"],
  completedCount: number
) {
  if (!incoming) return existing;
  if (!existing) return { ...incoming, completedCount };
  return {
    ...incoming,
    batchCount: existing.batchCount + incoming.batchCount,
    parsedCount: existing.parsedCount + incoming.parsedCount,
    completedCount,
    rejectedCount: existing.rejectedCount + incoming.rejectedCount,
    batches: [...existing.batches, ...incoming.batches].map((batch, index) => ({ ...batch, index }))
  };
}

function mergeSupplementDiagnostics(
  existing: NonNullable<NonNullable<Draft["assets"]>["comments"]>["diagnostics"],
  incoming: NonNullable<NonNullable<Draft["assets"]>["comments"]>["diagnostics"],
  supplementedCount: number,
  mergedItems: DraftCommentAsset[],
  requestedCount: number
) {
  if (!incoming) return existing;
  const existingGeneration = existing?.generation;
  const incomingGeneration = incoming.generation;
  if (!incomingGeneration) return incoming;
  const existingBatches = existingGeneration?.batches || [];
  const mergedTexts = mergedItems.map((item) => item.text);
  return {
    ...existing,
    ...incoming,
    generation: {
      ...existingGeneration,
      ...incomingGeneration,
      requestedCount,
      batchCount: existingBatches.length + incomingGeneration.batches.length,
      parsedCount: (existingGeneration?.parsedCount || 0) + incomingGeneration.parsedCount,
      completedCount: mergedItems.length,
      supplementedCount: (existingGeneration?.supplementedCount || 0) + Math.max(supplementedCount, 0),
      targetLongCommentCount: existingGeneration?.targetLongCommentCount ?? incomingGeneration.targetLongCommentCount,
      lengthBuckets: summarizeCommentLengthBuckets(mergedTexts),
      targetIntentBuckets: existingGeneration?.targetIntentBuckets ?? incomingGeneration.targetIntentBuckets,
      intentBuckets: summarizeCommentIntentBuckets(mergedTexts),
      lowSignalRejectedCount: (existingGeneration?.lowSignalRejectedCount || 0) + (incomingGeneration.lowSignalRejectedCount || 0),
      syntheticRejectedCount: (existingGeneration?.syntheticRejectedCount || 0) + (incomingGeneration.syntheticRejectedCount || 0),
      nearDuplicateRejectedCount: (existingGeneration?.nearDuplicateRejectedCount || 0) + (incomingGeneration.nearDuplicateRejectedCount || 0),
      repeatedStyleRejectedCount: (existingGeneration?.repeatedStyleRejectedCount || 0) + (incomingGeneration.repeatedStyleRejectedCount || 0),
      entityCorrectedCount: (existingGeneration?.entityCorrectedCount || 0) + (incomingGeneration.entityCorrectedCount || 0),
      unsupportedEntityRejectedCount: (existingGeneration?.unsupportedEntityRejectedCount || 0) + (incomingGeneration.unsupportedEntityRejectedCount || 0),
      transportRejectedCount: (existingGeneration?.transportRejectedCount || 0) + (incomingGeneration.transportRejectedCount || 0),
      nativeEmoteCount: mergedTexts.filter(hasNativeEmote).length,
      targetNativeEmoteCount: existingGeneration?.targetNativeEmoteCount ?? incomingGeneration.targetNativeEmoteCount,
      unsupportedEmoteRejectedCount: (existingGeneration?.unsupportedEmoteRejectedCount || 0) + (incomingGeneration.unsupportedEmoteRejectedCount || 0),
      batches: [...existingBatches, ...incomingGeneration.batches].map((batch, index) => ({ ...batch, index }))
    }
  };
}

function uniqueCacheHits(values: EngagementGenerationTimings["cacheHits"]) {
  return [...new Set(values)];
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
    danmakuCount: input.danmakuCount,
    generationMode: "quick"
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

async function prepareEngagementSource(input: GenerateEngagementInput, options: NormalizedEngagementOptions, signal?: AbortSignal): Promise<{
  content: EngagementContent;
  contexts: SourceContext[];
  platform: Platform | "unknown";
  sourceType: EngagementRecord["sourceType"];
  draft?: Draft;
  existingRecord?: EngagementRecord;
  sourceUrl?: string;
  resolvedUrl?: string;
  sourceAccountName?: string;
  fallback?: boolean;
  fallbackReason?: string;
  cacheHits?: EngagementGenerationTimings["cacheHits"];
}> {
  throwIfAborted(signal);
  if (input.sourceType === "record") {
    const existingRecord = await resolveEngagementRecord(input.recordId);
    return {
      content: {
        id: existingRecord.id,
        title: normalizeKnownEngagementTerms(existingRecord.title),
        content: normalizeKnownEngagementTerms(existingRecord.sourceText),
        input: existingRecord.sourceUrl || existingRecord.sourceText
      },
      contexts: [],
      platform: existingRecord.platform === "unknown" ? options.targetPlatform || "unknown" : existingRecord.platform,
      sourceType: existingRecord.sourceType,
      existingRecord,
      sourceUrl: existingRecord.sourceUrl,
      resolvedUrl: existingRecord.resolvedUrl,
      sourceAccountName: existingRecord.sourceAccountName,
      cacheHits: []
    };
  }

  if (input.sourceType === "draft") {
    const resolved = await resolveDraft(input.draftId);
    const draft = resolved.draft;
    const contexts = await buildSourceContexts(draft, { includeDanmaku: options.includeDanmaku });
    const platform = draft.targetType === "project"
      ? options.includeDanmaku
        ? contexts.find((context) => context.platform === "bilibili")?.platform || contexts[0]?.platform || "unknown"
        : options.targetPlatform || contexts[0]?.platform || "unknown"
      : draft.platform;
    return {
      content: draftToEngagementContent(draft),
      contexts,
      platform,
      sourceType: "draft",
      draft,
      cacheHits: []
    };
  }

  if (input.sourceType === "text") {
    const text = normalizeKnownEngagementTerms(input.text.trim());
    if (!text) throw new Error("请粘贴文案后再生成。");
    const targetPlatform = input.targetPlatform || options.targetPlatform;
    if (!targetPlatform) {
      throw new Error("粘贴文案生成评论前，请先选择目标平台。链接输入会自动识别平台。");
    }
    return {
      content: {
        id: `text-${shortHash(text)}`,
        title: normalizeKnownEngagementTerms(input.title?.trim() || makeEngagementTitle(text, "粘贴文案")),
        content: text,
        prompt: "",
        input: text
      },
      contexts: [],
      platform: targetPlatform,
      sourceType: "text",
      cacheHits: []
    };
  }

  const url = input.url.trim();
  if (!url) throw new Error("请填写视频链接。");
  try {
    const cacheKey = shortHash(`${ENGAGEMENT_SOURCE_CACHE_VERSION}:source:${url}`);
    const cached = await readEngagementCache<{
      engineVersion: string;
      result: Awaited<ReturnType<typeof transcribeLinkSource>>;
    }>("source", cacheKey);
    const cachedResult = cached?.engineVersion === ENGAGEMENT_SOURCE_CACHE_VERSION && cached.result.text?.trim()
      ? cached.result
      : null;
    const result = cachedResult || await transcribeLinkSource({ url, signal });
    if (result.source === "metadata" || !result.text.trim()) {
      throw new Error(result.fallbackReason || "只解析到视频标题，没有取得可用于评论生成的视频文稿。");
    }
    if (!cachedResult) {
      await writeEngagementCache("source", cacheKey, {
        engineVersion: ENGAGEMENT_SOURCE_CACHE_VERSION,
        cachedAt: nowIso(),
        result
      });
    }
    const content = {
      id: `url-${shortHash(result.resolvedUrl || result.url || url)}`,
      title: normalizeKnownEngagementTerms(result.title || makeEngagementTitle(result.text || url, "视频链接")),
      content: normalizeKnownEngagementTerms(result.text),
      prompt: "",
      input: url,
      durationSec: result.durationSec,
      segments: result.segments
    };
    return {
      content,
      contexts: [],
      platform: result.platform,
      sourceType: "url",
      sourceUrl: result.url,
      resolvedUrl: result.resolvedUrl,
      sourceAccountName: result.sourceAccountName,
      fallback: result.fallback,
      fallbackReason: result.fallbackReason,
      cacheHits: cachedResult ? ["source"] : []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "链接内容读取失败";
    if (/暂不支持|没有解析到/.test(message)) {
      throw new Error(`暂不支持从这个链接生成评论。请使用 B站/抖音视频链接，或改用粘贴文案。${message ? `（${message}）` : ""}`);
    }
    throw error;
  }
}

function normalizeEngagementOptions(input: EngagementOptions): NormalizedEngagementOptions {
  return {
    includeComments: input.includeComments ?? true,
    commentCount: clampCount(input.commentCount ?? 50, 1, 200, 50),
    includeDanmaku: input.includeDanmaku ?? false,
    danmakuCount: clampCount(input.danmakuCount ?? 50, 1, 300, 50),
    generationMode: input.generationMode === "reference" ? "reference" : "quick",
    targetPlatform: input.targetPlatform
  };
}

function normalizeEngagementSourceInput(input: GenerateEngagementInput): GenerateEngagementInput {
  if (input.sourceType !== "text") return input;
  const url = extractFirstLinkFromInput(input.text, { kind: "video" });
  if (!url) return input;

  return {
    sourceType: "url",
    url,
    includeComments: input.includeComments,
    commentCount: input.commentCount,
    includeDanmaku: input.includeDanmaku,
    danmakuCount: input.danmakuCount,
    generationMode: input.generationMode,
    targetPlatform: input.targetPlatform
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

function sanitizeEngagementSource(source: EngagementContent, transportGuard: EngagementTransportGuard): EngagementContent {
  const content = sanitizeEngagementGenerationText(source.content);
  const titleCandidate = sanitizeEngagementGenerationText(source.title);
  const titleLooksLikeShareEnvelope = transportGuard.hasTransportSource && /^\d{5,}[A-Za-z][A-Za-z0-9]{5,}/.test(titleCandidate);
  const title = titleCandidate
    && !titleLooksLikeShareEnvelope
    && !containsEngagementTransportLeak(titleCandidate, transportGuard)
    ? titleCandidate
    : makeEngagementTitle(content, "互动素材");
  const input = sanitizeEngagementGenerationText(source.input || "");
  return {
    ...source,
    title,
    content,
    prompt: sanitizeEngagementGenerationText(source.prompt || "") || undefined,
    input: input && input !== content ? input : undefined,
    segments: source.segments?.map((segment) => ({
      ...segment,
      text: sanitizeEngagementGenerationText(segment.text)
    })).filter((segment) => segment.text)
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
  const rawSourceText = [
    source.title,
    source.content,
    source.prompt || "",
    inputText
  ].join("\n");
  const sourceText = normalizeKnownEngagementTerms(rawSourceText);
  const allowedModels = uniqueText(extractModelLikeTerms(sourceText));
  const aliases = new Map<string, string>();
  if (/LolliClip SE/i.test(sourceText)) aliases.set("CLIPS1", "LolliClip SE");
  const blockedModels = uniqueText(
    extractModelLikeTerms(rawSourceText).filter((term) => {
      const normalized = normalizeKnownEngagementTerms(term);
      const alias = aliases.get(toModelKey(term));
      if (alias) return true;
      return normalized !== term && !allowedModels.some((allowed) => toModelKey(allowed) === toModelKey(term));
    })
  );
  return {
    allowedModels,
    allowedModelKeys: new Set(allowedModels.map(toModelKey)),
    blockedModels,
    blockedModelKeys: new Set(blockedModels.map(toModelKey)),
    aliases
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
  const account = await resolveAccount(platform, accountId);
  const summary = await getAccountSummary(account);
  const contextVideos = prioritizeVideos(summary.videos, sourceVideoIds).slice(0, 10);
  const comments = uniqueText(contextVideos.flatMap((video) => video.topComments || [])).slice(0, 120);
  const danmaku = options.includeDanmaku && platform === "bilibili"
    ? uniqueText(contextVideos.flatMap((video) => video.danmakuSamples || [])).slice(0, 180)
    : [];

  return {
    platform,
    accountId,
    accountName,
    comments,
    danmaku
  };
}

async function collectCommentStyleSamples(input: {
  platform: Platform;
  sourceUrl?: string;
  contexts: SourceContext[];
  generationMode: EngagementGenerationMode;
  signal?: AbortSignal;
}) {
  const contextSamples = uniqueText(input.contexts.flatMap((context) => context.comments));
  if (input.generationMode !== "reference" || !input.sourceUrl) {
    return { samples: contextSamples, error: undefined as string | undefined };
  }

  try {
    const directSamples = input.platform === "douyin"
      ? (await getDouyinVideoCommentsByUrl(input.sourceUrl, { commentLimit: 40, signal: input.signal })).comments
      : (await getBilibiliComments(
          { id: input.sourceUrl, url: input.sourceUrl, raw: input.sourceUrl },
          40,
          { signal: input.signal }
        )).map((comment) => comment.text);
    if (!directSamples.length) {
      return {
        samples: contextSamples,
        error: "当前视频没有取得可用原评，已改用本地平台语料。"
      };
    }
    return { samples: uniqueText([...directSamples, ...contextSamples]), error: undefined };
  } catch (error) {
    throwIfAborted(input.signal);
    return {
      samples: contextSamples,
      error: `当前视频原评读取失败，已改用本地平台语料：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}

function buildCommentSystemPrompt(platform: Platform) {
  if (platform === "bilibili") {
    return `你在模拟真实的 B站视频评论区，不是弹幕，也不是给视频写摘要。每条评论来自不同用户。多数人只抓一个细节随手反应、接梗、与 UP 互动或说一句自己的判断；少数人才会认真补充、纠错、追问或反驳。允许长短评论并存，但不要把普通网友都写成产品经理、评测编辑或课代表。

评论必须对素材有反应，可以使用稳定常识做一步推理；技术质疑必须有明确事实关系，不能把两个同时出现的参数硬凑成因果问题。不能编造新闻、销量、官方结论，也不能伪装自己真实购买、长期使用或亲历了素材没有写的事情。不要照抄真实样本，不要攻击、造谣、色情、歧视或引导刷量。严格按槽位顺序，只输出 JSON 字符串数组。`;
  }
  return `你在模拟真实的抖音评论区，不是在写产品评测或给文案做摘要。每条评论来自不同网友：有人玩梗，有人顺着一个词跳到熟悉场景，有人接话，有人只丢半句，也有人认真追问或泼冷水。评论必须对素材有反应，但不能只是把素材卖点换成口语再说一次。

可以使用稳定、常见的文化常识、平台语感、游戏或日常场景做“一步联想”，也可以用明显夸张和假设制造笑点；不能编造新闻、销量、官方结论，也不能伪装自己真实购买、长期使用或亲历了素材没有写的事情。不要照抄真实样本，不要攻击、造谣、色情、歧视或引导刷量。严格按槽位顺序，只输出 JSON 字符串数组。`;
}

function assertNativeStyleProfile(profile: EngagementStyleProfile, label: string) {
  if (profile.sampleCount > 0) return;
  throw new Error(
    `${label}本地标杆语料为空，已停止使用万能预设生成。请先运行 npm run engagement:refresh-style 刷新标杆库后重试。`
  );
}

function extractEngagementVideoIds(value: string) {
  const text = String(value || "");
  return uniqueText([
    ...(text.match(/BV[0-9A-Za-z]{10}/gi) || []),
    ...(text.match(/(?:video\/|modal_id=)(\d{8,})/gi) || []).map((match) => match.match(/\d{8,}/)?.[0] || "")
  ]);
}

async function generateComments(input: {
  source: EngagementContent;
  contexts: SourceContext[];
  count: number;
  platform: Platform | "unknown";
  sourceUrl?: string;
  generationMode: EngagementGenerationMode;
  excludedComments: string[];
  signal?: AbortSignal;
  onProgress?: GenerateEngagementOptions["onProgress"];
}) {
  if (!ENABLE_MODEL_COMMENT_GENERATION) {
    throw new Error("当前未启用评论模型，已关闭本地兜底。请先配置对话模型后再生成评论。");
  }
  const { source, contexts, count, platform, sourceUrl, generationMode, excludedComments, signal, onProgress } = input;
  if (platform === "unknown") {
    throw new Error("没有识别到评论目标平台。粘贴文案时请选择抖音或 B站。");
  }
  const transportGuard = buildEngagementTransportGuard([source.input, source.title, source.content]);
  const generationSource = sanitizeEngagementSource(source, transportGuard);
  const parsed: string[] = [];
  const entityGuard = buildCommentEntityGuard(generationSource);
  const briefStartedAt = Date.now();
  const sourceBriefResult = await prepareCommentSourceBrief(generationSource, platform, entityGuard, transportGuard, signal);
  const briefMs = Date.now() - briefStartedAt;
  const sourceBrief = sourceBriefResult.brief;
  await onProgress?.({
    stage: generationMode === "reference" ? "research" : "generate",
    message: generationMode === "reference" ? "正在读取当前视频原评与平台语料" : "正在加载平台风格语料",
    progress: generationMode === "reference" ? 34 : 40
  });

  const researchStartedAt = Date.now();
  const reference = await collectCommentStyleSamples({
    platform,
    sourceUrl,
    contexts,
    generationMode,
    signal
  });
  const loadedStyleProfile = await loadEngagementStyleProfile(
    commentStyleChannel(platform),
    reference.samples,
    reference.error,
    buildCommentStyleContext(generationSource, sourceBrief),
    extractEngagementVideoIds(sourceUrl || source.input || "")
  );
  const styleProfile: EngagementStyleProfile = {
    ...loadedStyleProfile,
    examples: uniqueText(
      loadedStyleProfile.examples.map((example) => sanitizeEngagementGenerationText(example))
    ).filter((example) => !containsEngagementTransportLeak(example, transportGuard))
  };
  assertNativeStyleProfile(styleProfile, platform === "bilibili" ? "B站评论" : "抖音评论");
  const blockedComments = uniqueText([...excludedComments, ...reference.samples, ...styleProfile.examples]);
  const researchMs = Date.now() - researchStartedAt;
  const batchResults: {
    index: number;
    requestedCount: number;
    parsedCount: number;
    model: string;
    fallback: boolean;
    fallbackReason?: string;
    status: "completed" | "failed";
    attempts: number;
  }[] = [];
  let usedModel = "model";
  let lastBatchError: unknown;
  let nextBatchIndex = 0;
  let round = 0;
  const modelConcurrency = platform === "bilibili" ? 1 : COMMENT_MODEL_CONCURRENCY;
  const targetLengthBuckets = buildTargetCommentLengthBuckets(count, styleProfile);
  const targetLongCommentCount = targetLengthBuckets.long;
  const targetIntentBuckets = buildTargetCommentIntentBuckets(count, styleProfile, sourceBrief);
  const targetNativeEmoteCount = Math.min(count, Math.round(count * styleProfile.nativeEmoteRate));
  let selected = rebalanceCommentSelection(
    selectCommentSamples(parsed, sourceBrief, entityGuard, transportGuard, styleProfile, count, blockedComments, excludedComments),
    count,
    targetIntentBuckets,
    targetLengthBuckets,
    targetNativeEmoteCount
  );
  const generationStartedAt = Date.now();

  while (
    (selected.items.length < count || hasSevereCommentLengthGap(selected.items, targetLengthBuckets))
    && round < COMMENT_GENERATION_MAX_ROUNDS
  ) {
    throwIfAborted(signal);
    const missingCount = Math.max(count - selected.items.length, 0);
    const requestCount = round === 0
      ? Math.max(missingCount, Math.ceil(count * COMMENT_CANDIDATE_RATIO))
      : Math.max(missingCount + Math.ceil(count * 0.12), Math.ceil(count * 0.28));
    const slots = buildCommentSlots({
      count: requestCount,
      startIndex: nextBatchIndex * COMMENT_GENERATION_BATCH_SIZE,
      sourceBrief,
      styleProfile,
      targetIntentBuckets,
      currentIntentBuckets: summarizeCommentIntentBuckets(selected.items),
      targetLengthBuckets,
      currentLengthBuckets: summarizeCommentLengthBuckets(selected.items),
      targetNativeEmoteCount,
      currentNativeEmoteCount: selected.items.filter(hasNativeEmote).length,
      platform
    });
    const batches = buildCommentGenerationBatches(slots, nextBatchIndex);

    for (let start = 0; start < batches.length; start += modelConcurrency) {
      throwIfAborted(signal);
      const wave = batches.slice(start, start + modelConcurrency);
      const waveResults = await Promise.allSettled(
        wave.map(async (batch) => {
          throwIfAborted(signal);
          let lastError: unknown;
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
              const result = await chatCompleteStrict(
                [
                  {
                    role: "system",
                    content: buildCommentSystemPrompt(platform)
                  },
                  {
                    role: "user",
                    content: buildCommentBatchPrompt({
                      source: generationSource,
                      sourceBrief,
                      entityGuard,
                      styleProfile,
                      platform,
                      slots: batch.slots,
                      usedComments: uniqueText([...excludedComments, ...selected.items]).slice(-60)
                    })
                  }
                ],
                "low",
                {
                  signal,
                  maxOutputTokens: clampCount(batch.slots.length * 72, 1800, 9000, 3600)
                }
              );
              throwIfAborted(signal);
              if (result.fallback || !result.text.trim()) {
                throw new Error(result.fallbackReason || "模型没有返回可用评论，请重试或更换模型。");
              }
              const batchParsed = parseStringArray(result.text)
                .slice(0, batch.slots.length);
              if (!batchParsed.length) {
                throw new Error("模型返回了内容，但没有解析到可用评论，请重试或更换模型。");
              }
              return { batch, batchParsed, result, attempts: attempt };
            } catch (error) {
              throwIfAborted(signal);
              lastError = error;
              if (attempt >= 2 || !isRetryableCommentBatchError(error)) throw error;
              await waitForCommentRetry(5_000, signal);
            }
          }
          throw lastError;
        })
      );

      waveResults.forEach((settled, index) => {
        const batch = wave[index];
        if (settled.status === "fulfilled") {
          const { batchParsed, result, attempts } = settled.value;
          parsed.push(...batchParsed);
          usedModel = result.model || usedModel;
          batchResults.push({
            index: batch.index,
            requestedCount: batch.slots.length,
            parsedCount: settled.value.batchParsed.length,
            model: result.model,
            fallback: false,
            status: "completed",
            attempts
          });
          return;
        }
        lastBatchError = settled.reason;
        batchResults.push({
          index: batch.index,
          requestedCount: batch.slots.length,
          parsedCount: 0,
          model: "",
          fallback: false,
          fallbackReason: settled.reason instanceof Error ? settled.reason.message : "评论批次生成失败",
          status: "failed",
          attempts: 1
        });
      });

      selected = rebalanceCommentSelection(
        selectCommentSamples(parsed, sourceBrief, entityGuard, transportGuard, styleProfile, count, blockedComments, excludedComments),
        count,
        targetIntentBuckets,
        targetLengthBuckets,
        targetNativeEmoteCount
      );
      const preview = selected.items.slice(0, count).map((text, index) =>
        makeCommentItem(text, contexts[index % Math.max(contexts.length, 1)]?.platform || platform, index)
      );
      await onProgress?.({
        stage: "generate",
        message: `首批结果已出，当前保留 ${preview.length}/${count} 条`,
        progress: Math.min(88, 42 + Math.round((preview.length / count) * 44)),
        previewComments: preview
      });
      if (modelConcurrency === 1 && start + modelConcurrency < batches.length) {
        await waitForCommentRetry(250, signal);
      }
    }

    nextBatchIndex += batches.length;
    round += 1;
    selected = rebalanceCommentSelection(
      selectCommentSamples(parsed, sourceBrief, entityGuard, transportGuard, styleProfile, count, blockedComments, excludedComments),
      count,
      targetIntentBuckets,
      targetLengthBuckets,
      targetNativeEmoteCount
    );
  }

  const selection = rebalanceCommentSelection(
    selectCommentSamples(parsed, sourceBrief, entityGuard, transportGuard, styleProfile, count, blockedComments, excludedComments),
    count,
    targetIntentBuckets,
    targetLengthBuckets,
    targetNativeEmoteCount
  );
  const texts = selection.items.slice(0, count);
  if (!texts.length) {
    throw lastBatchError instanceof Error ? lastBatchError : new Error("模型没有返回可用评论，请重试或更换模型。");
  }
  const generationMs = Date.now() - generationStartedAt;
  const outputLengthBuckets = summarizeCommentLengthBuckets(texts.slice(0, count));
  const outputIntentBuckets = summarizeCommentIntentBuckets(texts.slice(0, count));
  await onProgress?.({
    stage: "filter",
    message: texts.length < count ? `已保留 ${texts.length}/${count} 条，系统将继续自动补齐` : `已完成 ${texts.length} 条评论`,
    progress: 94,
    previewComments: texts.map((text, index) =>
      makeCommentItem(text, contexts[index % Math.max(contexts.length, 1)]?.platform || platform, index)
    )
  });
  const diagnostics = {
    sourceBrief: toCommentSourceBriefDiagnostics(sourceBrief),
    entityGuard: toCommentEntityGuardDiagnostics(entityGuard, [
      ...sourceBriefResult.entityCorrections,
      ...selection.entityCorrections
    ]),
    styleProfile: {
      channel: styleProfile.channel as "douyin_comment" | "bilibili_comment",
      source: styleProfile.source,
      sampleCount: styleProfile.sampleCount,
      sourceSampleCount: styleProfile.sourceSampleCount,
      nativeEmoteRate: styleProfile.nativeEmoteRate,
      nativeEmotes: styleProfile.nativeEmotes,
      benchmarkAccounts: styleProfile.benchmarkAccounts,
      benchmarkSampleCount: styleProfile.benchmarkSampleCount,
      matchedVideoCount: styleProfile.matchedVideoCount,
      matchedTopics: styleProfile.matchedTopics,
      matchedContentTypes: styleProfile.matchedContentTypes,
      targetNativeEmoteCount,
      referenceError: styleProfile.referenceError
    },
    generation: {
      mode: "model_batch" as const,
      requestedCount: count,
      batchSize: COMMENT_GENERATION_BATCH_SIZE,
      batchCount: batchResults.length,
      parsedCount: parsed.length,
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
      transportRejectedCount: selection.transportRejectedCount,
      nativeEmoteCount: texts.filter(hasNativeEmote).length,
      targetNativeEmoteCount,
      unsupportedEmoteRejectedCount: selection.unsupportedEmoteRejectedCount,
      batches: batchResults
    }
  };
  return {
    usedModel,
    fallback: false,
    fallbackReason: undefined,
    briefMs,
    researchMs,
    generationMs,
    cacheHits: [
      ...(sourceBriefResult.cacheHit ? ["brief" as const] : [])
    ],
    diagnostics,
    items: texts.slice(0, count).map((text, index) => makeCommentItem(text, contexts[index % Math.max(contexts.length, 1)]?.platform || platform, index))
  };
}

function buildCommentGenerationBatches(slots: CommentSlot[], startIndex = 0) {
  const batches: { index: number; slots: CommentSlot[] }[] = [];
  for (let index = 0; index < slots.length; index += COMMENT_GENERATION_BATCH_SIZE) {
    batches.push({
      index: startIndex + batches.length,
      slots: slots.slice(index, index + COMMENT_GENERATION_BATCH_SIZE)
    });
  }
  return batches;
}

type CommentLength = "short" | "medium" | "long";
type CommentLengthBuckets = Record<CommentLength, number>;
type CommentCreativeLane = "meme" | "association" | "inside" | "supplement" | "reply" | "micro" | "counterpoint" | "question" | "reaction";
type CommentSlot = {
  index: number;
  intent: CommentIntent;
  length: CommentLength;
  lane: CommentCreativeLane;
  anchor?: string;
  emote: "none" | "optional";
  allowedEmotes: string[];
};

function buildCommentSlots(input: {
  count: number;
  startIndex: number;
  sourceBrief: CommentSourceBrief;
  styleProfile: EngagementStyleProfile;
  targetIntentBuckets: CommentIntentBuckets;
  currentIntentBuckets: CommentIntentBuckets;
  targetLengthBuckets: CommentLengthBuckets;
  currentLengthBuckets: CommentLengthBuckets;
  targetNativeEmoteCount: number;
  currentNativeEmoteCount: number;
  platform: Platform;
}) {
  const intentOrder: CommentIntent[] = ["reaction", "question", "skeptical", "experience", "comparison", "follow", "chatter", "price"];
  const intents = buildDeficitSequence(
    input.count,
    intentOrder,
    input.targetIntentBuckets,
    input.currentIntentBuckets,
    ["reaction", "question", "skeptical", "experience", "chatter"]
  );
  const lengthOrder: CommentLength[] = ["short", "medium", "short", "long", "medium"];
  const lengths = buildDeficitSequence(
    input.count,
    lengthOrder,
    input.targetLengthBuckets,
    input.currentLengthBuckets,
    ["short", "medium", "short", "long"]
  );
  const neededEmotes = Math.min(
    input.count,
    Math.max(input.targetNativeEmoteCount - input.currentNativeEmoteCount, 0)
  );
  const emotePositions = new Set(spreadPositions(input.count, neededEmotes));
  const anchors = buildCommentAnchorTerms(input.sourceBrief);
  const anchorPositions = new Set(spreadPositions(
    input.count,
    Math.min(input.count, Math.round(input.count * COMMENT_EXPLICIT_ANCHOR_RATE))
  ));
  const lanes = buildCommentCreativeLaneSequence(input.count, input.startIndex, input.platform);

  return Array.from({ length: input.count }, (_, offset): CommentSlot => {
    const intent = intents[offset] || "reaction";
    const lane = lanes[offset] || "reaction";
    const anchor = lane !== "micro" && anchorPositions.has(offset) && anchors.length
      ? anchors[(input.startIndex + offset * 5) % anchors.length]
      : undefined;
    return {
      index: input.startIndex + offset + 1,
      intent,
      length: lane === "micro" ? "short" : lengths[offset] || "medium",
      lane,
      anchor,
      emote: emotePositions.has(offset) && input.styleProfile.nativeEmotes.length ? "optional" : "none",
      allowedEmotes: input.styleProfile.nativeEmotes
    };
  });
}

function buildCommentCreativeLaneSequence(count: number, startIndex: number, platform: Platform) {
  const cycle: CommentCreativeLane[] = platform === "bilibili"
    ? ["reaction", "inside", "micro", "supplement", "reply", "meme", "question", "reaction", "counterpoint", "inside", "micro", "association"]
    : ["meme", "association", "micro", "inside", "reply", "meme", "association", "micro", "counterpoint", "question"];
  return Array.from({ length: count }, (_, index) => cycle[(startIndex + index) % cycle.length]);
}

function buildDeficitSequence<K extends string>(
  count: number,
  order: K[],
  target: Record<K, number>,
  current: Record<K, number>,
  fallback: K[]
) {
  const remaining = Object.fromEntries(
    [...new Set(order)].map((key) => [key, Math.max((target[key] || 0) - (current[key] || 0), 0)])
  ) as Record<K, number>;
  const output: K[] = [];
  while (output.length < count && Object.values(remaining).some((value) => Number(value) > 0)) {
    for (const key of order) {
      if (output.length >= count) break;
      if ((remaining[key] || 0) <= 0) continue;
      output.push(key);
      remaining[key] -= 1;
    }
  }
  while (output.length < count) {
    output.push(fallback[output.length % fallback.length]);
  }
  return output;
}

function spreadPositions(count: number, selectedCount: number) {
  if (!count || !selectedCount) return [];
  return Array.from({ length: selectedCount }, (_, index) =>
    Math.min(count - 1, Math.floor(((index + 0.5) * count) / selectedCount))
  );
}

function formatCommentSlot(slot: CommentSlot) {
  const length = slot.length === "short"
    ? "2—12 个字的短句/半句"
    : slot.length === "medium"
      ? "13—35 个字"
      : "36—70 个字，可以有两个口语分句，但不要写成小作文";
  const anchor = slot.anchor
    ? `素材锚点：${slot.anchor}（取其中 1—2 个具体名词造梗，不要把长句整段抄进评论；型号保持原写法）`
    : "隐式接话：不要复述标题、产品名或日期，像已经看过视频后直接开口";
  const emote = slot.emote === "optional"
    ? `语气合适时可用一个平台表情，只能从 ${slot.allowedEmotes.join(" ")} 中选；不合适就不用`
    : "不用 emoji 或方括号表情";
  return `${slot.index}. 意图：${formatCommentIntent(slot.intent)}｜创意方式：${formatCommentCreativeLane(slot.lane)}｜${length}｜${anchor}｜${emote}`;
}

function formatCommentIntent(intent: CommentIntent) {
  const labels: Record<CommentIntent, string> = {
    reaction: "普通反应，不强行总结",
    question: "只追问一个具体问题",
    price: "只聊价格、优惠或值不值",
    comparison: "轻对比、纠结怎么选或只点一个差异",
    skeptical: "保留意见、泼冷水或指出一个门槛",
    experience: "只说个人偏好或使用门槛，不编亲历",
    follow: "插眼、蹲后续或求实测",
    chatter: "圈内闲聊或轻度跑题，但仍能接上素材"
  };
  return labels[intent];
}

function formatCommentCreativeLane(lane: CommentCreativeLane) {
  const labels: Record<CommentCreativeLane, string> = {
    meme: "玩梗：抓反差、身份错位、夸张后果或一句可传播的包袱",
    association: "联想：从素材跳一步联想到熟悉场景、圈层文化或另一种身份，但别编新闻",
    inside: "素材内梗：拿两个素材名词重新组合、接话或反转，不复述卖点",
    supplement: "补充讨论：补一个条件、边界、因果、常识或核验点；只展开一个中心，不冒充亲历",
    reply: "接话：像回复评论区某人，单独看也能懂，不用‘你这么一说’",
    micro: "短碎片：2—10 个字，一个槽点、称呼、半句话或冷幽默",
    counterpoint: "反向吐槽：泼一点冷水、拆一句话或指出荒诞处，不写评测总结",
    question: "真问题：只问一个观众确实会追问的点，不先总结",
    reaction: "自然反应：脱口而出，允许不完整，不写工整结论"
  };
  return labels[lane];
}

function formatStyleExamples(examples: string[]) {
  return examples.length
    ? examples.slice(0, 18).map((example) => `- ${example}`).join("\n")
    : "暂无本地真实样本，只按平台预设分布生成。";
}

function formatCommentCreativePalette(firstSlotIndex: number, platform: Platform) {
  const batchIndex = Math.floor(Math.max(firstSlotIndex - 1, 0) / COMMENT_GENERATION_BATCH_SIZE);
  const palettes = platform === "bilibili" ? [
    "优先写第一层自然反应、UP互动和具体小梗；认真分析最多两条，别一上来就集体做风险评审。",
    "优先用具体名词做短梗、圈内接话和一步联想；不要照搬抖音热评，也不要解释包袱。",
    "放少量真问题、对比或反向观点；问题必须来自素材尚未回答的空白，不能把两个无关参数硬连起来。",
    "优先写轻纠错、个人判断和短反应；补充只讲一个有依据的边界，不要写成百科或产品分析。"
  ] : [
    "优先挖身份和职业错位、人物关系、谁比谁更认真；少用‘副本、任务、攻略、现实版’作落点。",
    "优先做具体名词碰撞、词义双关、尺寸/位置/动作变化；少写‘像把 X 搬到 Y’和泛泛的‘开始研究’。",
    "优先联想明显是假设的后续场面、旁观者反应和荒诞后果；不要靠‘抽卡、皮肤、坐骑’三个万能词撑满本批。",
    "优先写回怼、泼冷水、真问题、尴尬点和短碎片；问题不能只是把参数名后面加‘吗’。"
  ];
  return palettes[batchIndex % palettes.length];
}

function formatCommentMixRule(platform: Platform) {
  return platform === "bilibili"
    ? "整批至少四成是自然反应、短梗、UP互动或圈内接话，约两成是 2—12 字的短评论；补充/考据/条件边界与具体追问/反向观点合计不超过三成。评论不是弹幕，稍长评论也只讲一个中心。"
    : "整批至少四成是玩梗或一步联想，约两成是 2—12 字的短反应/碎片，约一成半把素材里的两个细节重新组合；其余再放真实追问、反向吐槽、补充和围观。";
}

function buildCommentBatchPrompt(input: {
  source: EngagementContent;
  sourceBrief: CommentSourceBrief;
  entityGuard: CommentEntityGuard;
  styleProfile: EngagementStyleProfile;
  platform: Platform;
  slots: CommentSlot[];
  usedComments: string[];
}) {
  return `文案标题：${input.source.title}

目标渠道：${input.platform === "bilibili" ? "B站评论" : "抖音评论"}

评论锚点地图：
${formatCommentSourceBrief(input.sourceBrief)}

型号一致性约束：
${formatCommentEntityGuard(input.entityGuard)}

平台真实风格画像：
${formatEngagementStyleProfile(input.styleProfile)}

真实样本（学习它们如何省略、歪楼、接梗和突然联想；严禁照抄原句或带入样本里的事实）：
${formatStyleExamples(input.styleProfile.examples)}

本次已经生成/历史已有的评论（这些观点、梗、问法和句式都已经用过，不能改几个字再写一遍）：
${input.usedComments.length ? input.usedComments.map((comment) => `- ${comment}`).join("\n") : "暂无"}

原始文案节选（只用于核对，不要逐句复读）：
${clampText(input.source.content, 2600)}

本批创意侧重点：
${formatCommentCreativePalette(input.slots[0]?.index || 1, input.platform)}

先在心里从素材找 8—15 个“可玩钩子”，不要输出这一步：反差、身份错位、名词碰撞、谐音/句式、夸张后果、人物关系、观众下一步动作。再把钩子改造成网友会发的评论。

“改造成评论”指的是：
- 事实是“售货员要学角色设定”，不要写“培训很认真”，可以写成“销售岗笔试加考角色理解”。
- 事实是“玩家开始研究续航”，不要写“跨度很大”，可以写成“配队表旁边新增电量表”。
这两句只说明转换方法，不能当成本批答案照搬；如果当前素材没有对应事实，更不能硬套。

请严格按下面每个槽位各写一条，并按槽位顺序输出 ${input.slots.length} 个 JSON 字符串：
${input.slots.map(formatCommentSlot).join("\n")}

要求：
1. ${formatCommentMixRule(input.platform)}不要写出分类标签，也不要机械轮流报数。
2. 每条像不同网友看完后随手发的。允许突然、没头没尾、轻微歪楼、口语不完整和冷幽默；笑点优先来自具体细节，不靠“哈哈哈”“笑死”硬撑。
3. 只有标了“显式锚点”的槽位才要自然落到该细节；“隐式接话”不要复读标题、产品名、活动日期或完整卖点。联想可以跳一步，但不要连续解释为什么好笑。
4. 不要全夸，也不要每条都先夸再转折；禁用流水线开场“第一反应、你这么一说、本来以为、热闹归热闹、我先观望、好家伙、这下真”；少用“确实、感觉、适合、定位、配置、我这种、对我来说”。
5. 禁止把卖点换个口语说法、写工整总结或概括“信息量/画面感/产品力/需求场景/适合人群”；一句能删掉前半句仍成立时，优先删掉。
6. 允许明显是假设、夸张或梗的生活场景联想；但不能声称自己或朋友已经购买、长期使用、回购、每天在用，不能把虚构经历写成证词。
7. 英文数字型号只能使用“型号一致性约束”里的写法，不自行添加 Pro、Max、V2 等后缀。
8. 槽位要求“无表情”时不能加 emoji 或方括号表情；“可用一个表情”时最多用一个，而且不必强行使用。
9. 回复感要直接接内容，不要统一用“你这么一说”；不要让本批评论互相依赖，也不要生成真实用户名或虚构 @ 对象。
10. 输入链接、域名、短链码、视频 ID 和“复制链接打开平台”等分享信息只是运输元数据，绝不能出现在评论里。
11. 同一个事实、同一种包袱、同一个担忧或同一联想落点在本批最多使用一次；换几个字仍算重复，围绕同一风险的近义担忧也只能占一个槽位。
12. 技术问题必须是素材没有回答、普通观众确实会问的问题。禁止因为两个参数同时出现就臆造“参数 A 是否影响功能 B”之类的关系；也不要重新质疑素材已经明确解释的基本功能。`;
}

async function generateDanmaku(
  source: EngagementContent,
  contexts: SourceContext[],
  count: number,
  excludedDanmaku: string[] = [],
  signal?: AbortSignal
) {
  throwIfAborted(signal);
  const transportGuard = buildEngagementTransportGuard([source.input, source.title, source.content]);
  const generationSource = sanitizeEngagementSource(source, transportGuard);
  const contextSamples = uniqueText(contexts.flatMap((context) => context.danmaku));
  const loadedStyleProfile = await loadEngagementStyleProfile(
    "bilibili_danmaku",
    contextSamples,
    undefined,
    `${generationSource.title}\n${generationSource.content}`,
    extractEngagementVideoIds(source.input || "")
  );
  const styleProfile: EngagementStyleProfile = {
    ...loadedStyleProfile,
    examples: uniqueText(
      loadedStyleProfile.examples.map((example) => sanitizeEngagementGenerationText(example))
    ).filter((example) => !containsEngagementTransportLeak(example, transportGuard))
  };
  assertNativeStyleProfile(styleProfile, "B站弹幕");
  const timeline = buildDanmakuTimeline(generationSource, count, styleProfile);
  const batches = chunkValues(timeline.slots, DANMAKU_GENERATION_BATCH_SIZE);
  const parsedItems: Array<{ slot: DanmakuSlot; text: string }> = [];
  const acceptedTextsBySlot = new Map<number, string>();
  const failures: string[] = [];
  const batchResults: NonNullable<NonNullable<NonNullable<Draft["assets"]>["danmaku"]>["diagnostics"]>["batches"] = [];
  let usedModel = "model";

  for (let start = 0; start < batches.length; start += DANMAKU_MODEL_CONCURRENCY) {
    throwIfAborted(signal);
    const wave = batches.slice(start, start + DANMAKU_MODEL_CONCURRENCY);
    const settled = await Promise.allSettled(wave.map(async (slots, waveIndex) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const result = await chatCompleteStrict(
            [
              {
                role: "system",
                content:
                  "你在模拟一群互不认识的 B站观众。严格按给定时间槽和台词锚点各写一条即时弹幕，只负责写文本，不得自己编时间。弹幕是看见当下画面脱口而出的短反应，不是视频评论、测评总结或台词改写。只有明确标记的复读槽才能复读；其他槽位不得重复已经用过的句子。不要攻击、造谣、色情、歧视或刷屏。只输出与槽位等长、顺序一致的 JSON 字符串数组。"
              },
              {
                role: "user",
                content: buildDanmakuBatchPrompt(
                  generationSource,
                  styleProfile,
                  slots,
                  uniqueText([...excludedDanmaku, ...parsedItems.map((item) => item.text)]).slice(-80)
                )
              }
            ],
            "none",
            { signal, maxOutputTokens: clampCount(slots.length * 52, 1000, 3600, 2400) }
          );
          throwIfAborted(signal);
          if (result.fallback || !result.text.trim()) {
            throw new Error(result.fallbackReason || "模型没有返回可用弹幕，请重试或更换模型。");
          }
          const texts = parseStringArray(result.text).slice(0, slots.length);
          if (!texts.length) {
            throw new Error("模型返回了内容，但没有解析到可用弹幕。");
          }
          return { result, slots, texts, attempts: attempt, batchIndex: start + waveIndex };
        } catch (error) {
          throwIfAborted(signal);
          lastError = error;
          if (attempt >= 2 || !isRetryableCommentBatchError(error)) throw error;
          await waitForCommentRetry(5_000, signal);
        }
      }
      throw lastError;
    }));

    settled.forEach((item, waveIndex) => {
      if (item.status === "rejected") {
        const error = item.reason instanceof Error ? item.reason.message : "弹幕批次生成失败";
        failures.push(error);
        const slots = wave[waveIndex] || [];
        batchResults.push({
          index: start + waveIndex,
          requestedCount: slots.length,
          parsedCount: 0,
          model: "",
          status: "failed",
          attempts: 2,
          error
        });
        return;
      }
      usedModel = item.value.result.model || usedModel;
      batchResults.push({
        index: item.value.batchIndex,
        requestedCount: item.value.slots.length,
        parsedCount: item.value.texts.length,
        model: item.value.result.model,
        status: "completed",
        attempts: item.value.attempts
      });
      item.value.texts.slice(0, item.value.slots.length).forEach((text, index) => {
        const slot = item.value.slots[index];
        const generated = String(text || "").replace(/\s+/g, " ").trim();
        const normalized = slot.echoOfIndex
          ? acceptedTextsBySlot.get(slot.echoOfIndex) || generated
          : generated;
        if (!normalized || Array.from(normalized).length > 42) return;
        if (containsEngagementTransportLeak(normalized, transportGuard)) return;
        if (findUnsupportedNativeEmotes(normalized, styleProfile).length) return;
        if (slot.emote === "none" && hasNativeEmote(normalized)) return;
        if (slot.emote === "one" && !hasNativeEmote(normalized)) return;
        acceptedTextsBySlot.set(slot.index, normalized);
        parsedItems.push({ slot, text: normalized });
      });
    });
  }

  const selection = selectDanmakuItems(parsedItems, excludedDanmaku);
  const selectedItems = selection.items.slice(0, count);
  if (!selectedItems.length) {
    throw new Error(failures[0] || "模型返回了内容，但没有解析到可用弹幕，请重试或更换模型。");
  }
  return {
    usedModel,
    fallback: failures.length > 0,
    fallbackReason: failures.length ? `部分弹幕批次失败，已保留 ${selectedItems.length}/${count} 条：${uniqueText(failures).join("；")}` : undefined,
    timingBasis: timeline.timingBasis,
    durationSec: timeline.durationSec,
    styleSampleCount: styleProfile.sampleCount,
    styleVideoCount: styleProfile.matchedVideoCount,
    styleTopics: styleProfile.matchedTopics,
    sameSecondRate: styleProfile.danmakuRhythm?.sameSecondRate,
    repeatRate: styleProfile.danmakuRhythm?.repeatRate,
    burstShare: styleProfile.danmakuRhythm?.burstShare,
    diagnostics: {
      batchSize: DANMAKU_GENERATION_BATCH_SIZE,
      batchCount: batchResults.length,
      parsedCount: parsedItems.length,
      completedCount: selectedItems.length,
      rejectedCount: selection.rejectedCount,
      batches: batchResults.sort((left, right) => left.index - right.index)
    },
    items: selectedItems.map((item, index) => ({
      id: `danmaku-${index + 1}-${shortHash(`${item.slot.timeSec}-${item.text}`)}`,
      timeSec: item.slot.timeSec,
      text: item.text
    }))
  };
}

type DanmakuSlot = {
  index: number;
  timeSec: number;
  anchor: string;
  emote: "none" | "one";
  clusterId: number;
  echoOfIndex?: number;
  voice: DanmakuVoice;
};

type DanmakuVoice = "reaction" | "punchline" | "question" | "detail" | "counterpoint" | "association" | "echo";

function buildDanmakuTimeline(source: EngagementContent, count: number, styleProfile: EngagementStyleProfile) {
  const sourceSegments = (source.segments || [])
    .map((segment) => ({
      startSec: Math.max(0, segment.startSec),
      endSec: Math.max(segment.startSec, segment.endSec),
      text: segment.text.replace(/\s+/g, " ").trim()
    }))
    .filter((segment) => segment.text && segment.endSec >= segment.startSec);
  const timingBasis = sourceSegments.length ? "source_segments" as const : "estimated_text" as const;
  const segments = sourceSegments.length ? sourceSegments : buildEstimatedTranscriptSegments(source.content);
  const durationSec = Math.max(
    1,
    Math.round(source.durationSec || segments.at(-1)?.endSec || estimateSpokenDurationSec(source.content))
  );
  const rhythm = styleProfile.danmakuRhythm;
  const desiredCenterCount = Math.max(
    4,
    Math.min(segments.length, Math.round(durationSec / 14), Math.max(4, Math.round(count / 4.8)))
  );
  const centers = selectDanmakuBurstCenters(segments, durationSec, desiredCenterCount, rhythm?.densityByPosition || []);
  const allocations = allocateDanmakuClusterCounts(centers, count);
  const rawSlots: Array<Omit<DanmakuSlot, "index" | "emote" | "echoOfIndex" | "voice">> = [];
  centers.forEach((center, centerIndex) => {
    const clusterCount = allocations[centerIndex] || 0;
    for (let offsetIndex = 0; offsetIndex < clusterCount; offsetIndex += 1) {
      const timeSec = Math.max(
        0,
        Math.min(durationSec, Math.round(center.timeSec + danmakuClusterOffset(offsetIndex)))
      );
      rawSlots.push({
        timeSec,
        anchor: clampText(center.segment.text || source.content, 54),
        clusterId: centerIndex + 1
      });
    }
  });
  rawSlots.sort((left, right) => left.timeSec - right.timeSec || left.clusterId - right.clusterId);

  const repeatRate = clampRate(rhythm?.repeatRate ?? 0.08, 0, 0.16, 0.08);
  const repeatTarget = Math.min(Math.round(count * repeatRate), Math.max(count - centers.length, 0));
  const repeatPositions = selectDanmakuRepeatPositions(rawSlots, repeatTarget);
  const emoteTarget = Math.min(count, Math.round(count * styleProfile.nativeEmoteRate));
  const emotePositions = new Set(spreadPositions(count, emoteTarget));
  const slots = rawSlots.slice(0, count).map((slot, index): DanmakuSlot => {
    const previous = index > 0 ? rawSlots[index - 1] : undefined;
    const canEcho = repeatPositions.has(index) && previous?.clusterId === slot.clusterId;
    const previousEmote = canEcho && emotePositions.has(index - 1);
    const wantsEmote = canEcho ? previousEmote : emotePositions.has(index);
    return {
      ...slot,
      index: index + 1,
      echoOfIndex: canEcho ? index : undefined,
      voice: canEcho ? "echo" : danmakuVoiceForSlot(index, slot.clusterId),
      emote: wantsEmote && styleProfile.nativeEmotes.length ? "one" : "none"
    };
  });
  return { timingBasis, durationSec, slots };
}

function danmakuVoiceForSlot(index: number, clusterId: number): DanmakuVoice {
  const cycle: Exclude<DanmakuVoice, "echo">[] = [
    "reaction", "punchline", "detail", "question", "association", "counterpoint"
  ];
  return cycle[(index + clusterId * 2) % cycle.length];
}

type DanmakuBurstCenter = {
  segment: { startSec: number; endSec: number; text: string };
  timeSec: number;
  score: number;
};

function selectDanmakuBurstCenters(
  segments: Array<{ startSec: number; endSec: number; text: string }>,
  durationSec: number,
  count: number,
  densityByPosition: number[]
) {
  const candidates = segments.map((segment, index): DanmakuBurstCenter => {
    const timeSec = Math.min(durationSec, Math.max(0, (segment.startSec + segment.endSec) / 2));
    const position = timeSec / Math.max(durationSec, 1);
    const densityIndex = Math.min(
      Math.max(densityByPosition.length - 1, 0),
      Math.floor(position * Math.max(densityByPosition.length, 1))
    );
    const learnedDensity = densityByPosition[densityIndex] || 1 / Math.max(densityByPosition.length, 1);
    const text = segment.text;
    const signal = (/[?？！!]/.test(text) ? 1.2 : 0)
      + (/但是|不过|结果|没想到|居然|直接|重点|问题|缺点|价格|元|最后|真正|核心|实测|对比/.test(text) ? 1.8 : 0)
      + (/\d/.test(text) ? 0.6 : 0)
      + (index === 0 || index === segments.length - 1 ? 0.7 : 0);
    return { segment, timeSec, score: 1 + signal + learnedDensity * 20 };
  });
  const minSpacing = Math.max(1.5, durationSec / Math.max(count * 2.4, 1));
  const selected: DanmakuBurstCenter[] = [];
  for (const candidate of candidates.slice().sort((left, right) => right.score - left.score)) {
    if (selected.some((item) => Math.abs(item.timeSec - candidate.timeSec) < minSpacing)) continue;
    selected.push(candidate);
    if (selected.length >= count) break;
  }
  if (selected.length < count) {
    for (let index = 0; index < count && selected.length < count; index += 1) {
      const targetSec = ((index + 0.5) / count) * durationSec;
      const candidate = candidates
        .filter((item) => !selected.includes(item))
        .sort((left, right) => Math.abs(left.timeSec - targetSec) - Math.abs(right.timeSec - targetSec))[0];
      if (candidate) selected.push(candidate);
    }
  }
  return selected.sort((left, right) => left.timeSec - right.timeSec);
}

function allocateDanmakuClusterCounts(centers: DanmakuBurstCenter[], count: number) {
  if (!centers.length) return [];
  const allocations = centers.map(() => 1);
  const cap = Math.max(2, Math.ceil((count / centers.length) * 1.9));
  let remaining = Math.max(count - centers.length, 0);
  while (remaining > 0) {
    let selectedIndex = 0;
    let selectedScore = -Infinity;
    centers.forEach((center, index) => {
      if (allocations[index] >= cap) return;
      const score = center.score / Math.pow(allocations[index] + 0.35, 0.82);
      if (score > selectedScore) {
        selectedIndex = index;
        selectedScore = score;
      }
    });
    allocations[selectedIndex] += 1;
    remaining -= 1;
  }
  return allocations;
}

function danmakuClusterOffset(index: number) {
  const pattern = [0, 0, 1, -1, 1, 2, -2, 0, 3, -3, 2, -1, 4, -4];
  const cycle = Math.floor(index / pattern.length);
  const offset = pattern[index % pattern.length];
  return offset === 0 ? 0 : offset + Math.sign(offset) * cycle * 2;
}

function selectDanmakuRepeatPositions(
  slots: Array<{ clusterId: number }>,
  targetCount: number
) {
  const candidates = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => index > 0 && slots[index - 1]?.clusterId === slot.clusterId)
    .map(({ index }) => index);
  if (!targetCount || !candidates.length) return new Set<number>();
  const positions = spreadPositions(candidates.length, Math.min(targetCount, candidates.length))
    .map((index) => candidates[index])
    .filter((index): index is number => typeof index === "number");
  return new Set(positions);
}

function selectDanmakuItems(
  items: Array<{ slot: DanmakuSlot; text: string }>,
  excludedValues: string[]
) {
  const excluded = excludedValues.map((value) => value.trim()).filter(Boolean);
  const selected: Array<{ slot: DanmakuSlot; text: string }> = [];
  const selectedBySlot = new Map<number, { slot: DanmakuSlot; text: string }>();
  const counts = new Map<string, number>();
  const templateCounts = new Map<string, number>();
  excluded.forEach((text) => {
    const key = commentFingerprint(text);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  let rejectedCount = 0;
  for (const item of items) {
    const source = item.slot.echoOfIndex ? selectedBySlot.get(item.slot.echoOfIndex) : undefined;
    const text = source?.text || item.text;
    const key = commentFingerprint(text);
    const existingCount = counts.get(key) || 0;
    if (!key) {
      rejectedCount += 1;
      continue;
    }
    if (item.slot.echoOfIndex) {
      if (!source || existingCount >= 3) {
        rejectedCount += 1;
        continue;
      }
    } else if (
      existingCount > 0
      || isNearDuplicateDanmaku(text, [...excluded, ...selected.map((entry) => entry.text)])
    ) {
      rejectedCount += 1;
      continue;
    }
    const template = danmakuTemplateFingerprint(text);
    const templateCount = template ? templateCounts.get(template) || 0 : 0;
    if (template && templateCount >= 2) {
      rejectedCount += 1;
      continue;
    }
    const next = { slot: item.slot, text };
    selected.push(next);
    selectedBySlot.set(item.slot.index, next);
    counts.set(key, existingCount + 1);
    if (template) templateCounts.set(template, templateCount + 1);
  }
  return { items: selected, rejectedCount };
}

function isNearDuplicateDanmaku(value: string, existing: string[]) {
  const normalized = normalizeCommentKey(value);
  if (normalized.length < 8) return false;
  return existing.some((item) => {
    const other = normalizeCommentKey(item);
    if (other.length < 8) return false;
    if (normalized.includes(other) || other.includes(normalized)) {
      return Math.min(normalized.length, other.length) / Math.max(normalized.length, other.length) >= 0.7;
    }
    const distance = levenshteinDistance(normalized, other);
    return distance <= 2 && Math.max(normalized.length, other.length) <= 18;
  });
}

function danmakuTemplateFingerprint(value: string) {
  if (/^(?:重点|核心|关键|正片).{0,4}(?:来了|开始|登场)/.test(value)) return "transition";
  if (/(?:下期见|拜拜|结束了|走了走了|散了散了)/.test(value)) return "ending";
  if (/(?:钱包|价格).{0,6}(?:报警|顶不住|劝退)/.test(value)) return "price-alarm";
  return "";
}

function buildEstimatedTranscriptSegments(content: string) {
  const sentences = content
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const values = sentences.length ? sentences : [content.trim() || "正文内容"];
  const durationSec = estimateSpokenDurationSec(content);
  const totalChars = values.reduce((sum, value) => sum + Math.max(Array.from(value).length, 1), 0);
  let cursor = 0;
  return values.map((text) => {
    const segmentDuration = (Math.max(Array.from(text).length, 1) / totalChars) * durationSec;
    const startSec = cursor;
    cursor += segmentDuration;
    return { startSec, endSec: cursor, text };
  });
}

function estimateSpokenDurationSec(content: string) {
  const readableChars = Array.from(content.replace(/\s+/g, "")).length;
  return Math.max(15, Math.min(900, readableChars / 4.2));
}

function buildDanmakuBatchPrompt(
  source: EngagementContent,
  styleProfile: EngagementStyleProfile,
  slots: DanmakuSlot[],
  usedDanmaku: string[]
) {
  return `B站弹幕真实风格画像：
${formatEngagementStyleProfile(styleProfile)}

真实弹幕样本（只学长度、断句和即时反应，严禁照抄）：
${formatStyleExamples(styleProfile.examples)}

正文节选：
${clampText(source.content, 2600)}

本次已经出现过的弹幕（除明确复读槽外，不能重复或只改一两个字）：
${usedDanmaku.length ? usedDanmaku.map((text) => `- ${text}`).join("\n") : "暂无"}

请按顺序为每个时间槽写一条弹幕，只输出 ${slots.length} 个 JSON 字符串：
${slots.map((slot) => `${slot.index}. ${slot.timeSec}s｜当下内容：${slot.anchor}｜${formatDanmakuVoice(slot.voice)}｜${slot.emote === "one" ? `使用一个允许表情：${styleProfile.nativeEmotes.join(" ")}` : "不用 emoji 或方括号表情"}`).join("\n")}

要求：
1. 每条只回应当前时间槽，不预告后文，不复述完整台词，不总结整段视频。
2. 同一个爆点的一簇弹幕要像不同观众：有人惊讶、有人抓细节、有人问一句、有人泼冷水；不要连续换词复述同一结论。
3. 除明确标记的复读槽外，同一句和近似句只能出现一次；“重点来了、核心来了、开始了”一类转场废话整批最多两条。
4. 输入链接、域名、短链码和视频 ID 不属于画面内容，绝不能写进弹幕。`;
}

function formatDanmakuVoice(voice: DanmakuVoice) {
  const labels: Record<DanmakuVoice, string> = {
    reaction: "即时反应：短、直接，不复述台词",
    punchline: "短梗：抓当前名词或反差落一个包袱",
    question: "即时疑问：只问这一刻自然冒出的一个问题",
    detail: "抓细节：点出当前一个具体信息，不写完整评测句",
    counterpoint: "泼冷水：指出当前说法的一个限制或槽点",
    association: "一步联想：联想到熟悉的梗或场景，不连续解释",
    echo: "设计复读：复读紧邻上一条弹幕，必须完全相同，不新增观点"
  };
  return labels[voice];
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("任务已停止");
  }
}

function isRetryableCommentBatchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /限流|rate limit|429|暂时异常|暂时不可用|连接异常|网络|超时|timeout|5\d\d|没有解析到可用评论/i.test(message);
}

async function waitForCommentRetry(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("任务已停止"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function prepareCommentSourceBrief(
  source: EngagementContent,
  platform: Platform | "unknown",
  entityGuard: CommentEntityGuard,
  transportGuard: EngagementTransportGuard,
  signal?: AbortSignal
): Promise<{ brief: CommentSourceBrief; entityCorrections: CommentEntityCorrection[]; cacheHit: boolean }> {
  throwIfAborted(signal);
  const cacheKey = shortHash(
    `${ENGAGEMENT_BRIEF_CACHE_VERSION}:brief:${platform}:${source.title}:${source.content}`
  );
  const cached = await readEngagementCache<{
    engineVersion: string;
    brief: CommentSourceBrief;
  }>("brief", cacheKey);
  if (cached?.engineVersion === ENGAGEMENT_BRIEF_CACHE_VERSION && cached.brief?.summary) {
    return { brief: cached.brief, entityCorrections: [], cacheHit: true };
  }

  const localResult = buildLocalCommentSourceBrief(source, entityGuard, transportGuard);
  const result = normalizeCommentSourceBriefEntities(localResult.brief, entityGuard);

  await writeEngagementCache("brief", cacheKey, {
    engineVersion: ENGAGEMENT_BRIEF_CACHE_VERSION,
    cachedAt: nowIso(),
    brief: result.brief
  });
  return { ...result, cacheHit: false };
}

function buildLocalCommentSourceBrief(
  source: EngagementContent,
  entityGuard: CommentEntityGuard,
  transportGuard: EngagementTransportGuard
): { brief: CommentSourceBrief; entityCorrections: CommentEntityCorrection[] } {
  const sourceText = normalizeKnownEngagementTerms(buildCommentBriefSourceText(source));
  const sentences = uniqueText(
    sourceText
      .split(/[\n。！？!?；;]/)
      .map((value) => value.replace(/^[-*#\s]+/, "").trim())
      .filter((value) => value.length >= 4 && value.length <= 120)
  );
  const factual = sentences.filter((value) =>
    /\d|价格|优惠|配置|版本|画面|功能|活动|时间|地图|角色|玩法|体验|缺点|问题|支持|续航|重量|尺寸|帧|元|折/.test(value)
  );
  const skeptical = sentences.filter((value) =>
    /[?？]|担心|怕|但是|不过|问题|缺点|贵|便宜|值不值|会不会|能不能|不一定|观望/.test(value)
  );
  const sceneSentences = sentences.filter((value) =>
    /宿舍|办公室|家里|出门|开会|游戏|日常|通勤|学生|上班|桌面|手机|电脑|晚上|直播|剪辑/.test(value)
  );
  const titleTerms = source.title
    .replace(/[#，。！？、；:：|]/g, " ")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 18);
  const anchorTerms = uniqueText([
    ...entityGuard.allowedModels,
    ...titleTerms,
    ...extractSourceAnchorTerms(source.title),
    ...factual.flatMap(extractSourceAnchorTerms),
    ...sentences.slice(0, 8).flatMap(extractSourceAnchorTerms)
  ]).filter((term) => !containsEngagementTransportLeak(term, transportGuard)).slice(0, 30);
  const subjects = uniqueText([
    ...entityGuard.allowedModels,
    ...titleTerms,
    ...anchorTerms.filter((term) => /[A-Za-z0-9]|游戏|活动|产品|角色|地图|版本/.test(term))
  ]).slice(0, 8);
  const audiencePersonas = inferLocalAudiencePersonas(sourceText);

  return {
    brief: {
      summary: makeEngagementTitle(sentences[0] || source.content, source.title),
      topic: source.title,
      subjects,
      keyFacts: uniqueText([...factual, ...sentences]).slice(0, 12),
      audiencePersonas,
      viewerScenes: uniqueText(sceneSentences).slice(0, 6),
      discussionAngles: uniqueText([...factual, ...skeptical, ...sentences]).slice(0, 10),
      skepticalAngles: uniqueText(skeptical).slice(0, 6),
      mustAvoid: ["素材没有说明的购买或长期使用经历", "素材没有出现的型号后缀、价格、销量或新闻"],
      anchorTerms
    },
    entityCorrections: []
  };
}

function inferLocalAudiencePersonas(sourceText: string) {
  if (/游戏|玩家|版本|地图|角色|团本|竞技|PVE|PVP/i.test(sourceText)) {
    return ["正在玩的玩家", "老玩家", "观望新版本的人", "看热闹的人", "机制和体验党"];
  }
  if (/价格|优惠|配置|型号|续航|参数|键盘|鼠标|耳机|摄像头|手机|电脑/.test(sourceText)) {
    return ["预算党", "参数党", "实际使用党", "对比党", "先观望的人"];
  }
  return ["第一眼路人", "对细节好奇的人", "有类似场景的人", "观望和追问的人"];
}

function buildCommentBriefSourceText(source: EngagementContent) {
  return [
    source.prompt ? `生成提示：\n${source.prompt}` : "",
    source.input && source.input !== source.content ? `原始输入：\n${source.input}` : "",
    `正文：\n${source.content}`
  ].filter(Boolean).join("\n\n---\n\n");
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

function normalizeTextWithEntityGuard(
  value: string,
  entityGuard: CommentEntityGuard,
  stage: CommentEntityCorrection["stage"]
) {
  let text = normalizeKnownEngagementTerms(value);
  const corrections: CommentEntityCorrection[] = [];
  if (entityGuard.allowedModelKeys.has("LHDC50")) {
    const nextText = text.replace(/(^|[^A-Za-z0-9])5\.0\s*高清音频解码/gi, "$1LHDC 5.0 高清音频解码");
    if (nextText !== text) {
      text = nextText;
      corrections.push({ from: "5.0 高清音频解码", to: "LHDC 5.0 高清音频解码", stage });
    }
  }
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
      if (entityGuard.blockedModelKeys.has(key)) return true;
      return !entityGuard.allowedModelKeys.has(key) && !findModelEntityCorrection(term, entityGuard) && isSuspiciousModelVariant(key, entityGuard);
    })
  );
}

function findModelEntityCorrection(term: string, entityGuard: CommentEntityGuard) {
  const key = toModelKey(term);
  if (!key || entityGuard.allowedModelKeys.has(key)) return "";
  const alias = entityGuard.aliases.get(key);
  if (alias) return alias;
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
  const hasNamedSuffix = /^[A-Z][A-Za-z0-9.+-]{2,}\s+(?:SE|AI|PRO|MAX|ULTRA)$/i.test(term.trim());
  if (!hasNamedSuffix && (!/[A-Z]/.test(key) || !/\d/.test(key))) return false;
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
    blockedModels: entityGuard.blockedModels,
    correctedTerms: uniqueEntityCorrections(corrections).slice(0, 40)
  };
}

function formatCommentEntityGuard(entityGuard: CommentEntityGuard) {
  if (!entityGuard.allowedModels.length) {
    return "未识别到需要硬校验的英文数字型号；仍然不要自行编造型号、版本号或后缀。";
  }
  return [
    `可写型号：${entityGuard.allowedModels.join("、")}`,
    entityGuard.blockedModels.length ? `识别冲突、禁止照写：${entityGuard.blockedModels.join("、")}` : "",
    "如果要写英文数字型号，只能从上面选；不要把相近型号、搜索结果里的其他型号或自己猜的后缀写进评论。"
  ].filter(Boolean).join("\n");
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
    formatBriefLines("源内明确事实/槽点", brief.keyFacts),
    formatBriefLines("可接话角度", brief.discussionAngles),
    formatBriefLines("可观望/追问角度", brief.skepticalAngles),
    formatBriefLines("评论锚点词", brief.anchorTerms),
    formatBriefLines("不要写", brief.mustAvoid)
  ].filter(Boolean).join("\n");
}

function buildCommentStyleContext(source: EngagementContent, brief: CommentSourceBrief) {
  return uniqueText([
    source.title,
    brief.summary,
    brief.topic,
    ...brief.subjects,
    ...brief.keyFacts.slice(0, 6)
  ]).join("\n");
}

function formatBriefLines(label: string, values: string[]) {
  return values.length ? `${label}：\n${values.map((value) => `- ${value}`).join("\n")}` : "";
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
    buckets[classifyEngagementCommentIntent(sample)] += 1;
    return buckets;
  }, makeEmptyCommentIntentBuckets());
}

function hasCommentChatterCue(text: string) {
  return /键盘圈|外设圈|数码圈|客制化圈|圈里|圈内|吹水|热榜|热点|风向|卷成|卷到|都在卷|卷麻|铝坨坨|价格战/.test(text)
    || /(最近|这两年|今年|现在).{0,18}(键盘|外设|数码|磁轴|轴体|铝坨坨|客制化|量产).{0,18}(卷|火|热|多|价格|低价|离谱)/.test(text)
    || /(键盘|外设|数码|磁轴|轴体|铝坨坨|客制化|量产).{0,18}(最近|这两年|今年|现在).{0,18}(卷|火|热|多|价格|低价|离谱)/.test(text);
}

function buildTargetCommentIntentBuckets(
  count: number,
  styleProfile: EngagementStyleProfile,
  sourceBrief: CommentSourceBrief
): CommentIntentBuckets {
  const sourceText = [
    sourceBrief.summary,
    sourceBrief.topic,
    ...sourceBrief.keyFacts,
    ...sourceBrief.discussionAngles,
    ...sourceBrief.anchorTerms
  ].join(" ");
  const base = { ...styleProfile.intentBuckets };
  if (!/价格|优惠|券|到手|预算|元|块|贵|便宜|折|618/.test(sourceText)) base.price = 0;
  if (!/对比|相比|区别|差异|还是|二选一|选择|同类|上一代|以前/.test(sourceText)) {
    base.comparison = Math.min(base.comparison, Math.max(1, Math.round(styleProfile.sampleCount * 0.03)));
  }
  const total = Object.values(base).reduce((sum, value) => sum + value, 0) || 1;
  const targets = makeEmptyCommentIntentBuckets();
  for (const key of Object.keys(targets) as CommentIntent[]) {
    targets[key] = Math.round((base[key] / total) * count);
  }
  targets.question = Math.max(targets.question, Math.round(count * 0.08));
  targets.skeptical = Math.max(targets.skeptical, Math.round(count * 0.06));
  targets.experience = Math.max(targets.experience, Math.round(count * 0.06));
  targets.follow = Math.max(targets.follow, count >= 20 ? 1 : 0);
  targets.chatter = Math.max(targets.chatter, count >= 20 ? 1 : 0);
  if (!base.price) targets.price = 0;
  balanceCommentIntentTargets(targets, count);
  return targets;
}

function buildTargetCommentLengthBuckets(count: number, styleProfile: EngagementStyleProfile): CommentLengthBuckets {
  const base = styleProfile.lengthBuckets;
  const total = base.short + base.medium + base.long || 1;
  const targets: CommentLengthBuckets = {
    short: Math.round((base.short / total) * count),
    medium: Math.round((base.medium / total) * count),
    long: Math.round((base.long / total) * count)
  };
  while (targets.short + targets.medium + targets.long > count) {
    const key = (Object.keys(targets) as CommentLength[]).sort((left, right) => targets[right] - targets[left])[0];
    targets[key] = Math.max(0, targets[key] - 1);
  }
  while (targets.short + targets.medium + targets.long < count) targets.medium += 1;
  if (styleProfile.channel === "bilibili_comment") {
    const maxLong = Math.ceil(count * 0.25);
    const minShort = count >= 5 ? Math.max(1, Math.floor(count * 0.2)) : 0;
    if (targets.long > maxLong) {
      targets.medium += targets.long - maxLong;
      targets.long = maxLong;
    }
    while (targets.short < minShort && targets.medium > 0) {
      targets.short += 1;
      targets.medium -= 1;
    }
  }
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

function rebalanceCommentSelection(
  selection: CommentSelectionResult,
  targetCount: number,
  targetIntentBuckets: CommentIntentBuckets,
  targetLengthBuckets: CommentLengthBuckets,
  targetNativeEmoteCount: number
): CommentSelectionResult {
  const pool = selection.items.map((text, index) => ({
    text,
    index,
    intent: classifyEngagementCommentIntent(text),
    length: commentLengthBucket(text),
    hasEmote: hasNativeEmote(text)
  }));
  const output: string[] = [];
  const intentCounts = makeEmptyCommentIntentBuckets();
  const lengthCounts: CommentLengthBuckets = { short: 0, medium: 0, long: 0 };
  let nativeEmoteCount = 0;

  while (output.length < targetCount && pool.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < pool.length; index += 1) {
      const item = pool[index];
      const intentDeficit = targetIntentBuckets[item.intent] - intentCounts[item.intent];
      const lengthDeficit = targetLengthBuckets[item.length] - lengthCounts[item.length];
      const emoteDeficit = targetNativeEmoteCount - nativeEmoteCount;
      const score =
        (intentDeficit > 0 ? 120 + intentDeficit : intentDeficit * 12)
        + (lengthDeficit > 0 ? 36 + lengthDeficit : lengthDeficit * 4)
        + (item.hasEmote ? (emoteDeficit > 0 ? 70 : -20) : emoteDeficit > 0 ? 0 : 8)
        - item.index * 0.001;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [selected] = pool.splice(bestIndex, 1);
    output.push(selected.text);
    intentCounts[selected.intent] += 1;
    lengthCounts[selected.length] += 1;
    if (selected.hasEmote) nativeEmoteCount += 1;
  }

  const arranged = arrangeCommentOrder(output);

  return {
    ...selection,
    items: arranged,
    lengthBuckets: summarizeCommentLengthBuckets(arranged)
  };
}

function arrangeCommentOrder(values: string[]) {
  return values
    .map((text, index) => ({
      text,
      index,
      order: Number.parseInt(shortHash(`comment-order:${text}`).slice(0, 8), 16)
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.text);
}

function commentLengthBucket(value: string): CommentLength {
  const length = Array.from(value).length;
  if (length >= 36) return "long";
  if (length >= 13) return "medium";
  return "short";
}

function hasSevereCommentLengthGap(values: string[], target: CommentLengthBuckets) {
  if (!values.length) return true;
  const actual = summarizeCommentLengthBuckets(values);
  const longFloor = target.long >= 4 ? Math.max(2, Math.ceil(target.long * 0.6)) : 0;
  const mediumFloor = target.medium >= 10 ? Math.max(5, Math.ceil(target.medium * 0.5)) : 0;
  return actual.long < longFloor || actual.medium < mediumFloor;
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
  transportRejectedCount: number;
  unsupportedEmoteRejectedCount: number;
  entityCorrections: CommentEntityCorrection[];
};

function selectCommentSamples(
  values: string[],
  sourceBrief: CommentSourceBrief | undefined,
  entityGuard: CommentEntityGuard,
  transportGuard: EngagementTransportGuard,
  styleProfile: EngagementStyleProfile,
  targetCount: number,
  excludedValues: string[] = [],
  diversityBaseline: string[] = []
): CommentSelectionResult {
  const anchorTerms = sourceBrief ? buildCommentAnchorTerms(sourceBrief) : [];
  const primaryAnchorTerms = sourceBrief ? buildPrimaryCommentAnchorTerms(sourceBrief) : [];
  const excluded = excludedValues.map((value) => value.trim()).filter(Boolean);
  const seen = new Set(excluded.map(commentFingerprint));
  const styleCounts = new Map<string, number>();
  const prefixCounts = new Map<string, number>();
  const anchorCounts = new Map<string, number>();
  const anchorPairCounts = new Map<string, number>();
  const repeatedStyleLimit = clampCount(Math.ceil(targetCount * 0.04), 2, 6, 2);
  const repeatedPrefixLimit = clampCount(Math.ceil(targetCount * 0.025), 2, 4, 2);
  const perAnchorLimit = clampCount(Math.ceil(targetCount * 0.08), 2, 12, 2);
  const explicitAnchorLimit = Math.max(1, Math.round(targetCount * 0.42));
  const leadingAnchorLimit = Math.max(1, Math.round(targetCount * 0.16));
  for (const value of diversityBaseline) {
    const styleKey = commentStyleFingerprint(value, primaryAnchorTerms);
    if (styleKey) styleCounts.set(styleKey, (styleCounts.get(styleKey) || 0) + 1);
    const prefixKey = commentPrefixFingerprint(value);
    if (prefixKey) prefixCounts.set(prefixKey, (prefixCounts.get(prefixKey) || 0) + 1);
    primaryAnchorTerms.filter((term) => commentIncludesAnchorTerm(value, term)).forEach((term) => {
      anchorCounts.set(term, (anchorCounts.get(term) || 0) + 1);
    });
    commentAnchorPairKeys(value, primaryAnchorTerms).forEach((key) => {
      anchorPairCounts.set(key, (anchorPairCounts.get(key) || 0) + 1);
    });
  }
  const output: string[] = [];
  let lowSignalRejectedCount = 0;
  let syntheticRejectedCount = 0;
  let nearDuplicateRejectedCount = 0;
  let repeatedStyleRejectedCount = 0;
  let entityCorrectedCount = 0;
  let unsupportedEntityRejectedCount = 0;
  let transportRejectedCount = 0;
  let unsupportedEmoteRejectedCount = 0;
  let acceptedNativeEmoteCount = 0;
  let acceptedExplicitAnchorCount = 0;
  let acceptedLeadingAnchorCount = 0;
  const maxNativeEmoteCount = Math.min(
    targetCount,
    Math.round(targetCount * styleProfile.nativeEmoteRate) + Math.max(1, Math.round(targetCount * 0.04))
  );
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
    if (containsEngagementTransportLeak(value, transportGuard)) {
      transportRejectedCount += 1;
      continue;
    }
    const nativeEmoteCount = extractNativeEmotes(value).length;
    if (findUnsupportedNativeEmotes(value, styleProfile).length || (nativeEmoteCount && acceptedNativeEmoteCount >= maxNativeEmoteCount)) {
      unsupportedEmoteRejectedCount += 1;
      continue;
    }
    if (isLowSignalComment(value)) {
      lowSignalRejectedCount += 1;
      continue;
    }
    if (isSyntheticComment(value, anchorTerms)) {
      syntheticRejectedCount += 1;
      continue;
    }
    if (sourceBrief && containsUnsupportedPersonalScene(value, sourceBrief)) {
      syntheticRejectedCount += 1;
      continue;
    }
    const matchedPrimaryAnchors = primaryAnchorTerms.filter((term) => commentIncludesAnchorTerm(value, term));
    const matchedAnchorPairs = commentAnchorPairKeys(value, primaryAnchorTerms);
    const hasExplicitAnchor = matchedPrimaryAnchors.length > 0;
    const hasLeadingAnchor = matchedPrimaryAnchors.some((term) => commentStartsWithAnchorTerm(value, term));
    if (
      (hasExplicitAnchor && acceptedExplicitAnchorCount >= explicitAnchorLimit)
      || (hasLeadingAnchor && acceptedLeadingAnchorCount >= leadingAnchorLimit)
      || matchedPrimaryAnchors.some((term) => (anchorCounts.get(term) || 0) >= perAnchorLimit)
      || matchedAnchorPairs.some((key) => (anchorPairCounts.get(key) || 0) >= 1)
    ) {
      repeatedStyleRejectedCount += 1;
      continue;
    }
    const key = commentFingerprint(value);
    if (!key || seen.has(key) || isNearDuplicateComment(value, [...excluded, ...output])) {
      nearDuplicateRejectedCount += 1;
      continue;
    }
    const styleKey = commentStyleFingerprint(value, primaryAnchorTerms);
    const styleCount = styleKey ? styleCounts.get(styleKey) || 0 : 0;
    if (styleKey && styleCount >= repeatedStyleLimit) {
      repeatedStyleRejectedCount += 1;
      continue;
    }
    const prefixKey = commentPrefixFingerprint(value);
    const prefixCount = prefixKey ? prefixCounts.get(prefixKey) || 0 : 0;
    if (prefixKey && prefixCount >= repeatedPrefixLimit) {
      repeatedStyleRejectedCount += 1;
      continue;
    }
    seen.add(key);
    if (styleKey) styleCounts.set(styleKey, styleCount + 1);
    if (prefixKey) prefixCounts.set(prefixKey, prefixCount + 1);
    if (nativeEmoteCount) acceptedNativeEmoteCount += 1;
    if (hasExplicitAnchor) acceptedExplicitAnchorCount += 1;
    if (hasLeadingAnchor) acceptedLeadingAnchorCount += 1;
    matchedPrimaryAnchors.forEach((term) => anchorCounts.set(term, (anchorCounts.get(term) || 0) + 1));
    matchedAnchorPairs.forEach((key) => anchorPairCounts.set(key, (anchorPairCounts.get(key) || 0) + 1));
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
    transportRejectedCount,
    unsupportedEmoteRejectedCount,
    entityCorrections: uniqueEntityCorrections(entityCorrections)
  };
}

function normalizeGeneratedCommentText(raw: unknown, entityGuard: CommentEntityGuard) {
  return normalizeTextWithEntityGuard(
    String(raw || "").replace(/^"+|"+$/g, "").replace(/^\d+(?:[.．]\s+|、\s*)/, "").replace(/\s+/g, " ").trim(),
    entityGuard,
    "comment"
  );
}

function commentStyleFingerprint(value: string, anchorTerms: string[] = []) {
  const template = [...anchorTerms]
    .sort((left, right) => right.length - left.length)
    .reduce((current, term) => current.split(term).join("{锚点}"), value)
    .replace(/\[[^\]\n]{1,12}\]/g, "")
    .replace(/\d+(?:\.\d+)?/g, "{数字}");
  if (/^第一反应/.test(template)) return "canned-first-reaction";
  if (/^你这么一说/.test(template)) return "canned-you-say";
  if (/^本来(?:以为|只是|只想)/.test(template)) return "canned-originally";
  if (/^热闹归热闹/.test(template)) return "canned-busy-but";
  if (/^(?:好家伙|这下真|这波真)/.test(template)) return "canned-exclamation";
  if (/^我先(?:声明|去|蹲|看|问|观望|等等|插个眼|记下)/.test(template)) return "canned-i-first";
  if (/会不会|会不会有|会不会太|会不会更/.test(template)) return "question-will";
  if (/是不是|算不算|能不能|可不可以/.test(template)) return "question-is";
  if (/真能|真的能|用得出来|感知/.test(template)) return "question-feel";
  if (/有点|有点儿|挺狠|太狠|压手|沉默/.test(template)) return "soft-judgment";
  if (/听着|看着|看起来|看上去/.test(template)) return "sensory-judgment";
  if (/别买错|买错|看清|盯紧|版本/.test(template)) return "version-warning";
  if (/差很多|差别大|差在哪|咋分|怎么选/.test(template)) return "comparison-question";
  if (/再蹲|蹲蹲|先蹲|蹲个|先看看|先看|先观望|先记下/.test(template)) return "wait-and-see";
  if (/下班|午休|宿舍|办公室|周末|晚上|通勤|饭点/.test(template)) return "invented-daily-scene";
  if (/(喊|叫|拉).{0,8}(朋友|队友|室友|同事)|固定队|三个人.{0,8}(一起|组队)/.test(template)) return "social-plan";
  if (/^(?:{锚点})?[，,：:]?(?:这个|这波|这回).{0,8}(可以|能|值得|先)/.test(template)) return "tidy-anchor-judgment";
  if (/^(?:[A-Za-z0-9.+-]+|[\u4e00-\u9fa5A-Za-z0-9.+-]{2,12})(?:那|那个|这|这个)?/.test(template) && /[吗？?]$/.test(template)) {
    return "tidy-subject-question";
  }
  return "";
}

function commentPrefixFingerprint(value: string) {
  const normalized = value
    .replace(/\[[^\]\n]{1,12}\]/g, "")
    .replace(/^[\s@#《》“”"'，,。.!！?？:：、-]+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return Array.from(normalized).slice(0, 6).join("");
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

function buildPrimaryCommentAnchorTerms(brief: CommentSourceBrief) {
  const subjects = uniqueText(brief.subjects)
    .map((term) => term.replace(/[^\u4e00-\u9fa5A-Za-z0-9.+%-]/g, "").trim())
    .filter((term) => term.length >= 3 && !isGenericAnchorTerm(term))
    .slice(0, 12);
  const subjectKeys = new Set(subjects.map(commentAnchorMatchKey));
  const supplemental = uniqueText(brief.anchorTerms)
    .map((term) => term.replace(/[^\u4e00-\u9fa5A-Za-z0-9.+%-]/g, "").trim())
    .filter((term) => term.length >= 3 && !isGenericAnchorTerm(term) && !subjectKeys.has(commentAnchorMatchKey(term)))
    .sort((left, right) => right.length - left.length)
    .slice(0, Math.max(24 - subjects.length, 0));
  return [...subjects, ...supplemental];
}

function commentAnchorPairKeys(value: string, anchorTerms: string[]) {
  const matched = anchorTerms
    .filter((term) => commentIncludesAnchorTerm(value, term))
    .filter((term, _index, values) => !values.some((other) => other !== term && other.includes(term)))
    .sort();
  const pairs: string[] = [];
  for (let left = 0; left < matched.length; left += 1) {
    for (let right = left + 1; right < matched.length; right += 1) {
      pairs.push(`${matched[left]}\u0000${matched[right]}`);
    }
  }
  return pairs;
}

function commentIncludesAnchorTerm(value: string, term: string) {
  const termKey = commentAnchorMatchKey(term);
  return Boolean(termKey) && commentAnchorMatchKey(value).includes(termKey);
}

function commentStartsWithAnchorTerm(value: string, term: string) {
  const termKey = commentAnchorMatchKey(term);
  return Boolean(termKey) && commentAnchorMatchKey(value).startsWith(termKey);
}

function commentAnchorMatchKey(value: string) {
  return value.replace(/[^\u4e00-\u9fa5A-Za-z0-9.+%-]/g, "").toLowerCase();
}

function containsUnsupportedPersonalScene(value: string, brief: CommentSourceBrief) {
  const sourceText = [
    brief.summary,
    brief.topic,
    ...brief.keyFacts,
    ...brief.viewerScenes,
    ...brief.discussionAngles
  ].join(" ");
  const sceneTerms = value.match(/下班|午休|宿舍|办公室|室友|同事|朋友|饭搭子|固定队|周末|通勤|开黑群|学生党|上班族|饭点/g) || [];
  if (!sceneTerms.some((term) => !sourceText.includes(term))) return false;

  const firstPersonTestimony = /(?:我|我们|我家|我这边|本人|俺)(?:已经|一直|平时|每天|之前|上次|最近|刚刚|刚|用过|买过|入了|回购|实测|亲测|碰到|遇到|带去|拿去|在).{0,28}(?:下班|午休|宿舍|办公室|室友|同事|朋友|饭搭子|固定队|周末|通勤|开黑群|学生党|上班族|饭点)|(?:我室友|我同事|我朋友|我们固定队|我的饭搭子).{0,24}(?:买了|入了|用了|在用|用过|说过|碰到|遇到|已经|一直|每天)/;
  return firstPersonTestimony.test(value);
}

function isLowSignalComment(value: string) {
  const normalized = normalizeCommentKey(value);
  if (!normalized) return true;
  return /^(评论|占位|测试|示例|暂无|无内容|生成失败)[。！!~～]*$/i.test(value);
}

function isSyntheticComment(value: string, anchorTerms: string[]) {
  const hasAnchor = anchorTerms.some((term) => value.includes(term));
  const hasChatterCue = hasCommentChatterCue(value);
  const punctuationCount = (value.match(/[，,。！？!?]/g) || []).length;
  const aiWordCount = (value.match(/确实|感觉|适合|需求|路线|定位|配置|参数|普通人|对我来说|我这种|这个点|这点|至少|其实|反而|尤其|兼顾|取舍|场景/g) || []).length;
  const hasPolishedTurn = /(听着|看着|主打|核心|如果|虽然|不过|但).{0,18}(确实|感觉|适合|需求|路线|定位|配置|参数|普通人|对我来说|我这种|取舍)/.test(value);
  const hasReviewTone = /(核心卖点|需求场景|适合人群|产品力|配置拉满|定位清晰|取舍很明确|体验闭环)/.test(value);
  const hasHumanCue = /(想问|有没有|会不会|怕|担心|预算|到手|纠结|等|蹲)/.test(value);

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
    return dice >= 0.56 || (overlap >= 8 && Math.min(valueTokens.length, existingTokens.length) <= 18);
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

function clampRate(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
