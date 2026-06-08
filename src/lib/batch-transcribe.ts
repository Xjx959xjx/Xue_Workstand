import { generateStyleProfile } from "./ai";
import {
  getDouyinAwemeId,
  getDouyinVideoDownloadLookupLimit,
  getDouyinVideoDownloadUrls
} from "./opencli";
import { getAccountSummary, markTranscriptFailed, resolveAccount } from "./storage";
import { transcribeVideo } from "./transcription";
import { Account, BatchTranscribeResult, Platform, Video } from "./types";

export type BatchTranscribeInput = {
  platform: Platform;
  accountId: string;
  limit: number | "all";
  updateStyle?: boolean;
};

export type BatchTranscribeVideoEvent = {
  phase: "video";
  videoId: string;
  title: string;
  status: "completed" | "skipped" | "failed";
  source?: Video["transcriptSource"] | string;
  error?: string;
  timings?: Timing[];
  completed: number;
  skipped: number;
  failed: number;
};

export type BatchTranscribeHooks = {
  onPrepare?: () => void;
  onMediaPreloadStart?: (payload: { total: number }) => void;
  onVideoStart?: (payload: { index: number; total: number; video: Video }) => void;
  onVideoResult?: (payload: BatchTranscribeVideoEvent) => void;
  onStyleStart?: () => void;
  onFinalize?: () => void;
  signal?: AbortSignal;
};

type BatchVideoResult = BatchTranscribeResult["results"][number];
type Timing = NonNullable<BatchTranscribeResult["timings"]>[number];

export async function runBatchTranscribe(
  input: BatchTranscribeInput,
  hooks: BatchTranscribeHooks = {}
): Promise<BatchTranscribeResult> {
  throwIfAborted(hooks.signal);
  hooks.onPrepare?.();
  const totalStartedAt = Date.now();

  const account = await resolveAccount(input.platform, input.accountId);
  const summary = await getAccountSummary(account);
  const limit = input.limit === "all" ? summary.videos.length : Math.min(input.limit, summary.videos.length);
  const candidates = summary.videos.slice(0, limit);

  const result: BatchTranscribeResult = {
    account: summary,
    requested: candidates.length,
    completed: 0,
    skipped: 0,
    failed: 0,
    timings: [],
    results: []
  };

  pushTiming(result, "prepare", totalStartedAt);
  await processVideos(input, hooks, result, account, candidates);
  throwIfAborted(hooks.signal);

  const candidateOrder = new Map(candidates.map((video, index) => [video.id, index]));
  result.results.sort((a, b) => (candidateOrder.get(a.videoId) ?? 0) - (candidateOrder.get(b.videoId) ?? 0));

  pushTiming(result, "transcribe-phase-total", totalStartedAt);

  if (input.updateStyle) {
    throwIfAborted(hooks.signal);
    hooks.onStyleStart?.();
    try {
      const styleResult = await generateStyleProfile(input.platform, input.accountId, { signal: hooks.signal });
      result.style = styleResult.style;
      result.styleUpdated = true;
      result.fallback = styleResult.fallback;
      result.fallbackReason = styleResult.fallbackReason;
      result.usedModel = styleResult.usedModel;
    } catch (error) {
      if (isAbortError(error)) throw error;
      result.styleUpdated = false;
      result.styleError = error instanceof Error ? error.message : "风格卡更新失败";
    }
  }

  result.account = await getAccountSummary(account);
  throwIfAborted(hooks.signal);
  pushTiming(result, "total", totalStartedAt);
  hooks.onFinalize?.();
  return result;
}

async function processVideos(
  input: BatchTranscribeInput,
  hooks: BatchTranscribeHooks,
  result: BatchTranscribeResult,
  account: Account,
  candidates: Video[]
) {
  throwIfAborted(hooks.signal);
  const concurrency = input.platform === "douyin" ? resolveDouyinBatchConcurrency() : 1;
  let douyinMediaUrls = new Map<string, string>();
  if (input.platform === "douyin") {
    const pendingCount = candidates.filter((video) => !videoHasTranscript(video)).length;
    if (pendingCount) hooks.onMediaPreloadStart?.({ total: pendingCount });
  douyinMediaUrls = await preloadDouyinMediaUrls(account, candidates, result, hooks.signal);
  }
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < candidates.length) {
      throwIfAborted(hooks.signal);
      const index = nextIndex;
      nextIndex += 1;
      const video = candidates[index];
      await processVideo(input, hooks, result, video, index, candidates.length, douyinMediaUrls.get(video.id));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
}

async function preloadDouyinMediaUrls(
  account: Account,
  candidates: Video[],
  result: BatchTranscribeResult,
  signal?: AbortSignal
) {
  const pendingVideos = candidates.filter((video) => !videoHasTranscript(video));
  const urls = new Map<string, string>();
  if (!pendingVideos.length) return urls;

  const startedAt = Date.now();
  try {
    const lookupLimit = getDouyinVideoDownloadLookupLimit(pendingVideos);
    const mediaUrlsByAwemeId = await getDouyinVideoDownloadUrls(account, { limit: lookupLimit, signal });
    for (const video of pendingVideos) {
      const awemeId = getDouyinAwemeId(video);
      const mediaUrl = awemeId ? mediaUrlsByAwemeId.get(awemeId) : "";
      if (mediaUrl) urls.set(video.id, mediaUrl);
    }
    result.timings?.push({ stage: "douyin-preload-media", ms: Date.now() - startedAt });
  } catch (error) {
    if (isAbortError(error)) throw error;
    result.timings?.push({ stage: "douyin-preload-media-failed", ms: Date.now() - startedAt });
  }

  return urls;
}

async function processVideo(
  input: BatchTranscribeInput,
  hooks: BatchTranscribeHooks,
  result: BatchTranscribeResult,
  video: Video,
  index: number,
  total: number,
  douyinMediaUrl?: string
) {
  hooks.onVideoStart?.({ index, total, video });
  throwIfAborted(hooks.signal);

  if (videoHasTranscript(video)) {
    result.skipped += 1;
    const event = buildVideoEvent(result, {
      video,
      status: "skipped",
      source: video.transcriptSource || "existing"
    });
    appendVideoResult(result, event);
    hooks.onVideoResult?.(event);
    return;
  }

  try {
    const startedAt = Date.now();
    throwIfAborted(hooks.signal);
    const transcribed = await transcribeVideo({
      platform: input.platform,
      accountId: input.accountId,
      videoId: video.id,
      douyinMediaUrl,
      allowRemoteDownload: true,
      signal: hooks.signal
    });
    const timings = "timings" in transcribed ? transcribed.timings : undefined;
    result.completed += 1;
    const event = buildVideoEvent(result, {
      video,
      status: "completed",
      source: transcribed.video.transcriptSource || transcribed.usedProvider,
      timings: timings || [{ stage: "total", ms: Date.now() - startedAt }]
    });
    appendVideoResult(result, event);
    hooks.onVideoResult?.(event);
  } catch (error) {
    if (isAbortError(error)) throw error;
    result.failed += 1;
    const message = error instanceof Error ? error.message : "转写失败";
    if (input.platform === "douyin") {
      await markTranscriptFailed(input.platform, input.accountId, video.id, message).catch(() => undefined);
    }
    const event = buildVideoEvent(result, {
      video,
      status: "failed",
      error: message
    });
    appendVideoResult(result, event);
    hooks.onVideoResult?.(event);
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted|任务已停止/i.test(error.message));
}

function createAbortError() {
  const error = new Error("任务已停止");
  error.name = "AbortError";
  return error;
}

function appendVideoResult(result: BatchTranscribeResult, event: BatchTranscribeVideoEvent) {
  const item: BatchVideoResult = {
    videoId: event.videoId,
    title: event.title,
    status: event.status,
    source: event.source,
    error: event.error,
    timings: event.timings
  };
  result.results.push(item);
}

function pushTiming(result: BatchTranscribeResult, stage: string, startedAt: number) {
  result.timings?.push({ stage, ms: Date.now() - startedAt });
}

function resolveDouyinBatchConcurrency() {
  const parsed = Number.parseInt(process.env.DOUYIN_TRANSCRIBE_CONCURRENCY || "", 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(Math.max(parsed, 1), 4);
}

function videoHasTranscript(video: Pick<Video, "transcriptStatus" | "transcriptPath">) {
  return video.transcriptStatus === "completed" || Boolean(video.transcriptPath);
}

function buildVideoEvent(
  result: Pick<BatchTranscribeResult, "completed" | "skipped" | "failed">,
  input: {
    video: Video;
    status: BatchTranscribeVideoEvent["status"];
    source?: BatchTranscribeVideoEvent["source"];
    error?: string;
    timings?: Timing[];
  }
): BatchTranscribeVideoEvent {
  return {
    phase: "video",
    videoId: input.video.id,
    title: input.video.title,
    status: input.status,
    source: input.source,
    error: input.error,
    timings: input.timings,
    completed: result.completed,
    skipped: result.skipped,
    failed: result.failed
  };
}
