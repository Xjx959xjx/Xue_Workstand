import { chatComplete, getChatRuntimeConfig } from "./ai";
import {
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
  viewerScenes: string[];
  discussionAngles: string[];
  skepticalAngles: string[];
  mustAvoid: string[];
  anchorTerms: string[];
};

const COMMENT_GENERATION_BATCH_SIZE = 25;
const COMMENT_PROMPT_VARIANTS = [
  "这批偏向第一反应式短评，多给共鸣、代入、随手接话的感觉。",
  "这批偏向挑具体卖点、配置、价格或使用场景接话，不要空泛夸好。",
  "这批偏向提问、追问、补充观点，让评论区像有人继续接话。",
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

export async function generateEngagement(input: GenerateEngagementInput, runOptions: GenerateEngagementOptions = {}) {
  throwIfAborted(runOptions.signal);
  const options = normalizeEngagementOptions(input);
  if (!options.includeComments && !options.includeDanmaku) {
    throw new Error("请至少选择评论或弹幕。");
  }

  const prepared = await prepareEngagementSource(input, options);
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

async function prepareEngagementSource(input: GenerateEngagementInput, options: EngagementRecord["options"]): Promise<{
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
    const text = input.text.trim();
    if (!text) throw new Error("请粘贴文案后再生成。");
    return {
      content: {
        id: `text-${shortHash(text)}`,
        title: input.title?.trim() || makeEngagementTitle(text, "粘贴文案"),
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
    const result = await transcribeLinkSource({ url });
    const content = {
      id: `url-${shortHash(result.resolvedUrl || result.url || url)}`,
      title: result.title || makeEngagementTitle(result.text || url, "视频链接"),
      content: result.text,
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
    title: draft.title,
    content: draft.content,
    prompt: draft.prompt,
    input: draft.input
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
  const sourceBrief = await buildCommentSourceBrief(source, platform, signal);
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

  while (cleanCommentSamples(parsed, sourceBrief).length < count && round < COMMENT_GENERATION_MAX_ROUNDS) {
    throwIfAborted(signal);
    const missingCount = Math.max(count - cleanCommentSamples(parsed, sourceBrief).length, 0);
    const batches = buildCommentGenerationBatches(missingCount, nextBatchIndex);

    for (let start = 0; start < batches.length; start += COMMENT_MODEL_CONCURRENCY) {
      throwIfAborted(signal);
      const wave = batches.slice(start, start + COMMENT_MODEL_CONCURRENCY);
      const recentComments = parsed.slice(-120);
      const waveResults = await Promise.all(
        wave.map(async (batch, waveIndex) => {
          throwIfAborted(signal);
          const result = await chatComplete(
            [
              {
                role: "system",
                content:
                  "你是中文短视频评论区里的普通观众，不是策划，也不是文案。请只基于给定文案生成真实、口语化、像手滑顺手发出去的评论。不要参考原视频评论，不要生成用户名，不要攻击、造谣、色情、歧视或引导刷量。只输出 JSON 数组，每项为字符串。"
              },
              {
                role: "user",
                content: buildCommentBatchPrompt({
                  source,
                  sourceBrief,
                  batchIndex: batch.index,
                  batchOrder: start + waveIndex + 1,
                  totalBatches: batches.length,
                  batchCount: batch.count,
                  existingComments: recentComments
                })
              }
            ],
            "low"
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
    if (!needsMoreUniqueComments(parsed, count, sourceBrief)) break;
  }

  const texts = cleanCommentSamples(parsed, sourceBrief);
  if (texts.length < count) {
    throw new Error(`模型只返回了 ${texts.length} 条可用评论，未达到 ${count} 条，请重试或更换模型。`);
  }
  const diagnostics = {
    sourceBrief: toCommentSourceBriefDiagnostics(sourceBrief),
    generation: {
      mode: "model_batch" as const,
      requestedCount: count,
      batchSize: COMMENT_GENERATION_BATCH_SIZE,
      batchCount: batchResults.length,
      parsedCount: texts.length,
      completedCount: texts.length,
      supplementedCount: 0,
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
  batchIndex: number;
  batchOrder: number;
  totalBatches: number;
  batchCount: number;
  existingComments: string[];
}) {
  const variant = COMMENT_PROMPT_VARIANTS[input.batchIndex % COMMENT_PROMPT_VARIANTS.length];
  return `文案标题：${input.source.title}

评论锚点地图：
${formatCommentSourceBrief(input.sourceBrief)}

原始文案节选（只用于核对，不要逐句复读）：
${clampText(input.source.content, 2200)}

请生成 ${input.batchCount} 条观众评论。这是当前一轮的第 ${input.batchOrder}/${input.totalBatches} 批，只输出本批 JSON 数组。

本批偏向：
${variant}

要求：
1. 每条像真实网友在刷短视频时随手发的短评。
2. 每条至少贴住一个具体锚点：产品/人物/事件名、数字、配置、价格、画面、场景、槽点或疑问。
3. 语气自然，口语化，别像总结、复盘、客服、营销，也别像商详页复读。
4. 短中长混合，但大多数保持一行能看完。
5. 要有轻微惊讶、共鸣、调侃、提问、补充观点、轻度吐槽、真实观望这几类变化。
6. 不要全是夸，不要全都“种草/心动/真香”；可以有人担心缺点、质感、预算、适配场景。
7. 不要机械重复标题里的词，不要每条都以“这”开头。
8. 避免“这条”“这次信息量”“画面感”“莫名合理”“热梗现场”这类明显模板味表达。
9. 不要假装自己已购买、用了很久或看过评论区；除非原文明确提供。
10. 和其他批次拉开一点表达角度，不要像同一个人连续刷屏。

已生成评论，后续不要重复：
${input.existingComments.join("\n") || "暂无"}`;
}

function needsMoreUniqueComments(values: string[], count: number, sourceBrief: CommentSourceBrief) {
  return cleanCommentSamples(values, sourceBrief).length < count;
}

async function generateDanmaku(source: EngagementContent, contexts: SourceContext[], count: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  const samples = contexts
    .map((context) => `账号：${context.accountName}\n弹幕样本：\n${context.danmaku.slice(0, 70).join("\n") || "暂无弹幕样本"}`)
    .join("\n\n---\n\n") || "暂无弹幕样本，请按正文节奏生成自然短弹幕。";
  const result = await chatComplete(
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
    "low"
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
  signal?: AbortSignal
): Promise<CommentSourceBrief> {
  throwIfAborted(signal);
  const result = await chatComplete(
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
  "viewerScenes": ["观众会代入的真实场景，4-8 条"],
  "discussionAngles": ["适合评论区接话的角度，8-12 条"],
  "skepticalAngles": ["自然的疑问、保留意见或可能的反向观点，4-8 条"],
  "mustAvoid": ["没有材料不要写或容易写假的内容，4-8 条"],
  "anchorTerms": ["评论里可以自然出现的源内关键词、型号、参数、价格、场景词，15-30 个"]
}

额外要求：
- 产品推荐/测评素材优先提炼型号、价格/优惠、核心配置、使用场景、明确短板。
- 游戏/热点素材优先提炼人物、活动、福利、时间、争议点、玩家代入场景。
- anchorTerms 要短，保留原文说法，不要塞完整句子。
- 如果素材信息很少，就如实输出少量锚点，不要补常识。`
      }
    ],
    "medium"
  );
  throwIfAborted(signal);
  if (result.fallback || !result.text.trim()) {
    throw new Error(result.fallbackReason || "模型没有返回可用的评论锚点，请重试或更换模型。");
  }
  return normalizeCommentSourceBrief(parseJsonFromText(result.text), source);
}

function buildCommentBriefSourceText(source: EngagementContent) {
  return [
    source.prompt ? `生成提示：\n${source.prompt}` : "",
    source.input && source.input !== source.content ? `原始输入：\n${source.input}` : "",
    `正文：\n${source.content}`
  ].filter(Boolean).join("\n\n---\n\n");
}

function normalizeCommentSourceBrief(parsed: unknown, source: EngagementContent): CommentSourceBrief {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模型返回了内容，但没有解析到评论锚点 JSON，请重试或更换模型。");
  }
  const object = parsed as Record<string, unknown>;
  const brief = {
    summary: normalizeBriefString(object.summary) || makeEngagementTitle(source.content, source.title),
    topic: normalizeBriefString(object.topic) || source.title,
    subjects: normalizeBriefList(object.subjects, 8),
    keyFacts: normalizeBriefList(object.keyFacts, 14),
    viewerScenes: normalizeBriefList(object.viewerScenes, 8),
    discussionAngles: normalizeBriefList(object.discussionAngles, 12),
    skepticalAngles: normalizeBriefList(object.skepticalAngles, 8),
    mustAvoid: normalizeBriefList(object.mustAvoid, 8),
    anchorTerms: normalizeBriefList(object.anchorTerms, 30)
  };
  brief.anchorTerms = uniqueText([
    ...brief.anchorTerms,
    ...brief.subjects,
    ...extractSourceAnchorTerms(`${source.title}\n${source.content}`)
  ]).slice(0, 40);
  if (!brief.keyFacts.length && !brief.discussionAngles.length && !brief.anchorTerms.length) {
    throw new Error("评论锚点为空，无法生成贴合素材的评论。请补充更完整的文案或链接。");
  }
  return brief;
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

function cleanCommentSamples(values: string[], sourceBrief?: CommentSourceBrief) {
  const anchorTerms = sourceBrief ? buildCommentAnchorTerms(sourceBrief) : [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = String(raw || "").replace(/^"+|"+$/g, "").replace(/\s+/g, " ").trim();
    if (value.length < 2 || value.length > 140) continue;
    if (/^\{.*\}$/.test(value) || /^\[.*\]$/.test(value)) continue;
    if (isLowSignalComment(value, anchorTerms)) continue;
    const key = commentFingerprint(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
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
