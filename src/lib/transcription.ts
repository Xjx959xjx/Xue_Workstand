import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  buildOpenCliBrowserArgs,
  getBilibiliVideoStatsByUrl,
  getBilibiliVideoReference,
  checkDouyinVideoAvailability,
  getBilibiliSubtitle,
  getDouyinVideoStatsByUrl,
  parseOpenCliJsonish,
  refreshDouyinVideoDownloadUrl,
  resolveOpenCliCommand
} from "./opencli";
import {
  browserUserAgent,
  buildRemoteAssetRequestHeaders,
  detectPlatformFromLink,
  extractBvid,
  inferRemoteContentType,
  inferRemoteFileExtension,
  isLikelyAudioMediaUrl,
  normalizeRemoteImageUrl,
  selectRemoteVideoMediaUrl,
  sortRemoteAudioMediaUrls,
  videoMediaUrlScore
} from "./platform-links";
import { getVideo, markTranscriptFailed, saveTranscript } from "./storage";
import { cleanTranscriptText } from "./transcript-cleaning";
import { Account, Platform, Video } from "./types";

const execFileAsync = promisify(execFile);
const HIDDEN_CHILD_PROCESS_OPTIONS = { windowsHide: true };
type Timing = { stage: string; ms: number };
type AbortableOptions = {
  signal?: AbortSignal;
};

function openCliExecArgs(args: string[]) {
  const runtime = resolveOpenCliCommand();
  return {
    command: runtime.command,
    args: [...runtime.argsPrefix, ...args]
  };
}

export type LinkTranscriptionResult = {
  url: string;
  resolvedUrl?: string;
  platform: Platform | "unknown";
  title?: string;
  sourceAccountName?: string;
  coverUrl?: string;
  mediaUrls?: string[];
  text: string;
  source: "platform_subtitle" | "volcengine" | "metadata";
  metadataTitle?: string;
  fallback?: boolean;
  fallbackReason?: string;
  timings?: Timing[];
};

type LinkMediaInfo = {
  mediaId?: string;
  title?: string;
  sourceAccountName?: string;
  coverUrl?: string;
  mediaUrls: string[];
};

export type LinkSourceAssetKind = "video" | "cover" | "audio";

export type LinkSourceResolvedMedia = {
  url: string;
  resolvedUrl?: string;
  platform: Platform | "unknown";
  title?: string;
  sourceAccountName?: string;
  coverUrl?: string;
  mediaUrls: string[];
};

export type LinkSourceDownloadAsset = {
  kind: LinkSourceAssetKind;
  fileName: string;
  contentType: string;
  filePath?: string;
  remoteUrl?: string;
  requestHeaders?: Record<string, string>;
  cleanupTargets?: string[];
};

function transcriptionConfig() {
  const pollIntervalMs = Number.parseInt(process.env.VOLCENGINE_ASR_POLL_INTERVAL_MS || "", 10);
  const maxPollAttempts = Number.parseInt(process.env.VOLCENGINE_ASR_MAX_POLL_ATTEMPTS || "", 10);
  const timeoutMs = Number.parseInt(process.env.VOLCENGINE_ASR_REQUEST_TIMEOUT_MS || "", 10);
  const retryCount = Number.parseInt(process.env.VOLCENGINE_ASR_RETRY_COUNT || "", 10);

  return {
    apiKey: process.env.VOLCENGINE_ASR_API_KEY || process.env.VOLCENGINE_API_KEY || "",
    appKey: process.env.VOLCENGINE_ASR_APP_KEY || "",
    accessKey: process.env.VOLCENGINE_ASR_ACCESS_KEY || "",
    uid: process.env.VOLCENGINE_ASR_UID || "",
    resourceId: process.env.VOLCENGINE_ASR_RESOURCE_ID || "volc.seedasr.auc",
    submitUrl:
      process.env.VOLCENGINE_ASR_SUBMIT_URL ||
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit",
    queryUrl:
      process.env.VOLCENGINE_ASR_QUERY_URL ||
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query",
    audioFormat: normalizeVolcengineAudioFormat(process.env.VOLCENGINE_ASR_AUDIO_FORMAT),
    pollIntervalMs: Number.isFinite(pollIntervalMs) ? Math.max(pollIntervalMs, 500) : 1000,
    maxPollAttempts: Number.isFinite(maxPollAttempts) ? Math.max(maxPollAttempts, 1) : 120,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(timeoutMs, 5000) : 30000,
    retryCount: Number.isFinite(retryCount) ? Math.max(0, Math.min(retryCount, 3)) : 2
  };
}

export async function transcribeVideo(input: {
  platform: Platform;
  accountId: string;
  videoId: string;
  mediaPath?: string;
  mediaUrl?: string;
  douyinMediaUrl?: string;
  allowRemoteDownload?: boolean;
  signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const timings: Timing[] = [];
  const totalStartedAt = Date.now();
  const { account, video } = await getVideo(input.platform, input.accountId, input.videoId);
  timings.push({ stage: "load-video", ms: Date.now() - totalStartedAt });
  const cleanupTargets: string[] = [];
  let hadBilibiliSubtitle = false;
  let bilibiliSubtitleError = "";

  if (input.platform === "bilibili") {
    let subtitle = "";
    try {
      subtitle = await getBilibiliSubtitle(video, { signal: input.signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      bilibiliSubtitleError = formatErrorDetail(error);
    }
    throwIfAborted(input.signal);
    if (subtitle.trim()) {
      hadBilibiliSubtitle = true;
      const cleaned = await cleanTranscriptText({
        platform: input.platform,
        title: video.title,
        text: subtitle,
        signal: input.signal
      });
      throwIfAborted(input.signal);
      return {
        ...(await saveTranscript({
          platform: input.platform,
          accountId: input.accountId,
          videoId: input.videoId,
          text: cleaned.text,
          source: "platform_subtitle"
        })),
        usedProvider: "bilibili-subtitle",
        transcriptCleaning: {
          fallback: cleaned.fallback,
          fallbackReason: cleaned.fallbackReason,
          usedModel: cleaned.usedModel
        }
      };
    }
  }

  let mediaPath = input.mediaPath || "";
  let mediaError = "";

  try {
    throwIfAborted(input.signal);
    const shouldDownloadRemote =
      input.allowRemoteDownload || (input.platform === "douyin" && Boolean(input.douyinMediaUrl));
    if (!mediaPath && shouldDownloadRemote) {
      if (input.platform === "bilibili") {
        try {
          const prepared = await downloadBilibiliAudio(video, { signal: input.signal });
          mediaPath = prepared.mediaPath;
          timings.push(...prepared.timings);
          cleanupTargets.push(...prepared.cleanupTargets);
        } catch (error) {
          if (isAbortError(error)) throw error;
          mediaError = error instanceof Error ? error.message : "B站音频提取失败";
        }
      } else {
        try {
          const prepared = await downloadDouyinAudio(account, video, input.douyinMediaUrl, {
            signal: input.signal
          });
          mediaPath = prepared.mediaPath;
          timings.push(...prepared.timings);
          cleanupTargets.push(mediaPath);
        } catch (error) {
          if (isAbortError(error)) throw error;
          mediaError = error instanceof Error ? error.message : "下载音频失败";
        }
      }
    }

    if (!mediaPath && input.mediaUrl) {
      try {
        throwIfAborted(input.signal);
        const prepared = await downloadRemoteAudio(input.mediaUrl, `${input.videoId}.mp3`, {
          signal: input.signal
        });
        mediaPath = prepared.mediaPath;
        timings.push({ stage: "download-media-url-audio", ms: prepared.ms });
        cleanupTargets.push(mediaPath);
      } catch (error) {
        if (isAbortError(error)) throw error;
        mediaError = error instanceof Error ? error.message : "下载音频失败";
      }
    }

    if (!mediaPath) {
      if (input.platform === "douyin") {
        const availability = await checkDouyinVideoAvailability(account, video);
        if (availability.visible === false) {
          const reason = `没有取得可转写媒体地址：${availability.reason}`;
          await markTranscriptFailed(input.platform, input.accountId, input.videoId, reason);
          throw new Error(reason);
        }
        if (availability.visible === true && availability.reason) {
          mediaError = mediaError ? `${mediaError}；${availability.reason}` : availability.reason;
        }
      }
      const reason = buildMissingMediaReason({
        platform: input.platform,
        mediaError,
        hadBilibiliSubtitle,
        bilibiliSubtitleError
      });
      await markTranscriptFailed(input.platform, input.accountId, input.videoId, reason);
      throw new Error(reason);
    }

    try {
      throwIfAborted(input.signal);
      const transcribeStartedAt = Date.now();
      const preparedForAsr = await prepareAudioForVolcengine(mediaPath, { signal: input.signal });
      if (preparedForAsr.cleanupPath) cleanupTargets.push(preparedForAsr.cleanupPath);
      timings.push(...preparedForAsr.timings);
      const volcengine = await transcribeWithVolcengine(preparedForAsr.mediaPath, { signal: input.signal });
      const text = volcengine.text;
      timings.push(...volcengine.timings);
      timings.push({ stage: "volcengine-transcribe", ms: Date.now() - transcribeStartedAt });
      throwIfAborted(input.signal);
      const cleanStartedAt = Date.now();
      const cleaned = await cleanTranscriptText({
        platform: input.platform,
        title: video.title,
        text,
        signal: input.signal
      });
      timings.push({ stage: "clean-transcript", ms: Date.now() - cleanStartedAt });
      const saveStartedAt = Date.now();
      throwIfAborted(input.signal);
      const saved = await saveTranscript({
        platform: input.platform,
        accountId: input.accountId,
        videoId: input.videoId,
        text: cleaned.text,
        source: "volcengine"
      });
      timings.push({ stage: "save-transcript", ms: Date.now() - saveStartedAt });
      return {
        ...saved,
        usedProvider: "volcengine",
        timings: [...timings, { stage: "total", ms: Date.now() - totalStartedAt }],
        transcriptCleaning: {
          fallback: cleaned.fallback,
          fallbackReason: cleaned.fallbackReason,
          usedModel: cleaned.usedModel
        }
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      const reason = buildProviderErrorReason(input.platform, error, bilibiliSubtitleError);
      await markTranscriptFailed(input.platform, input.accountId, input.videoId, reason);
      throw new Error(reason);
    }
  } finally {
    await Promise.all(
      cleanupTargets.map((target) =>
        fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
      )
    );
  }
}

export async function transcribeLinkSource(input: {
  url: string;
  titleHint?: string;
  analyzeVideo?: boolean;
  signal?: AbortSignal;
}): Promise<LinkTranscriptionResult> {
  throwIfAborted(input.signal);
  const startedAt = Date.now();
  const resolvedUrl = await resolveShareUrl(input.url, { signal: input.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return input.url;
  });
  const platform = detectPlatformFromLink(resolvedUrl || input.url);
  let subtitleResult: LinkTranscriptionResult | null = null;
  let bilibiliSubtitleError = "";

  if (platform === "bilibili") {
    let subtitle = "";
    try {
      subtitle = await getBilibiliSubtitle({
        id: resolvedUrl,
        url: resolvedUrl,
        raw: resolvedUrl
      } as Video, { signal: input.signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      bilibiliSubtitleError = formatErrorDetail(error);
    }
    if (subtitle.trim()) {
      const metadata = await resolveLinkStatsMetadata(resolvedUrl || input.url, platform, { signal: input.signal });
      const cleaned = await cleanTranscriptText({
        platform,
        title: input.titleHint || metadata.title,
        text: subtitle,
        signal: input.signal
      });
      subtitleResult = {
        url: input.url,
        resolvedUrl,
        platform,
        title: input.titleHint || metadata.title,
        sourceAccountName: metadata.sourceAccountName,
        coverUrl: metadata.coverUrl,
        text: cleaned.text,
        source: "platform_subtitle",
        fallback: cleaned.fallback,
        fallbackReason: cleaned.fallbackReason,
        timings: [{ stage: "total", ms: Date.now() - startedAt }]
      };
      if (!input.analyzeVideo) return subtitleResult;
    }
  }

  if (platform !== "douyin" && platform !== "bilibili") {
    throw new Error(`暂不支持从这个链接提取视频文稿：${input.url}`);
  }

  const media = await resolveLinkMediaUrl({
    url: input.url,
    resolvedUrl,
    platform,
    signal: input.signal
  });
  if (subtitleResult) {
    return {
      ...subtitleResult,
      title: media.title || subtitleResult.title,
      sourceAccountName: media.sourceAccountName || subtitleResult.sourceAccountName,
      coverUrl: media.coverUrl || subtitleResult.coverUrl,
      mediaUrls: media.mediaUrls,
      timings: [{ stage: "resolve-video-media", ms: Date.now() - startedAt }]
    };
  }
  if (!media.mediaUrls.length) {
    if (media.title) {
      const fallbackReason = buildLinkMetadataOnlyReason({
        title: media.title,
        bilibiliSubtitleError
      });
      return {
        url: input.url,
        resolvedUrl,
        platform,
        title: media.title,
        sourceAccountName: media.sourceAccountName,
        coverUrl: media.coverUrl,
        mediaUrls: [],
        text: "",
        source: "metadata",
        metadataTitle: media.title,
        fallback: true,
        fallbackReason
      };
    }
    throw new Error(buildLinkMissingMediaReason(input.url, bilibiliSubtitleError));
  }

  const cleanupTargets: string[] = [];
  try {
    throwIfAborted(input.signal);
    const downloaded = await downloadFirstAvailableRemoteAudio(
      media.mediaUrls,
      `${safeFileName(media.mediaId || "link-video")}.mp3`,
      { signal: input.signal }
    );
    cleanupTargets.push(downloaded.mediaPath);
    const preparedForAsr = await prepareAudioForVolcengine(downloaded.mediaPath, { signal: input.signal });
    if (preparedForAsr.cleanupPath) cleanupTargets.push(preparedForAsr.cleanupPath);
    const volcengine = await transcribeWithVolcengine(preparedForAsr.mediaPath, { signal: input.signal });
    throwIfAborted(input.signal);
    const cleaned = await cleanTranscriptText({
      platform,
      title: media.title || input.titleHint,
      text: volcengine.text,
      signal: input.signal
    });
    return {
      url: input.url,
      resolvedUrl,
      platform,
      title: media.title || input.titleHint,
      sourceAccountName: media.sourceAccountName,
      coverUrl: media.coverUrl,
      mediaUrls: media.mediaUrls,
      text: cleaned.text,
      source: "volcengine",
      fallback: cleaned.fallback,
      fallbackReason: cleaned.fallbackReason,
      timings: [
        { stage: "download-remote-audio", ms: downloaded.ms },
        ...(downloaded.attempts.length > 1 ? [{ stage: `media-url-attempts-${downloaded.attempts.length}`, ms: 0 }] : []),
        ...preparedForAsr.timings,
        ...volcengine.timings,
        { stage: "total", ms: Date.now() - startedAt }
      ]
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (platform === "bilibili" && bilibiliSubtitleError) {
      throw new Error(`B站字幕抓取失败：${bilibiliSubtitleError}；音频转写也失败：${formatErrorDetail(error)}`);
    }
    throw error;
  } finally {
    await Promise.all(cleanupTargets.map((target) => fs.rm(target, { recursive: true, force: true }).catch(() => undefined)));
  }
}

export async function resolveLinkSourceAccountName(url: string) {
  const inputUrl = url.trim();
  if (!inputUrl) return "";
  const resolvedUrl = await resolveShareUrl(inputUrl).catch(() => inputUrl);
  const platform = detectPlatformFromLink(resolvedUrl || inputUrl);
  if (platform !== "douyin" && platform !== "bilibili") return "";
  const metadata = await resolveLinkStatsMetadata(resolvedUrl || inputUrl, platform);
  if (metadata.sourceAccountName) return metadata.sourceAccountName;
  const media = await resolveLinkMediaUrl({
    url: inputUrl,
    resolvedUrl,
    platform
  }).catch(() => null);
  return media?.sourceAccountName?.trim() || "";
}

export function isSupportedVideoSourceLink(url: string) {
  return detectPlatformFromLink(url) !== "unknown";
}

export async function resolveLinkSourceMedia(input: {
  url: string;
  resolvedUrl?: string;
  platform?: Platform | "unknown";
  signal?: AbortSignal;
}): Promise<LinkSourceResolvedMedia> {
  const resolvedUrl = input.resolvedUrl || (await resolveShareUrl(input.url, { signal: input.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return input.url;
  }));
  const platform = input.platform && input.platform !== "unknown"
    ? input.platform
    : detectPlatformFromLink(resolvedUrl || input.url);
  if (platform !== "douyin" && platform !== "bilibili") {
    return {
      url: input.url,
      resolvedUrl,
      platform,
      title: undefined,
      sourceAccountName: undefined,
      coverUrl: undefined,
      mediaUrls: []
    };
  }
  const media = await resolveLinkMediaUrl({
    url: input.url,
    resolvedUrl,
    platform,
    signal: input.signal
  });
  return {
    url: input.url,
    resolvedUrl,
    platform,
    title: media.title,
    sourceAccountName: media.sourceAccountName,
    coverUrl: media.coverUrl,
    mediaUrls: media.mediaUrls
  };
}

export async function prepareLinkSourceDownload(input: {
  url: string;
  kind: LinkSourceAssetKind;
}, options: AbortableOptions = {}): Promise<LinkSourceDownloadAsset> {
  const media = await resolveLinkSourceMedia({ url: input.url, signal: options.signal });
  if (media.platform !== "bilibili" && media.platform !== "douyin") {
    throw new Error("暂不支持下载这个链接，请粘贴 B站或抖音单条视频链接。");
  }

  const baseName = makeLinkSourceFileBaseName(media);

  if (input.kind === "cover") {
    const coverUrl = normalizeRemoteImageUrl(media.coverUrl || "");
    if (!coverUrl) {
      throw new Error("没有解析到这条视频的封面地址。");
    }
    return {
      kind: input.kind,
      fileName: `${baseName}${inferRemoteFileExtension(coverUrl, "image")}`,
      contentType: inferRemoteContentType(coverUrl, "image"),
      remoteUrl: coverUrl,
      requestHeaders: buildRemoteAssetRequestHeaders(coverUrl)
    };
  }

  if (input.kind === "audio") {
    const audioUrls = media.platform === "bilibili" ? selectRemoteAudioMediaUrls(media.mediaUrls) : media.mediaUrls;
    if (!audioUrls.length) {
      throw new Error("没有解析到可提取音频的媒体地址。");
    }
    const downloaded = await downloadFirstAvailableRemoteAudio(
      audioUrls,
      `${baseName}.mp3`,
      options
    );
    return {
      kind: input.kind,
      fileName: `${baseName}.mp3`,
      contentType: "audio/mpeg",
      filePath: downloaded.mediaPath,
      cleanupTargets: [downloaded.mediaPath]
    };
  }

  if (media.platform === "bilibili") {
    throwIfAborted(options.signal);
    const downloaded = await downloadRemoteBilibiliVideo(media, `${baseName}.mp4`, options);
    throwIfAborted(options.signal);
    return {
      kind: input.kind,
      fileName: `${baseName}.mp4`,
      contentType: "video/mp4",
      filePath: downloaded.filePath,
      cleanupTargets: [downloaded.filePath]
    };
  }

  const videoUrl = selectRemoteVideoMediaUrl(media.mediaUrls);
  if (!videoUrl) {
    throw new Error("没有解析到可下载的视频地址。");
  }

  return {
    kind: input.kind,
    fileName: `${baseName}${inferRemoteFileExtension(videoUrl, "video")}`,
    contentType: inferRemoteContentType(videoUrl, "video"),
    remoteUrl: videoUrl,
    requestHeaders: buildRemoteAssetRequestHeaders(videoUrl)
  };
}

async function transcribeWithVolcengine(
  mediaPath: string,
  options: AbortableOptions = {}
): Promise<{ text: string; timings: Timing[] }> {
  throwIfAborted(options.signal);
  const config = transcriptionConfig();
  if (!config.apiKey && (!config.appKey || !config.accessKey)) {
    throw new Error("未配置 VOLCENGINE_ASR_API_KEY，无法调用火山引擎录音文件识别 2.0");
  }

  const timings: Timing[] = [];
  const readStartedAt = Date.now();
  const audioBytes = await fs.readFile(mediaPath);
  timings.push({ stage: "read-audio-file", ms: Date.now() - readStartedAt });
  const encodeStartedAt = Date.now();
  const audioData = audioBytes.toString("base64");
  timings.push({ stage: "encode-audio-base64", ms: Date.now() - encodeStartedAt });
  const body = {
    user: {
      uid: config.uid || config.apiKey || config.appKey || "style-library"
    },
    audio: {
      format: config.audioFormat || inferVolcengineAudioFormat(mediaPath),
      data: audioData
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      show_utterances: false
    }
  };

  const startedAt = Date.now();
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= config.retryCount) {
    const taskId = randomUUID();
    const headers = buildVolcengineHeaders(config, taskId);
    const attemptPrefix = attempt > 0 ? `retry-${attempt + 1}-` : "";

    try {
      const submitStartedAt = Date.now();
      const submitResponse = await fetchWithTimeout(
        config.submitUrl,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        },
        config.timeoutMs,
        options.signal
      );
      await assertVolcengineResponse(submitResponse, "提交火山引擎转写任务", ["20000000"]);
      timings.push({ stage: `${attemptPrefix}volcengine-submit`, ms: Date.now() - submitStartedAt });

      const queryStartedAt = Date.now();
      let pollWaitMs = 0;
      let queryRequestMs = 0;
      for (let pollAttempt = 0; pollAttempt < config.maxPollAttempts; pollAttempt += 1) {
        throwIfAborted(options.signal);
        if (pollAttempt > 0) {
          const waitStartedAt = Date.now();
          await sleep(config.pollIntervalMs, options.signal);
          pollWaitMs += Date.now() - waitStartedAt;
        }
        const queryRequestStartedAt = Date.now();
        const queryResponse = await fetchWithTimeout(
          config.queryUrl,
          {
            method: "POST",
            headers,
            body: "{}"
          },
          config.timeoutMs,
          options.signal
        );
        queryRequestMs += Date.now() - queryRequestStartedAt;
        const statusCode = getVolcengineHeader(queryResponse, "X-Api-Status-Code");
        if (statusCode === "20000001" || statusCode === "20000002") continue;
        await assertVolcengineResponse(queryResponse, "查询火山引擎转写结果", ["20000000"]);
        const data = (await queryResponse.json()) as unknown;
        const text = extractVolcengineTranscript(data);
        if (!text.trim()) {
          throw new Error("火山引擎没有返回转写文本");
        }
        timings.push({ stage: `${attemptPrefix}volcengine-query-requests`, ms: queryRequestMs });
        if (pollWaitMs) timings.push({ stage: `${attemptPrefix}volcengine-poll-wait`, ms: pollWaitMs });
        timings.push({ stage: `${attemptPrefix}volcengine-query`, ms: Date.now() - queryStartedAt });
        return { text: text.trim(), timings };
      }

      throw new Error("火山引擎转写任务查询超时，请稍后重试。");
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (!shouldRetryVolcengineError(error) || attempt >= config.retryCount) {
        break;
      }
      const backoffMs = 1200 * (attempt + 1);
      timings.push({ stage: `${attemptPrefix}volcengine-retry-wait`, ms: backoffMs });
      await sleep(backoffMs, options.signal);
      attempt += 1;
    }
  }

  timings.push({ stage: "volcengine-total-attempts", ms: Date.now() - startedAt });
  throw lastError instanceof Error ? lastError : new Error("火山引擎转写失败");
}

async function prepareAudioForVolcengine(mediaPath: string, options: AbortableOptions = {}): Promise<{
  mediaPath: string;
  cleanupPath?: string;
  timings: Timing[];
}> {
  throwIfAborted(options.signal);
  if (isVolcengineSupportedAudio(mediaPath)) {
    return { mediaPath, timings: [] };
  }

  const startedAt = Date.now();
  const fileName = `${path.basename(mediaPath).replace(/[^\w.-]+/g, "-") || "media"}.mp3`;
  const converted = await extractLocalAudio(mediaPath, fileName, options);
  return {
    mediaPath: converted.mediaPath,
    cleanupPath: converted.mediaPath,
    timings: [{ stage: "prepare-local-audio", ms: Date.now() - startedAt }]
  };
}

function isVolcengineSupportedAudio(mediaPath: string) {
  return /\.mp3(\?|$)/i.test(mediaPath);
}

function buildVolcengineHeaders(
  config: ReturnType<typeof transcriptionConfig>,
  taskId: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Resource-Id": config.resourceId,
    "X-Api-Request-Id": taskId,
    "X-Api-Sequence": "-1"
  };
  if (config.apiKey) {
    headers["X-Api-Key"] = config.apiKey;
  } else {
    headers["X-Api-App-Key"] = config.appKey;
    headers["X-Api-Access-Key"] = config.accessKey;
  }
  return headers;
}

async function assertVolcengineResponse(response: Response, action: string, okCodes: string[]) {
  const statusCode = getVolcengineHeader(response, "X-Api-Status-Code");
  const message = getVolcengineHeader(response, "X-Api-Message");
  if (response.ok && okCodes.includes(statusCode)) return;

  const body = await response.text().catch(() => "");
  const logId = getVolcengineHeader(response, "X-Tt-Logid");
  const detail = [
    statusCode ? `状态码 ${statusCode}` : `HTTP ${response.status}`,
    message || "",
    logId ? `logid ${logId}` : "",
    body ? body.slice(0, 500) : ""
  ]
    .filter(Boolean)
    .join("，");
  throw new Error(`${action}失败：${detail || "未知错误"}`);
}

function getVolcengineHeader(response: Response, name: string) {
  return response.headers.get(name) || response.headers.get(name.toLowerCase()) || "";
}

function extractVolcengineTranscript(data: unknown): string {
  const object = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const result = object.result;
  const directText = readTextField(result) || readTextField(object);
  if (directText) return directText;

  const utteranceText = extractUtteranceText(result) || extractUtteranceText(object);
  if (utteranceText) return utteranceText;

  if (Array.isArray(result)) {
    const pieces = result
      .map((item) => readTextField(item) || extractUtteranceText(item))
      .filter(Boolean);
    if (pieces.length) return pieces.join("\n");
  }

  return "";
}

function readTextField(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const text = (value as Record<string, unknown>).text;
  return typeof text === "string" ? text.trim() : "";
}

function extractUtteranceText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const utterances = (value as Record<string, unknown>).utterances;
  if (!Array.isArray(utterances)) return "";
  return utterances
    .map((item) => readTextField(item))
    .filter(Boolean)
    .join("\n");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    throwIfAborted(signal);
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`火山引擎请求超时：${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function shouldRetryVolcengineError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|超时|timeout|503|502|504|socket/i.test(message);
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError();
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted|任务已停止/i.test(error.message));
}

function ignoreNonAbortError(error: unknown) {
  if (isAbortError(error)) throw error;
}

function createAbortError() {
  const error = new Error("任务已停止");
  error.name = "AbortError";
  return error;
}

function formatErrorDetail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.replace(/\s+/g, " ").trim();
}

async function resolveShareUrl(url: string, options: AbortableOptions = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    throwIfAborted(options.signal);
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": browserUserAgent()
      }
    });
    return response.url || url;
  } catch {
    if (options.signal?.aborted) throw createAbortError();
    return url;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    clearTimeout(timeout);
  }
}

async function resolveLinkMediaUrl(input: {
  url: string;
  resolvedUrl: string;
  platform: Platform;
  signal?: AbortSignal;
}): Promise<LinkMediaInfo> {
  throwIfAborted(input.signal);
  if (input.platform === "douyin") {
    const media = await resolveDouyinLinkMedia(input.resolvedUrl || input.url, { signal: input.signal });
    return hydrateLinkMediaInfo(media, input.resolvedUrl || input.url, input.platform, { signal: input.signal });
  }

  if (input.platform === "bilibili") {
    const media = await resolveBilibiliLinkMedia(input.resolvedUrl || input.url, { signal: input.signal });
    return hydrateLinkMediaInfo(media, input.resolvedUrl || input.url, input.platform, { signal: input.signal });
  }

  return resolveGenericLinkMedia(input.resolvedUrl || input.url, { signal: input.signal });
}

async function hydrateLinkMediaInfo(
  media: LinkMediaInfo,
  url: string,
  platform: Platform,
  options: AbortableOptions = {}
): Promise<LinkMediaInfo> {
  if (media.title && media.sourceAccountName && media.coverUrl) {
    return { ...media, coverUrl: normalizeRemoteImageUrl(media.coverUrl) };
  }
  throwIfAborted(options.signal);
  const metadata = await resolveLinkStatsMetadata(url, platform, { signal: options.signal });
  throwIfAborted(options.signal);
  return {
    ...media,
    title: media.title || metadata.title,
    sourceAccountName: media.sourceAccountName || metadata.sourceAccountName,
    coverUrl: normalizeRemoteImageUrl(media.coverUrl || metadata.coverUrl || "") || undefined
  };
}

async function resolveLinkStatsMetadata(
  url: string,
  platform: Platform,
  options: AbortableOptions = {}
): Promise<Pick<LinkMediaInfo, "title" | "sourceAccountName" | "coverUrl">> {
  if (!url.trim()) return {};
  throwIfAborted(options.signal);
  if (platform === "bilibili") {
    const stats = await getBilibiliVideoStatsByUrl(url, { signal: options.signal }).catch((error) => {
      if (isAbortError(error)) throw error;
      return null;
    });
    const reference = await getBilibiliVideoReference({
      id: url,
      url,
      raw: url,
      title: stats?.title || "",
      coverUrl: ""
    }, { signal: options.signal }).catch((error) => {
      if (isAbortError(error)) throw error;
      return null;
    });
    return {
      title: stats?.title?.trim() || undefined,
      sourceAccountName: stats?.authorName?.trim() || undefined,
      coverUrl: normalizeRemoteImageUrl(reference?.thumbnail || "") || undefined
    };
  }
  if (platform === "douyin") {
    const stats = await getDouyinVideoStatsByUrl(url, { signal: options.signal }).catch((error) => {
      if (isAbortError(error)) throw error;
      return null;
    });
    return {
      title: stats?.title?.trim() || undefined,
      sourceAccountName: stats?.authorName?.trim() || undefined,
      coverUrl: undefined
    };
  }
  return {};
}

async function resolveBilibiliLinkMedia(url: string, options: AbortableOptions = {}) {
  const workspace = `bilibili-link-transcribe-${process.pid}-${Date.now()}-${safeFileName(url).slice(0, 18)}`;

  try {
    throwIfAborted(options.signal);
    const openArgs = openCliExecArgs(buildOpenCliBrowserArgs(workspace, "open", [url], {
      window: "background"
    }));
    await execFileAsync(openArgs.command, openArgs.args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024 * 8,
      timeout: 30_000,
      signal: options.signal
    });
    const waitArgs = openCliExecArgs(buildOpenCliBrowserArgs(workspace, "wait", ["time", "3"]));
    await execFileAsync(waitArgs.command, waitArgs.args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024,
      timeout: 12_000,
      signal: options.signal
    }).catch(ignoreNonAbortError);
    const evalArgs = openCliExecArgs(buildOpenCliBrowserArgs(workspace, "eval", [BILIBILI_LINK_MEDIA_EXTRACT_JS]));
    const { stdout } = await execFileAsync(
      evalArgs.command,
      evalArgs.args,
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        maxBuffer: 1024 * 1024 * 20,
        timeout: 30_000,
        signal: options.signal
      }
    );
    const data = parseOpenCliJsonish(stdout.trim());
    const object = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const mediaUrls = Array.isArray(object.mediaUrls) ? object.mediaUrls.map((value) => String(value || "")) : [];
    return {
      mediaId: String(object.bvid || extractBvid(url) || ""),
      title: normalizeTitle(String(object.title || object.description || "")),
      sourceAccountName: normalizeTitle(String(object.sourceAccountName || "")),
      coverUrl: normalizeRemoteImageUrl(String(object.coverUrl || "")),
      mediaUrls: sortRemoteAudioMediaUrls(mediaUrls)
    };
  } finally {
    const closeArgs = openCliExecArgs(buildOpenCliBrowserArgs(workspace, "close"));
    await execFileAsync(closeArgs.command, closeArgs.args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024,
      timeout: 5_000
    }).catch(() => undefined);
  }
}

async function resolveDouyinLinkMedia(url: string, options: AbortableOptions = {}) {
  const workspace = `douyin-link-transcribe-${process.pid}-${Date.now()}-${safeFileName(url).slice(0, 18)}`;

  try {
    throwIfAborted(options.signal);
    const openArgs = openCliExecArgs(buildOpenCliBrowserArgs(workspace, "open", [url], {
      window: "background"
    }));
    await execFileAsync(openArgs.command, openArgs.args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024 * 8,
      timeout: 30_000,
      signal: options.signal
    });
    const waitArgs = openCliExecArgs(buildOpenCliBrowserArgs(workspace, "wait", ["time", "2"]));
    await execFileAsync(waitArgs.command, waitArgs.args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
      signal: options.signal
    }).catch(ignoreNonAbortError);
    const evalArgs = openCliExecArgs(buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_LINK_MEDIA_EXTRACT_JS]));
    const { stdout } = await execFileAsync(
      evalArgs.command,
      evalArgs.args,
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        maxBuffer: 1024 * 1024 * 20,
        timeout: 30_000,
        signal: options.signal
      }
    );
    const data = parseOpenCliJsonish(stdout.trim());
    const object = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const mediaUrls = Array.isArray(object.mediaUrls) ? object.mediaUrls.map((value) => String(value || "")) : [];
    return {
      mediaId: String(object.awemeId || ""),
      title: normalizeTitle(String(object.title || object.description || "")),
      sourceAccountName: normalizeTitle(String(object.sourceAccountName || "")),
      coverUrl: normalizeRemoteImageUrl(String(object.coverUrl || "")),
      mediaUrls: sortRemoteAudioMediaUrls(mediaUrls)
    };
  } finally {
    const closeArgs = openCliExecArgs(buildOpenCliBrowserArgs(workspace, "close"));
    await execFileAsync(closeArgs.command, closeArgs.args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024,
      timeout: 5_000
    }).catch(() => undefined);
  }
}

async function resolveGenericLinkMedia(url: string, options: AbortableOptions = {}) {
  throwIfAborted(options.signal);
  const response = await fetch(url, {
    redirect: "follow",
    signal: options.signal,
    headers: {
      "User-Agent": browserUserAgent()
    }
  });
  const html = await response.text().catch(() => "");
  const mediaUrls = [
    ...Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'<>\\]+?(?:\.mp4|\.m4a|\.mp3|mime_type=(?:video|audio)_[^"'<>\\]+)/gi)).map((match) =>
      match[0].replaceAll("\\/", "/")
    )
  ];
  return {
    mediaId: response.url,
    title: normalizeTitle(extractHtmlTitle(html)),
    sourceAccountName: "",
    coverUrl: normalizeRemoteImageUrl(extractHtmlImage(html)),
    mediaUrls: sortRemoteAudioMediaUrls(mediaUrls)
  };
}

async function downloadFirstAvailableRemoteAudio(
  urls: string[],
  fileName: string,
  options: AbortableOptions = {}
) {
  const attempts: Array<{ url: string; error?: string; ms?: number }> = [];
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  let lastError: unknown;

  for (const [index, url] of uniqueUrls.entries()) {
    try {
      throwIfAborted(options.signal);
      const downloaded = await downloadRemoteAudio(url, `${index + 1}-${fileName}`, options);
      attempts.push({ url, ms: downloaded.ms });
      return { ...downloaded, attempts };
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      attempts.push({ url, error: error instanceof Error ? error.message : "音频提取失败" });
    }
  }

  const noAudioCount = attempts.filter((attempt) => /matches no streams|stream map 'a:0'|does not contain any stream/i.test(attempt.error || "")).length;
  const detail = attempts
    .map((attempt, index) => `候选 ${index + 1}：${attempt.error || "未返回音频"}`)
    .join("；");
  if (noAudioCount === attempts.length && attempts.length > 0) {
    throw new Error(`音频提取失败：已尝试 ${attempts.length} 个媒体地址，均未包含可转写音轨。${detail}`);
  }

  throw lastError instanceof Error ? lastError : new Error("音频提取失败：没有可用媒体地址");
}

const DOUYIN_LINK_MEDIA_EXTRACT_JS = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const normalizeUrl = (url) => {
    if (!url) return "";
    if (url.startsWith("//")) return "https:" + url;
    return url;
  };
  const trimCandidateUrl = (url) => (String(url || "").split(/[\\s|<>]/)[0] || "").replace(/,https?:\\/\\/.+$/i, "");
  const isImageCandidate = (url) => {
    try {
      const parsed = new URL(normalizeUrl(trimCandidateUrl(url)));
      const text = (parsed.hostname + " " + parsed.pathname + " " + parsed.search).toLowerCase();
      return (
        /douyinpic|pstatp|byteimg|tos-cn|image|img/.test(text) &&
        !/avatar|profile|user|emoji|icon|logo/.test(text) &&
        /(cover|poster|origin|image|img|tplv|tos-cn|\\.jpe?g|\\.png|\\.webp|\\.gif)/.test(text)
      );
    } catch {
      return false;
    }
  };
  const coverKeyWeight = (keyHint) => {
    const key = String(keyHint || "").toLowerCase();
    let score = 0;
    if (/origin[_-]?cover|origincover/.test(key)) score += 90;
    if (/cover|poster/.test(key)) score += 65;
    if (/image|img/.test(key)) score += 25;
    if (/thumb/.test(key)) score -= 10;
    if (/avatar|author|user|profile|icon|logo/.test(key)) score -= 140;
    return score;
  };
  const coverUrlScore = (url, keyHint = "", weight = 0) => {
    const text = String(url || "").toLowerCase();
    let score = weight + coverKeyWeight(keyHint);
    if (/origin|orig|raw/.test(text)) score += 35;
    if (/cover|poster/.test(text)) score += 30;
    if (/douyinpic|pstatp|byteimg/.test(text)) score += 20;
    if (/avatar|profile|user|emoji|icon|logo/.test(text)) score -= 160;
    if (/resize|thumb|q\\d{2}|autoq|aq:|walign/.test(text)) score -= 15;
    for (const match of text.matchAll(/(?:^|[^\\d])([1-9]\\d{2,4})(?:x|:|%3a|_)([1-9]\\d{2,4})(?:[^\\d]|$)/g)) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (Number.isFinite(width) && Number.isFinite(height)) score += Math.min(90, Math.max(width, height) / 20);
    }
    return score;
  };
  const collect = () => {
    const urls = [];
    const coverCandidates = [];
    let sourceAccountName = "";
    const pushUrl = (value) => {
      const normalized = normalizeUrl(String(value || ""));
      if (/^https?:\\/\\//i.test(normalized)) urls.push(normalized);
    };
    const pushCoverUrl = (value, keyHint = "", weight = 0) => {
      const normalized = normalizeUrl(trimCandidateUrl(String(value || "").replaceAll("\\\\/", "/")));
      if (!/^https?:\\/\\//i.test(normalized) || !isImageCandidate(normalized)) return;
      coverCandidates.push({ url: normalized, score: coverUrlScore(normalized, keyHint, weight) });
    };
    const collectCoverDeep = (value, depth = 0, keyHint = "") => {
      if (!value || depth > 8) return;
      if (typeof value === "string") {
        pushCoverUrl(value, keyHint);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 220)) collectCoverDeep(item, depth + 1, keyHint);
        return;
      }
      if (typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        const nextKey = keyHint ? keyHint + "." + key : key;
        if (/cover|poster|image|img|url|uri|origin|thumb|video|aweme|detail|data/i.test(key)) {
          collectCoverDeep(item, depth + 1, nextKey);
        }
      }
    };
    const collectAuthorDeep = (value, depth = 0) => {
      if (!value || sourceAccountName || depth > 8) return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 200)) collectAuthorDeep(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;
      const object = value;
      const candidates = [
        object.nickname,
        object.name,
        object.unique_id,
        object.author_name,
        object.user_name
      ].map(clean).filter(Boolean);
      if (candidates.length && (object.sec_uid || object.uid || object.user_id || object.short_id || object.avatar_thumb)) {
        sourceAccountName = candidates[0];
        return;
      }
      if (object.author && typeof object.author === "object") collectAuthorDeep(object.author, depth + 1);
      if (object.user && typeof object.user === "object") collectAuthorDeep(object.user, depth + 1);
      for (const [key, item] of Object.entries(object)) {
        if (/author|user|owner|account|aweme|detail|item/i.test(key)) collectAuthorDeep(item, depth + 1);
        if (sourceAccountName) return;
      }
    };
    const collectUrlsDeep = (value, depth = 0) => {
      if (!value || depth > 8) return;
      if (typeof value === "string") {
        if (/^https?:|^\\/\\//i.test(value) && /douyinvod|mime_type=video|mime_type=audio|\\/aweme\\/v1\\/play\\//i.test(value)) {
          pushUrl(value);
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 200)) collectUrlsDeep(item, depth + 1);
        return;
      }
      if (typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (/url|addr|play|download|audio|video/i.test(key)) collectUrlsDeep(item, depth + 1);
        }
      }
    };
    for (const video of Array.from(document.querySelectorAll("video"))) {
      for (const value of [video.currentSrc, video.src]) {
        if (value) pushUrl(value);
      }
      for (const source of Array.from(video.querySelectorAll("source"))) {
        const value = source.src || source.getAttribute("src") || "";
        if (value) pushUrl(value);
      }
    }
    for (const entry of performance.getEntriesByType("resource")) {
      const name = normalizeUrl(entry.name || "");
      if (/douyinvod|mime_type=video|mime_type=audio|\\/aweme\\/v1\\/play\\//i.test(name)) pushUrl(name);
    }
    const stateValues = [
      window.__INITIAL_STATE__,
      window.__INITIAL_DATA__,
      window.__RENDER_DATA__,
      window.__UNIVERSAL_DATA_FOR_REHYDRATION__,
      window.__NEXT_DATA__
    ];
    for (const value of stateValues) collectUrlsDeep(value);
    for (const value of stateValues) collectCoverDeep(value);
    for (const value of stateValues) collectAuthorDeep(value);
    for (const script of Array.from(document.querySelectorAll("script"))) {
      const text = script.textContent || "";
      if (!/aweme|play_addr|download_addr|douyinvod|url_list|douyinpic|origin_cover|cover/.test(text)) continue;
      const matches = text.match(/https?:\\\\?\\/\\\\?\\/[^"'<>\\\\]+/g) || [];
      for (const match of matches) {
        const url = match.replaceAll("\\\\/", "/");
        pushUrl(url);
        pushCoverUrl(url, "script.url");
      }
      const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);
      if (jsonMatch && jsonMatch[0].length < 8_000_000) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          collectUrlsDeep(parsed);
          collectCoverDeep(parsed);
          collectAuthorDeep(parsed);
        } catch {}
      }
    }
    const metas = Object.fromEntries(
      Array.from(document.querySelectorAll("meta[property], meta[name]"))
        .map((meta) => [meta.getAttribute("property") || meta.getAttribute("name") || "", meta.getAttribute("content") || ""])
        .filter(([key, value]) => key && value)
    );
    const metaAccountName = clean(
      metas.author ||
      metas["article:author"] ||
      metas["og:author"] ||
      document.querySelector('[data-e2e="user-name"], [class*="author"], [class*="account"]')?.textContent ||
      ""
    );
    pushCoverUrl(metas["og:image"] || "", "meta.og:image", 40);
    pushCoverUrl(metas["twitter:image"] || "", "meta.twitter:image", 35);
    pushCoverUrl(document.querySelector("video")?.poster || "", "video.poster", 55);
    const coverUrl = coverCandidates.sort((left, right) => right.score - left.score)[0]?.url || "";
    const awemeId = (location.href.match(/\\/video\\/(\\d{10,})/) || [])[1] || "";
    return {
      awemeId,
      title: clean(metas["og:title"] || document.title || ""),
      sourceAccountName: sourceAccountName || metaAccountName,
      coverUrl,
      description: clean(metas.description || metas["og:description"] || ""),
      mediaUrls: Array.from(new Set(urls)).filter((value) => /^https?:\\/\\//i.test(value))
    };
  };
  for (let i = 0; i < 8; i += 1) {
    const data = collect();
    if (data.mediaUrls.length) return data;
    const video = document.querySelector("video");
    if (video) video.play().catch(() => undefined);
    await sleep(1000);
  }
  return collect();
})()
`;

const BILIBILI_LINK_MEDIA_EXTRACT_JS = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const normalizeUrl = (url) => {
    if (!url) return "";
    if (url.startsWith("//")) return "https:" + url;
    return url;
  };
  const trimCandidateUrl = (url) => (String(url || "").split(/[\\s|<>]/)[0] || "").replace(/,https?:\\/\\/.+$/i, "");
  const isCandidate = (url) => {
    try {
      const parsed = new URL(normalizeUrl(trimCandidateUrl(url)));
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      const mimeType = (parsed.searchParams.get("mime_type") || "").toLowerCase();
      if (host === "data.bilibili.com" || path.includes("/log/")) return false;
      return (
        mimeType.startsWith("audio_") ||
        mimeType.startsWith("video_") ||
        /bilivideo|akamaized/i.test(host) ||
        /\\/upgcxcode\\/|\\/bfs\\/archive\\/|\\.m4s$|\\.mp4$|\\.m4a$|\\.mp3$/i.test(path)
      );
    } catch {
      return false;
    }
  };
  const collect = () => {
    const urls = [];
    let sourceAccountName = "";
    const pushUrl = (value) => {
      const normalized = normalizeUrl(trimCandidateUrl(String(value || "").replaceAll("\\\\/", "/")));
      if (/^https?:\\/\\//i.test(normalized) && isCandidate(normalized)) urls.push(normalized);
    };
    const collectUrlsDeep = (value, depth = 0) => {
      if (!value || depth > 8) return;
      if (typeof value === "string") {
        if (/^https?:|^\\/\\//i.test(value) && isCandidate(value)) pushUrl(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 240)) collectUrlsDeep(item, depth + 1);
        return;
      }
      if (typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (/url|base|audio|video|dash|backup|segment/i.test(key)) collectUrlsDeep(item, depth + 1);
        }
      }
    };
    const collectOwnerDeep = (value, depth = 0) => {
      if (!value || sourceAccountName || depth > 8) return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 200)) collectOwnerDeep(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;
      const object = value;
      if (object.owner && typeof object.owner === "object") {
        const name = clean(object.owner.name || object.owner.uname || object.owner.nickname);
        if (name) {
          sourceAccountName = name;
          return;
        }
      }
      const name = clean(object.uname || object.author || object.owner_name);
      if (name && (object.mid || object.uid || object.owner_mid)) {
        sourceAccountName = name;
        return;
      }
      for (const [key, item] of Object.entries(object)) {
        if (/owner|author|user|account|video|data|state/i.test(key)) collectOwnerDeep(item, depth + 1);
        if (sourceAccountName) return;
      }
    };
    for (const video of Array.from(document.querySelectorAll("video"))) {
      for (const value of [video.currentSrc, video.src]) {
        if (value) pushUrl(value);
      }
      for (const source of Array.from(video.querySelectorAll("source"))) {
        const value = source.src || source.getAttribute("src") || "";
        if (value) pushUrl(value);
      }
    }
    for (const entry of performance.getEntriesByType("resource")) {
      pushUrl(entry.name || "");
    }
    const stateValues = [
      window.__playinfo__,
      window.__INITIAL_STATE__,
      window.__INITIAL_DATA__,
      window.__NEXT_DATA__
    ];
    for (const value of stateValues) collectUrlsDeep(value);
    for (const value of stateValues) collectOwnerDeep(value);
    for (const script of Array.from(document.querySelectorAll("script"))) {
      const text = script.textContent || "";
      if (!/playinfo|dash|baseUrl|backupUrl|upgcxcode|bilivideo/.test(text)) continue;
      const matches = text.match(/https?:\\\\?\\/\\\\?\\/[^\\s"'<>\\\\|]+/g) || [];
      for (const match of matches) pushUrl(match);
      const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);
      if (jsonMatch && jsonMatch[0].length < 10_000_000) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          collectUrlsDeep(parsed);
          collectOwnerDeep(parsed);
        } catch {}
      }
    }
    const metas = Object.fromEntries(
      Array.from(document.querySelectorAll("meta[property], meta[name]"))
        .map((meta) => [meta.getAttribute("property") || meta.getAttribute("name") || "", meta.getAttribute("content") || ""])
        .filter(([key, value]) => key && value)
    );
    const metaAccountName = clean(
      metas.author ||
      metas["article:author"] ||
      metas["og:author"] ||
      document.querySelector('[itemprop="author"] [itemprop="name"], [itemprop="author"], [class*="up-name"], [class*="author"]')?.textContent ||
      ""
    );
    const coverUrl = normalizeUrl(
      metas["og:image"] ||
      metas["twitter:image"] ||
      document.querySelector("video")?.poster ||
      ""
    );
    const bvid = (location.href.match(/BV[0-9A-Za-z]+/) || [])[0] || "";
    return {
      bvid,
      title: clean(metas["og:title"] || document.title || ""),
      sourceAccountName: sourceAccountName || metaAccountName,
      coverUrl,
      description: clean(metas.description || metas["og:description"] || ""),
      mediaUrls: Array.from(new Set(urls)).filter((value) => /^https?:\\/\\//i.test(value))
    };
  };
  for (let i = 0; i < 8; i += 1) {
    const data = collect();
    if (data.mediaUrls.length) return data;
    const video = document.querySelector("video");
    if (video) video.play().catch(() => undefined);
    await sleep(1000);
  }
  return collect();
})()
`;

function extractHtmlTitle(html: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return ogTitle || title || "";
}

function extractHtmlImage(html: string) {
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const twitterImage = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  return ogImage || twitterImage || "";
}

function normalizeTitle(input: string) {
  return input
    .replace(/\s*-\s*抖音$/i, "")
    .replace(/\s*_\s*哔哩哔哩.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeFileName(input: string) {
  return input.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "video";
}

function makeLinkSourceFileBaseName(media: LinkSourceResolvedMedia) {
  const title = media.title || media.sourceAccountName || media.resolvedUrl || media.url || "single-video";
  return safeFileName(normalizeTitle(title)).slice(0, 64) || "single-video";
}

function normalizeVolcengineAudioFormat(value: string | undefined) {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  return ["raw", "wav", "mp3", "ogg"].includes(normalized) ? normalized : "";
}

function inferVolcengineAudioFormat(mediaPathOrUrl: string) {
  try {
    const parsed = new URL(mediaPathOrUrl);
    const mimeType = (parsed.searchParams.get("mime_type") || "").toLowerCase();
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg") || mimeType.includes("opus")) return "ogg";
    if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3";
    if (/\.(wav)(\?|$)/i.test(parsed.pathname)) return "wav";
    if (/\.(ogg|opus)(\?|$)/i.test(parsed.pathname)) return "ogg";
    if (/\.(mp3)(\?|$)/i.test(parsed.pathname)) return "mp3";
  } catch {
    if (/\.(wav)(\?|$)/i.test(mediaPathOrUrl)) return "wav";
    if (/\.(ogg|opus)(\?|$)/i.test(mediaPathOrUrl)) return "ogg";
    if (/\.(mp3)(\?|$)/i.test(mediaPathOrUrl)) return "mp3";
  }
  return "mp3";
}

async function downloadDouyinAudio(
  account: Account,
  video: Video,
  prefetchedMediaUrl?: string,
  options: AbortableOptions = {}
) {
  const mediaUrlStartedAt = Date.now();
  const mediaUrl =
    prefetchedMediaUrl ||
    video.downloadUrl ||
    (await refreshDouyinVideoDownloadUrl(account, video, { signal: options.signal }));
  const mediaUrlMs = Date.now() - mediaUrlStartedAt;
  if (!mediaUrl) {
    throw new Error("没有取得当前抖音视频的可转写媒体地址。请确认 opencli 已登录抖音、视频链接仍可访问，或重新采集账号后再试。");
  }

  const timings = [
    {
      stage: prefetchedMediaUrl ? "douyin-media-url-prefetched" : video.downloadUrl ? "douyin-media-url-cached" : "douyin-opencli",
      ms: mediaUrlMs
    }
  ];
  let extracted: { mediaPath: string; ms: number };
  try {
    throwIfAborted(options.signal);
    extracted = await downloadRemoteAudio(mediaUrl, `${video.id}.mp3`, options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (!isNoAudioStreamError(error) && (prefetchedMediaUrl || !video.downloadUrl)) throw error;

    throwIfAborted(options.signal);
    const fallbackStartedAt = Date.now();
    const fallbackUrl = await refreshDouyinVideoDownloadUrl(account, video, {
      preferBrowser: !video.downloadUrl,
      excludeUrls: [mediaUrl],
      signal: options.signal
    });
    timings.push({ stage: "douyin-media-url-audio-fallback", ms: Date.now() - fallbackStartedAt });
    if (!fallbackUrl || fallbackUrl === mediaUrl) throw error;
    try {
      throwIfAborted(options.signal);
      extracted = await downloadRemoteAudio(fallbackUrl, `${video.id}.mp3`, options);
    } catch (fallbackError) {
      if (isAbortError(fallbackError)) throw fallbackError;
      if (!isNoAudioStreamError(fallbackError)) throw fallbackError;
      throwIfAborted(options.signal);
      const browserStartedAt = Date.now();
      const browserUrl = await refreshDouyinVideoDownloadUrl(account, video, {
        preferBrowser: true,
        excludeUrls: [mediaUrl, fallbackUrl],
        signal: options.signal
      });
      timings.push({ stage: "douyin-media-url-browser-fallback", ms: Date.now() - browserStartedAt });
      if (!browserUrl || browserUrl === mediaUrl || browserUrl === fallbackUrl) throw fallbackError;
      extracted = await downloadRemoteAudio(browserUrl, `${video.id}.mp3`, options);
    }
  }

  return {
    mediaPath: extracted.mediaPath,
    timings: [
      ...timings,
      { stage: "douyin-ffmpeg-audio", ms: extracted.ms }
    ]
  };
}

async function downloadBilibiliAudio(video: Video, options: AbortableOptions = {}) {
  const mediaUrlStartedAt = Date.now();
  const pageUrl = video.url || (extractBvid(video.id) ? `https://www.bilibili.com/video/${extractBvid(video.id)}` : "");
  if (!pageUrl) {
    throw new Error("无法解析 B站视频链接，不能提取远程音频");
  }

  const media = await resolveBilibiliLinkMedia(pageUrl, { signal: options.signal });
  const timings: Timing[] = [{ stage: "bilibili-browser-media-url", ms: Date.now() - mediaUrlStartedAt }];
  if (!media.mediaUrls.length) {
    throw new Error("没有解析到可转写的 B站媒体地址");
  }

  const downloaded = await downloadFirstAvailableRemoteAudio(
    media.mediaUrls,
    `${safeFileName(media.mediaId || video.id || "bilibili-video")}.mp3`,
    options
  );

  return {
    mediaPath: downloaded.mediaPath,
    cleanupTargets: [downloaded.mediaPath],
    timings: [
      ...timings,
      { stage: "bilibili-ffmpeg-audio", ms: downloaded.ms },
      ...(downloaded.attempts.length > 1 ? [{ stage: `bilibili-media-url-attempts-${downloaded.attempts.length}`, ms: 0 }] : [])
    ]
  };
}

async function downloadRemoteBilibiliVideo(
  media: LinkSourceResolvedMedia,
  fileName: string,
  options: AbortableOptions = {}
) {
  const videoUrls = selectRemoteVideoMediaUrls(media.mediaUrls).slice(0, 4);
  const audioUrls = selectRemoteAudioMediaUrls(media.mediaUrls).slice(0, 4);
  if (!videoUrls.length) {
    throw new Error("没有解析到可下载的 B站视频流。");
  }

  const attempts: string[] = [];
  if (audioUrls.length) {
    for (const videoUrl of videoUrls) {
      for (const audioUrl of audioUrls) {
        try {
          throwIfAborted(options.signal);
          return await mergeRemoteVideoAndAudio(videoUrl, audioUrl, fileName, options);
        } catch (error) {
          if (isAbortError(error)) throw error;
          attempts.push(formatMediaAttemptError("视频音频合并", error));
        }
      }
    }
    throw new Error(`B站视频直连合并失败：${formatMediaAttempts(attempts)}`);
  }

  for (const videoUrl of videoUrls) {
    try {
      throwIfAborted(options.signal);
      return await downloadRemoteMuxedVideo(videoUrl, fileName, options);
    } catch (error) {
      if (isAbortError(error)) throw error;
      attempts.push(formatMediaAttemptError("视频流下载", error));
    }
  }
  throw new Error(`B站视频直连下载失败：${formatMediaAttempts(attempts)}`);
}

async function mergeRemoteVideoAndAudio(
  videoUrl: string,
  audioUrl: string,
  fileName: string,
  options: AbortableOptions = {}
) {
  const target = path.join(os.tmpdir(), `style-library-${Date.now()}-${fileName}`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-rw_timeout",
    "15000000",
    ...buildFfmpegHeaderArgs(videoUrl),
    "-i",
    videoUrl,
    ...buildFfmpegHeaderArgs(audioUrl),
    "-i",
    audioUrl,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    target
  ];
  return runFfmpegDownload(args, target, options);
}

async function downloadRemoteMuxedVideo(url: string, fileName: string, options: AbortableOptions = {}) {
  const target = path.join(os.tmpdir(), `style-library-${Date.now()}-${fileName}`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-rw_timeout",
    "15000000",
    ...buildFfmpegHeaderArgs(url),
    "-i",
    url,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    target
  ];
  return runFfmpegDownload(args, target, options);
}

async function runFfmpegDownload(args: string[], target: string, options: AbortableOptions = {}) {
  try {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    await execFileAbortable(ffmpegBin(), args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024 * 8,
      timeout: 20 * 60 * 1000
    }, options.signal);
    return { filePath: target, ms: Date.now() - startedAt };
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => undefined);
    if (isAbortError(error)) throw error;
    throw new Error(describeFfmpegError(error));
  }
}

function selectRemoteVideoMediaUrls(urls: string[]) {
  return [...new Set(urls.filter(Boolean))]
    .filter((url) => !isLikelyAudioMediaUrl(url))
    .sort((a, b) => videoMediaUrlScore(b) - videoMediaUrlScore(a));
}

function selectRemoteAudioMediaUrls(urls: string[]) {
  return sortRemoteAudioMediaUrls(urls).filter((url) => isLikelyAudioMediaUrl(url));
}

function formatMediaAttemptError(stage: string, error: unknown) {
  return `${stage}：${formatErrorDetail(error)}`;
}

function formatMediaAttempts(attempts: string[]) {
  return attempts.length ? attempts.slice(0, 6).join("；") : "没有可用候选流。";
}

async function downloadRemoteAudio(url: string, fileName: string, options: AbortableOptions = {}) {
  const target = path.join(os.tmpdir(), `style-library-${Date.now()}-${fileName}`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-rw_timeout",
    "15000000",
    ...buildFfmpegHeaderArgs(url),
    "-i",
    url,
    "-vn",
    "-map",
    "a:0",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "32k",
    target
  ];

  try {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    await execFileAbortable(ffmpegBin(), args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024 * 4,
      timeout: 10 * 60 * 1000
    }, options.signal);
    return { mediaPath: target, ms: Date.now() - startedAt };
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => undefined);
    if (isAbortError(error)) throw error;
    throw new Error(`音频提取失败：${describeFfmpegError(error)}`);
  }
}

async function extractLocalAudio(mediaPath: string, fileName: string, options: AbortableOptions = {}) {
  const target = path.join(os.tmpdir(), `style-library-${Date.now()}-${fileName}`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    mediaPath,
    "-vn",
    "-map",
    "a:0",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "32k",
    target
  ];

  try {
    throwIfAborted(options.signal);
    const startedAt = Date.now();
    await execFileAbortable(ffmpegBin(), args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024 * 4,
      timeout: 10 * 60 * 1000
    }, options.signal);
    return { mediaPath: target, ms: Date.now() - startedAt };
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => undefined);
    if (isAbortError(error)) throw error;
    throw new Error(`音频提取失败：${describeFfmpegError(error)}`);
  }
}

function execFileAbortable(
  command: string,
  args: string[],
  options: Parameters<typeof execFile>[2],
  signal?: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const child = execFile(command, args, options, (error) => {
      signal?.removeEventListener("abort", abort);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    const abort = () => {
      child.kill("SIGTERM");
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function ffmpegBin() {
  return process.env.FFMPEG_BIN || "ffmpeg";
}

function isNoAudioStreamError(error: unknown) {
  return error instanceof Error && /matches no streams|stream map 'a:0'|does not contain any stream/i.test(error.message);
}

function buildFfmpegHeaderArgs(url: string) {
  if (/bilibili|bilivideo|akamaized|upgcxcode/i.test(url)) {
    return [
      "-headers",
      [
        "Accept: */*",
        "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
        "Origin: https://www.bilibili.com",
        "Referer: https://www.bilibili.com/",
        "Sec-Fetch-Dest: video",
        "Sec-Fetch-Mode: no-cors",
        "Sec-Fetch-Site: cross-site",
        `User-Agent: ${browserUserAgent()}`,
        ""
      ].join("\r\n")
    ];
  }

  if (!/douyinvod\.com/i.test(url)) return [];

  return [
    "-headers",
    [
      "Accept: */*",
      "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
      "Origin: https://www.douyin.com",
      "Referer: https://www.douyin.com/",
      "Sec-Fetch-Dest: video",
      "Sec-Fetch-Mode: no-cors",
      "Sec-Fetch-Site: cross-site",
      "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      ""
    ].join("\r\n")
  ];
}

function describeFfmpegError(error: unknown) {
  if (!(error instanceof Error)) return "ffmpeg 执行失败";
  const detail =
    "stderr" in error && typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr.trim()
      : "";
  if (/ENOENT/.test(error.message)) {
    return "未找到 ffmpeg，请先安装 ffmpeg，或设置 FFMPEG_BIN 指向可执行文件。";
  }
  return detail || error.message || "ffmpeg 执行失败";
}

function buildMissingMediaReason(input: {
  platform: Platform;
  mediaError: string;
  hadBilibiliSubtitle: boolean;
  bilibiliSubtitleError?: string;
}) {
  if (input.platform === "bilibili" && input.bilibiliSubtitleError) {
    if (input.mediaError) {
      return `B站字幕抓取失败：${input.bilibiliSubtitleError}。已改走远程媒体音频提取和火山转写，但音频提取失败：${input.mediaError}`;
    }
    return `B站字幕抓取失败：${input.bilibiliSubtitleError}，也没有解析到可转写的远程媒体音频地址。请检查 opencli、网络或登录状态。`;
  }

  if (input.platform === "bilibili" && !input.hadBilibiliSubtitle) {
    if (input.mediaError) {
      return `此 B站视频的公开字幕接口没有返回外挂或智能字幕轨，已改走远程媒体音频提取和火山转写，但音频提取失败：${input.mediaError}`;
    }
    return "此 B站视频的公开字幕接口没有返回外挂或智能字幕轨，也没有解析到可转写的远程媒体音频地址。";
  }

  if (input.mediaError) {
    return `没有取得可转写的媒体地址或本地文件：${input.mediaError}`;
  }

  return "没有平台字幕，也没有取得可转写的媒体地址或本地文件。";
}

function buildLinkMissingMediaReason(url: string, bilibiliSubtitleError?: string) {
  if (bilibiliSubtitleError) {
    return `B站字幕抓取失败：${bilibiliSubtitleError}，且没有解析到可转写的媒体地址：${url}`;
  }
  return `没有解析到可转写的媒体地址：${url}`;
}

function buildLinkMetadataOnlyReason(input: { title: string; bilibiliSubtitleError?: string }) {
  const titleNote = `仅解析到视频标题「${input.title}」，没有取得可用视频文稿。`;
  if (input.bilibiliSubtitleError) {
    return `${titleNote}B站字幕抓取失败：${input.bilibiliSubtitleError}，且没有解析到可转写的媒体地址。`;
  }
  return `${titleNote}没有解析到可转写的媒体地址。`;
}

function buildProviderErrorReason(platform: Platform, error: unknown, bilibiliSubtitleError?: string) {
  const message = error instanceof Error ? error.message : "转写失败";
  if (platform === "bilibili" && bilibiliSubtitleError) {
    return `B站字幕抓取失败：${bilibiliSubtitleError}；音频转写也失败：${message}`;
  }
  if (platform === "bilibili" && message.includes("VOLCENGINE_ASR_API_KEY")) {
    return "此 B站视频没有发现外挂或智能字幕，已回退到火山转写，但当前未配置 VOLCENGINE_ASR_API_KEY。";
  }
  return message;
}
