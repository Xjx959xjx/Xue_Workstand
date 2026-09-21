import { chatCompleteStrict, getChatRuntimeConfig } from "./ai";
import {
  classifyEngagementCommentIntent,
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
  buildEngagementCommentResearch,
  formatEngagementCommentResearch,
  type EngagementCommentResearch
} from "./engagement-research";
import { containsPlatformUserMention } from "./opencli-normalizers";
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
  excludedVideoIds?: string[];
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

const ENGAGEMENT_ENGINE_VERSION = "engagement-v4.1";
const ENGAGEMENT_DANMAKU_ENGINE_VERSION = "danmaku-v2";
const ENGAGEMENT_SOURCE_CACHE_VERSION = "engagement-v3";
const ENGAGEMENT_BRIEF_CACHE_VERSION = "engagement-v3.2";
const COMMENT_GENERATION_BATCH_SIZE = 8;
const COMMENT_MODEL_CONCURRENCY = clampCount(Number.parseInt(process.env.ENGAGEMENT_MODEL_CONCURRENCY || "", 10), 1, 4, 4);
const DANMAKU_GENERATION_BATCH_SIZE = 16;
const DANMAKU_MODEL_CONCURRENCY = Math.min(COMMENT_MODEL_CONCURRENCY, 2);
const COMMENT_CANDIDATE_RATIO = clampRate(Number.parseFloat(process.env.ENGAGEMENT_COMMENT_CANDIDATE_RATIO || ""), 1.05, 1.5, 1.4);
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

    if (remaining.commentCount || remaining.danmakuCount) {
      throw new Error(`互动素材未生成完整，仍缺：${formatEngagementGapSummary(remaining)}。已保存本次抓到的热评和可用结果，请检查模型配置后重试。`);
    }
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
    message: "正在整理素材并准备跨平台调研",
    progress: 24
  });
  throwIfAborted(runOptions.signal);
  const commentsPromise = options.includeComments
    ? generateComments({
        source: prepared.content,
        contexts: prepared.contexts,
        count: options.commentCount,
        platform: prepared.platform,
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
      reusedHotCommentCount: mergedItems.filter((item) => item.origin === "reused_hot_comment").length,
      reusedRelatedCommentCount: mergedItems.filter((item) => item.origin === "reused_hot_comment").length,
      aiGeneratedCount: mergedItems.filter((item) => item.origin === "ai_generated").length,
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
        input: existingRecord.sourceUrl || existingRecord.sourceText,
        excludedVideoIds: extractEngagementVideoIds(
          `${existingRecord.sourceUrl || ""} ${existingRecord.resolvedUrl || ""}`
        )
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
      excludedVideoIds: extractEngagementVideoIds(`${url} ${result.url || ""} ${result.resolvedUrl || ""}`),
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
    generationMode: "research",
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
    targetPlatform: input.targetPlatform
  };
}

function draftToEngagementContent(draft: Draft): EngagementContent {
  return {
    id: draft.id,
    title: normalizeKnownEngagementTerms(draft.title),
    content: normalizeKnownEngagementTerms(draft.content),
    prompt: draft.prompt ? normalizeKnownEngagementTerms(draft.prompt) : draft.prompt,
    input: draft.input ? normalizeKnownEngagementTerms(draft.input) : draft.input,
    excludedVideoIds: extractEngagementVideoIds(draft.input || "")
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

function buildCommentSystemPrompt(platform: Platform) {
  if (platform === "bilibili") {
    return `你在补齐真实的 B站视频评论区，不是弹幕，也不是给视频写摘要。每条评论来自不同用户。多数人只抓一个细节随手反应、接梗、与 UP 互动或说一句自己的判断；少数人才会认真补充、纠错、追问或反驳。允许长短评论并存，但不要把普通网友都写成产品经理、评测编辑或课代表。保留网友会省略主语、话说一半、标点不统一的自然状态，不要追求“句句漂亮”。

评论必须对素材有反应，可以使用稳定常识做一步推理；技术质疑必须有明确事实关系，不能把两个同时出现的参数硬凑成因果问题。不能编造新闻、销量、官方结论，也不能伪装自己真实购买、长期使用或亲历了素材没有写的事情。真实热评已经由程序优先加入结果，你只负责补足缺口，不能复制、改写或近义复述已有热评。不要攻击、造谣、色情、歧视或引导刷量。只输出 JSON 字符串数组。`;
  }
  return `你在补齐真实的抖音评论区，不是在写产品评测或给文案做摘要。每条评论来自不同网友：有人玩梗，有人顺着一个词跳到熟悉场景，有人接话，有人只丢半句，也有人认真追问或泼冷水。评论必须对素材有反应，但不能只是把素材卖点换成口语再说一次。保留网友会省略主语、话说一半、标点不统一的自然状态，不要追求“句句漂亮”。

可以使用稳定、常见的文化常识、平台语感、游戏或日常场景做“一步联想”，也可以用明显夸张和假设制造笑点；不能编造新闻、销量、官方结论，也不能伪装自己真实购买、长期使用或亲历了素材没有写的事情。真实热评已经由程序优先加入结果，你只负责补足缺口，不能复制、改写或近义复述已有热评。不要攻击、造谣、色情、歧视或引导刷量。只输出 JSON 字符串数组。`;
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
  excludedComments: string[];
  signal?: AbortSignal;
  onProgress?: GenerateEngagementOptions["onProgress"];
}) {
  const { source, contexts, count, platform, excludedComments, signal, onProgress } = input;
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
    stage: "research",
    message: "正在让 AI 阅读完整正文，自主规划检索关键词和数量，再搜索相关视频",
    progress: 30
  });

  const researchStartedAt = Date.now();
  const relatedResearch = await buildEngagementCommentResearch({ ...sourceBrief, fullText: generationSource.content }, {
    platform,
    excludedVideoIds: generationSource.excludedVideoIds,
    signal,
    onProgress: (message) => onProgress?.({ stage: "research", message, progress: 30 })
  });
  const reusableFingerprints = new Set(relatedResearch.reusableComments.map(commentFingerprint));
  const blockedComments = uniqueText(excludedComments);
  parsed.push(...relatedResearch.reusableComments);
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
  let usedModel = "original-comments";
  let lastBatchError: unknown;
  let nextBatchIndex = 0;
  let round = 0;
  const modelConcurrency = platform === "bilibili" ? 1 : COMMENT_MODEL_CONCURRENCY;
  let selected = selectCommentSamples(
    parsed,
    sourceBrief,
    entityGuard,
    transportGuard,
    count,
    blockedComments,
    reusableFingerprints
  );
  if (selected.items.length < count && !ENABLE_MODEL_COMMENT_GENERATION) {
    throw new Error(
      `已抓到并保留 ${selected.items.length} 条可复用原评，还缺 ${count - selected.items.length} 条；AI 兜底未启用，请配置对话模型后重试。`
    );
  }
  const generationStartedAt = Date.now();

  while (
    selected.items.length < count
    && round < COMMENT_GENERATION_MAX_ROUNDS
  ) {
    throwIfAborted(signal);
    const missingCount = Math.max(count - selected.items.length, 0);
    const requestCount = round === 0
      ? Math.max(missingCount, Math.ceil(missingCount * COMMENT_CANDIDATE_RATIO))
      : missingCount + Math.max(2, Math.ceil(missingCount * 0.2));
    const batches = buildCommentGenerationBatches(requestCount, nextBatchIndex);

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
                      relatedResearch,
                      platform,
                      requestedCount: batch.requestedCount,
                      usedComments: uniqueText([...excludedComments, ...selected.items]).slice(-200)
                    })
                  }
                ],
                "low",
                {
                  policy: "comment_generate",
                  signal
                }
              );
              throwIfAborted(signal);
              if (result.fallback || !result.text.trim()) {
                throw new Error(result.fallbackReason || "模型没有返回可用评论，请重试或更换模型。");
              }
              const batchParsed = parseStringArray(result.text)
                .slice(0, batch.requestedCount);
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
            requestedCount: batch.requestedCount,
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
          requestedCount: batch.requestedCount,
          parsedCount: 0,
          model: "",
          fallback: false,
          fallbackReason: settled.reason instanceof Error ? settled.reason.message : "评论批次生成失败",
          status: "failed",
          attempts: 1
        });
      });

      selected = selectCommentSamples(
        parsed,
        sourceBrief,
        entityGuard,
        transportGuard,
        count,
        blockedComments,
        reusableFingerprints
      );
      const preview = selected.items.slice(0, count).map((text, index) =>
        makeCommentItem(
          text,
          contexts[index % Math.max(contexts.length, 1)]?.platform || platform,
          index,
          reusableFingerprints.has(commentFingerprint(text)) ? "reused_hot_comment" : "ai_generated"
        )
      );
      const relatedPreviewCount = preview.filter((item) => item.origin === "reused_hot_comment").length;
      await onProgress?.({
        stage: "generate",
        message: `已匹配相关原评 ${relatedPreviewCount} 条，AI 补写后共 ${preview.length}/${count} 条`,
        progress: Math.min(88, 42 + Math.round((preview.length / count) * 44)),
        previewComments: preview
      });
      if (modelConcurrency === 1 && start + modelConcurrency < batches.length) {
        await waitForCommentRetry(250, signal);
      }
    }

    nextBatchIndex += batches.length;
    round += 1;
    selected = selectCommentSamples(
      parsed,
      sourceBrief,
      entityGuard,
      transportGuard,
      count,
      blockedComments,
      reusableFingerprints
    );
  }

  const selection = selectCommentSamples(
    parsed,
    sourceBrief,
    entityGuard,
    transportGuard,
    count,
    blockedComments,
    reusableFingerprints
  );
  const texts = selection.items.slice(0, count);
  if (!texts.length) {
    throw lastBatchError instanceof Error ? lastBatchError : new Error("模型没有返回可用评论，请重试或更换模型。");
  }
  const generationMs = Date.now() - generationStartedAt;
  const outputLengthBuckets = summarizeCommentLengthBuckets(texts.slice(0, count));
  const outputIntentBuckets = summarizeCommentIntentBuckets(texts.slice(0, count));
  const reusedHotCommentCount = texts.filter((text) => reusableFingerprints.has(commentFingerprint(text))).length;
  const reusedRelatedCommentCount = reusedHotCommentCount;
  await onProgress?.({
    stage: "filter",
    message: texts.length < count ? `已保留 ${texts.length}/${count} 条，系统将继续自动补齐` : `已完成 ${texts.length} 条评论`,
    progress: 94,
    previewComments: texts.map((text, index) =>
      makeCommentItem(
        text,
        contexts[index % Math.max(contexts.length, 1)]?.platform || platform,
        index,
        reusableFingerprints.has(commentFingerprint(text)) ? "reused_hot_comment" : "ai_generated"
      )
    )
  });
  const diagnostics = {
    sourceBrief: toCommentSourceBriefDiagnostics(sourceBrief),
    entityGuard: toCommentEntityGuardDiagnostics(entityGuard, [
      ...sourceBriefResult.entityCorrections,
      ...selection.entityCorrections
    ]),
    relatedResearch: toRelatedCommentResearchDiagnostics(relatedResearch),
    research: [toRelatedCommentResearchSummary(relatedResearch)],
    generation: {
      mode: "model_batch" as const,
      requestedCount: count,
      batchSize: COMMENT_GENERATION_BATCH_SIZE,
      batchCount: batchResults.length,
      parsedCount: parsed.length,
      completedCount: texts.length,
      supplementedCount: Math.max(0, texts.length - reusedHotCommentCount),
      reusedHotCommentCount,
      reusedRelatedCommentCount,
      aiGeneratedCount: Math.max(texts.length - reusedHotCommentCount, 0),
      lengthBuckets: outputLengthBuckets,
      intentBuckets: outputIntentBuckets,
      lowSignalRejectedCount: selection.lowSignalRejectedCount,
      syntheticRejectedCount: selection.syntheticRejectedCount,
      nearDuplicateRejectedCount: selection.nearDuplicateRejectedCount,
      repeatedStyleRejectedCount: selection.repeatedStyleRejectedCount,
      entityCorrectedCount: selection.entityCorrectedCount,
      unsupportedEntityRejectedCount: selection.unsupportedEntityRejectedCount,
      transportRejectedCount: selection.transportRejectedCount,
      nativeEmoteCount: texts.filter(hasNativeEmote).length,
      batches: batchResults
    }
  };
  return {
    usedModel,
    fallback: Boolean(relatedResearch?.summaryError),
    fallbackReason: relatedResearch?.summaryError,
    briefMs,
    researchMs,
    generationMs,
    cacheHits: [
      ...(sourceBriefResult.cacheHit ? ["brief" as const] : []),
      ...(relatedResearch?.cacheHit ? ["research" as const] : [])
    ],
    diagnostics,
    items: texts.slice(0, count).map((text, index) => makeCommentItem(
      text,
      contexts[index % Math.max(contexts.length, 1)]?.platform || platform,
      index,
      reusableFingerprints.has(commentFingerprint(text)) ? "reused_hot_comment" : "ai_generated"
    ))
  };
}

function buildCommentGenerationBatches(count: number, startIndex = 0) {
  const batches: { index: number; requestedCount: number }[] = [];
  for (let index = 0; index < count; index += COMMENT_GENERATION_BATCH_SIZE) {
    batches.push({
      index: startIndex + batches.length,
      requestedCount: Math.min(COMMENT_GENERATION_BATCH_SIZE, count - index)
    });
  }
  return batches;
}

function spreadPositions(count: number, selectedCount: number) {
  if (!count || !selectedCount) return [];
  return Array.from({ length: selectedCount }, (_, index) =>
    Math.min(count - 1, Math.floor(((index + 0.5) * count) / selectedCount))
  );
}

function formatStyleExamples(examples: string[]) {
  return examples.length
    ? examples.slice(0, 18).map((example) => `- ${example}`).join("\n")
    : "暂无本地真实样本，只按平台预设分布生成。";
}

function buildCommentBatchPrompt(input: {
  source: EngagementContent;
  sourceBrief: CommentSourceBrief;
  entityGuard: CommentEntityGuard;
  relatedResearch: EngagementCommentResearch | null;
  platform: Platform;
  requestedCount: number;
  usedComments: string[];
}) {
  return `文案标题：${input.source.title}

目标渠道：${input.platform === "bilibili" ? "B站评论" : "抖音评论"}

评论锚点地图：
${formatCommentSourceBrief(input.sourceBrief)}

型号一致性约束：
${formatCommentEntityGuard(input.entityGuard)}

${input.relatedResearch ? `已经抓取并优先采用的真实热评概况（这些原评已经进入候选，不要复述或改写，只参考自然语气和讨论方向）：
${formatEngagementCommentResearch(input.relatedResearch)}
` : ""}

本次已经生成/历史已有的评论（这些观点、梗、问法和句式都已经用过，不能改几个字再写一遍）：
${input.usedComments.length ? input.usedComments.map((comment) => `- ${comment}`).join("\n") : "暂无"}

原始文案节选（只用于核对，不要逐句复读）：
${clampText(input.source.content, 2600)}

真实原评数量不足，请只补写缺少的 ${input.requestedCount} 条。长短、语气和评论类型自然变化，不需要凑任何比例或结构。

要求：
1. 每条像不同网友随手发的。优先写短反应、半句、追问、纠错、接梗、圈内黑话和轻微歪楼；少量长评论才允许完整展开。
2. 不要复制、改写或近义复述“已经生成/历史已有的评论”。
3. 只能围绕当前正文，不能带入其他视频的对象、型号、事实或经历。
4. 型号只能使用“一致性约束”里的写法；不能编新闻、销量、购买经历或长期使用证词，也不能输出链接、短链码和视频 ID。
5. 同一个事实、梗、担忧和句式最多用一次；表情按语气自然使用。
6. 禁止“本来……看完……”“看着……自己……”“不影响……这才是……”等工整转折；禁止每条都给结论、都像金句。
7. 不要为了通顺统一补全主谓宾；允许无句号、问号连用、重复字、口语停顿和自然错字，但不要故意制造乱码。
8. 禁止输出 &#x20;、&nbsp;、<br> 等 HTML 实体或标签。
9. 技术问题必须有明确事实关系。只输出 ${input.requestedCount} 个 JSON 字符串。`;
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
            "medium",
            { policy: "danmaku", signal }
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

function toRelatedCommentResearchDiagnostics(research: EngagementCommentResearch) {
  return {
    usedQueries: research.usedQueries,
    searchAnchors: research.searchAnchors,
    searchEventTerms: research.searchEventTerms,
    failedQueries: research.failedQueries,
    relatedVideoCount: research.relatedVideoCount,
    relatedCommentCount: research.relatedCommentCount,
    freshCommentCount: research.freshCommentCount,
    targetPlatformCommentCount: research.targetPlatformCommentCount,
    matchedLibraryCommentCount: research.matchedLibraryCommentCount,
    replySampleCount: research.replySampleCount,
    sourceStats: research.sourceStats,
    quarantinedVideoCount: research.quarantinedVideoCount,
    quarantinedCommentCount: research.quarantinedCommentCount,
    quarantinedSources: research.quarantinedSources,
    quarantineClassifierStatus: research.quarantineClassifierStatus,
    quarantineClassifierError: research.quarantineClassifierError,
    hotComments: research.hotComments,
    reusableComments: research.reusableComments,
    sampleLibraryCount: research.sampleLibraryCount,
    longCommentCount: research.longCommentCount,
    lengthBuckets: research.lengthBuckets,
    intentBuckets: research.intentBuckets,
    themes: research.themes,
    phrases: research.phrases,
    questions: research.questions,
    objections: research.objections,
    recentTopics: research.recentTopics,
    legacyTopics: research.legacyTopics,
    playerLifeAngles: research.playerLifeAngles,
    platformAngles: research.platformAngles,
    replyAngles: research.replyAngles,
    longCommentPatterns: research.longCommentPatterns,
    chatterAngles: research.chatterAngles,
    summaryError: research.summaryError
  };
}

function toRelatedCommentResearchSummary(research: EngagementCommentResearch) {
  return {
    relatedCommentCount: research.relatedCommentCount,
    relatedCommentUsed: research.relatedCommentCount,
    relatedVideoCount: research.relatedVideoCount,
    relatedLongCommentCount: research.longCommentCount,
    relatedIntentBuckets: research.intentBuckets,
    usedQueries: research.usedQueries,
    failedQueries: research.failedQueries,
    quarantinedVideoCount: research.quarantinedVideoCount,
    quarantinedCommentCount: research.quarantinedCommentCount,
    skippedRelatedSearch: false
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
  entityCorrections: CommentEntityCorrection[];
};

function selectCommentSamples(
  values: string[],
  sourceBrief: CommentSourceBrief | undefined,
  entityGuard: CommentEntityGuard,
  transportGuard: EngagementTransportGuard,
  targetCount: number,
  excludedValues: string[] = [],
  reusableFingerprints: Set<string> = new Set()
): CommentSelectionResult {
  const anchorTerms = sourceBrief ? buildCommentAnchorTerms(sourceBrief) : [];
  const excluded = excludedValues.map((value) => value.trim()).filter(Boolean);
  const seen = new Set(excluded.map(commentFingerprint));
  const output: string[] = [];
  let lowSignalRejectedCount = 0;
  let syntheticRejectedCount = 0;
  let nearDuplicateRejectedCount = 0;
  const repeatedStyleRejectedCount = 0;
  let entityCorrectedCount = 0;
  let unsupportedEntityRejectedCount = 0;
  let transportRejectedCount = 0;
  const entityCorrections: CommentEntityCorrection[] = [];
  for (const raw of values) {
    const rawText = sanitizeCommentPresentationText(String(raw || ""));
    const isReusableHotComment = reusableFingerprints.has(commentFingerprint(rawText));
    const normalized = isReusableHotComment
      ? { text: rawText, corrections: [] as CommentEntityCorrection[] }
      : normalizeGeneratedCommentText(raw, entityGuard);
    const value = normalized.text;
    entityCorrectedCount += normalized.corrections.length;
    entityCorrections.push(...normalized.corrections);
    if (containsPlatformUserMention(value)) {
      lowSignalRejectedCount += 1;
      continue;
    }
    if (!value || (!isReusableHotComment && (value.length < 2 || value.length > 140 || /^\{.*\}$/.test(value) || /^\[.*\]$/.test(value)))) {
      lowSignalRejectedCount += 1;
      continue;
    }
    if (!isReusableHotComment && findUnsupportedModelTerms(value, entityGuard).length) {
      unsupportedEntityRejectedCount += 1;
      continue;
    }
    if (containsEngagementTransportLeak(value, transportGuard)) {
      transportRejectedCount += 1;
      continue;
    }
    if (!isReusableHotComment && isLowSignalComment(value)) {
      lowSignalRejectedCount += 1;
      continue;
    }
    if (!isReusableHotComment && isSyntheticComment(value, anchorTerms)) {
      syntheticRejectedCount += 1;
      continue;
    }
    if (!isReusableHotComment && sourceBrief && containsUnsupportedPersonalScene(value, sourceBrief)) {
      syntheticRejectedCount += 1;
      continue;
    }
    const key = commentFingerprint(value);
    if (!key || seen.has(key) || isNearDuplicateComment(value, [...excluded, ...output])) {
      nearDuplicateRejectedCount += 1;
      continue;
    }
    seen.add(key);
    output.push(value);
    if (output.length >= targetCount) break;
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
    entityCorrections: uniqueEntityCorrections(entityCorrections)
  };
}

function normalizeGeneratedCommentText(raw: unknown, entityGuard: CommentEntityGuard) {
  return normalizeTextWithEntityGuard(
    sanitizeCommentPresentationText(String(raw || ""))
      .replace(/^"+|"+$/g, "")
      .replace(/^\d+(?:[.．]\s+|、\s*)/, "")
      .trim(),
    entityGuard,
    "comment"
  );
}

function sanitizeCommentPresentationText(value: string) {
  return value
    .replace(/&#x20;|&#32;|&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const hasPolishedSummaryTemplate = /(本来.{0,18}(冲着|以为|只是).{0,18}(看完|结果|最后)|看.{0,12}(觉得|起来).{0,12}(自己|真到).{0,18}|不影响.{0,18}这才是|不是.{0,16}而是|既.{0,12}又.{0,12}|前脚.{0,16}后脚)/.test(value);
  const hasHumanCue = /(想问|有没有|会不会|怕|担心|预算|到手|纠结|等|蹲)/.test(value);

  if (hasReviewTone) return true;
  if (value.length >= 18 && hasPolishedSummaryTemplate && !hasHumanCue) return true;
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

function makeCommentItem(
  text: string,
  platform: Platform | "unknown",
  index: number,
  origin: DraftCommentAsset["origin"] = "ai_generated"
): DraftCommentAsset {
  return {
    id: `comment-${index + 1}-${shortHash(text)}`,
    platform,
    text: text.trim(),
    origin
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
