import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  getBilibiliSubtitle,
  parseOpenCliJsonish,
  refreshDouyinVideoDownloadUrl
} from "./opencli";
import { getVideo, markTranscriptFailed, saveTranscript } from "./storage";
import { cleanTranscriptText } from "./transcript-cleaning";
import { Account, Platform, Video } from "./types";
import { extractBvid } from "./utils";

const execFileAsync = promisify(execFile);
type Timing = { stage: string; ms: number };

export type LinkTranscriptionResult = {
  url: string;
  resolvedUrl?: string;
  platform: Platform | "unknown";
  title?: string;
  text: string;
  source: "platform_subtitle" | "volcengine" | "metadata";
  fallback?: boolean;
  fallbackReason?: string;
  timings?: Timing[];
};

type LinkMediaInfo = {
  mediaId?: string;
  title?: string;
  mediaUrls: string[];
};

function transcriptionConfig() {
  const pollIntervalMs = Number.parseInt(process.env.VOLCENGINE_ASR_POLL_INTERVAL_MS || "", 10);
  const maxPollAttempts = Number.parseInt(process.env.VOLCENGINE_ASR_MAX_POLL_ATTEMPTS || "", 10);
  const timeoutMs = Number.parseInt(process.env.VOLCENGINE_ASR_REQUEST_TIMEOUT_MS || "", 10);

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
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(timeoutMs, 5000) : 30000
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
}) {
  const timings: Timing[] = [];
  const totalStartedAt = Date.now();
  const { account, video } = await getVideo(input.platform, input.accountId, input.videoId);
  timings.push({ stage: "load-video", ms: Date.now() - totalStartedAt });
  const cleanupTargets: string[] = [];
  let hadBilibiliSubtitle = false;

  if (input.platform === "bilibili") {
    const subtitle = await getBilibiliSubtitle(video).catch(() => "");
    if (subtitle.trim()) {
      hadBilibiliSubtitle = true;
      return {
        ...(await saveTranscript({
          platform: input.platform,
          accountId: input.accountId,
          videoId: input.videoId,
          text: subtitle,
          source: "platform_subtitle"
        })),
        usedProvider: "bilibili-subtitle"
      };
    }
  }

  let mediaPath = input.mediaPath || "";
  let mediaError = "";

  try {
    const shouldDownloadRemote =
      input.allowRemoteDownload || (input.platform === "douyin" && Boolean(input.douyinMediaUrl));
    if (!mediaPath && shouldDownloadRemote) {
      if (input.platform === "bilibili") {
        try {
          const prepared = await downloadBilibiliAudio(video);
          mediaPath = prepared.mediaPath;
          timings.push(...prepared.timings);
          cleanupTargets.push(...prepared.cleanupTargets);
        } catch (error) {
          mediaError = error instanceof Error ? error.message : "B站音频提取失败";
        }
      } else {
        try {
          const prepared = await downloadDouyinAudio(account, video, input.douyinMediaUrl);
          mediaPath = prepared.mediaPath;
          timings.push(...prepared.timings);
          cleanupTargets.push(mediaPath);
        } catch (error) {
          mediaError = error instanceof Error ? error.message : "下载音频失败";
        }
      }
    }

    if (!mediaPath && input.mediaUrl) {
      try {
        const prepared = await downloadRemoteAudio(input.mediaUrl, `${input.videoId}.mp3`);
        mediaPath = prepared.mediaPath;
        timings.push({ stage: "download-media-url-audio", ms: prepared.ms });
        cleanupTargets.push(mediaPath);
      } catch (error) {
        mediaError = error instanceof Error ? error.message : "下载音频失败";
      }
    }

    if (!mediaPath) {
      const reason = buildMissingMediaReason({
        platform: input.platform,
        mediaError,
        hadBilibiliSubtitle
      });
      await markTranscriptFailed(input.platform, input.accountId, input.videoId, reason);
      throw new Error(reason);
    }

    try {
      const transcribeStartedAt = Date.now();
      const preparedForAsr = await prepareAudioForVolcengine(mediaPath);
      if (preparedForAsr.cleanupPath) cleanupTargets.push(preparedForAsr.cleanupPath);
      timings.push(...preparedForAsr.timings);
      const volcengine = await transcribeWithVolcengine(preparedForAsr.mediaPath);
      const text = volcengine.text;
      timings.push(...volcengine.timings);
      timings.push({ stage: "volcengine-transcribe", ms: Date.now() - transcribeStartedAt });
      const cleanStartedAt = Date.now();
      const cleaned = await cleanTranscriptText({
        platform: input.platform,
        title: video.title,
        text
      });
      timings.push({ stage: "clean-transcript", ms: Date.now() - cleanStartedAt });
      const saveStartedAt = Date.now();
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
      const reason = buildProviderErrorReason(input.platform, error);
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
}): Promise<LinkTranscriptionResult> {
  const startedAt = Date.now();
  const resolvedUrl = await resolveShareUrl(input.url).catch(() => input.url);
  const platform = detectLinkPlatform(resolvedUrl || input.url);

  if (platform === "bilibili") {
    const subtitle = await getBilibiliSubtitle({
      id: resolvedUrl,
      url: resolvedUrl,
      raw: resolvedUrl
    } as Video).catch(() => "");
    if (subtitle.trim()) {
      return {
        url: input.url,
        resolvedUrl,
        platform,
        title: input.titleHint,
        text: subtitle.trim(),
        source: "platform_subtitle",
        timings: [{ stage: "total", ms: Date.now() - startedAt }]
      };
    }
  }

  if (platform !== "douyin" && platform !== "bilibili") {
    throw new Error(`暂不支持从这个链接提取视频文稿：${input.url}`);
  }

  const media = await resolveLinkMediaUrl({
    url: input.url,
    resolvedUrl,
    platform
  });
  if (!media.mediaUrls.length) {
    if (media.title) {
      return {
        url: input.url,
        resolvedUrl,
        platform,
        title: media.title,
        text: media.title,
        source: "metadata",
        fallback: true,
        fallbackReason: "没有解析到可转写的媒体地址，已仅使用视频标题/描述。"
      };
    }
    throw new Error(`没有解析到可转写的媒体地址：${input.url}`);
  }

  const cleanupTargets: string[] = [];
  try {
    const downloaded = await downloadFirstAvailableRemoteAudio(
      media.mediaUrls,
      `${safeFileName(media.mediaId || "link-video")}.mp3`
    );
    cleanupTargets.push(downloaded.mediaPath);
    const preparedForAsr = await prepareAudioForVolcengine(downloaded.mediaPath);
    if (preparedForAsr.cleanupPath) cleanupTargets.push(preparedForAsr.cleanupPath);
    const volcengine = await transcribeWithVolcengine(preparedForAsr.mediaPath);
    const cleaned = await cleanTranscriptText({
      platform,
      title: media.title || input.titleHint,
      text: volcengine.text
    });
    return {
      url: input.url,
      resolvedUrl,
      platform,
      title: media.title || input.titleHint,
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
  } finally {
    await Promise.all(cleanupTargets.map((target) => fs.rm(target, { recursive: true, force: true }).catch(() => undefined)));
  }
}

async function transcribeWithVolcengine(mediaPath: string): Promise<{ text: string; timings: Timing[] }> {
  const config = transcriptionConfig();
  if (!config.apiKey && (!config.appKey || !config.accessKey)) {
    throw new Error("未配置 VOLCENGINE_ASR_API_KEY，无法调用火山引擎录音文件识别 2.0");
  }

  const timings: Timing[] = [];
  const taskId = randomUUID();
  const headers = buildVolcengineHeaders(config, taskId);
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

  const submitStartedAt = Date.now();
  const submitResponse = await fetchWithTimeout(
    config.submitUrl,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    },
    config.timeoutMs
  );
  await assertVolcengineResponse(submitResponse, "提交火山引擎转写任务", ["20000000"]);
  timings.push({ stage: "volcengine-submit", ms: Date.now() - submitStartedAt });

  const queryStartedAt = Date.now();
  let pollWaitMs = 0;
  let queryRequestMs = 0;
  for (let attempt = 0; attempt < config.maxPollAttempts; attempt += 1) {
    if (attempt > 0) {
      const waitStartedAt = Date.now();
      await sleep(config.pollIntervalMs);
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
      config.timeoutMs
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
    timings.push({ stage: "volcengine-query-requests", ms: queryRequestMs });
    if (pollWaitMs) timings.push({ stage: "volcengine-poll-wait", ms: pollWaitMs });
    timings.push({ stage: "volcengine-query", ms: Date.now() - queryStartedAt });
    return { text: text.trim(), timings };
  }

  throw new Error("火山引擎转写任务查询超时，请稍后重试。");
}

async function prepareAudioForVolcengine(mediaPath: string): Promise<{
  mediaPath: string;
  cleanupPath?: string;
  timings: Timing[];
}> {
  if (isVolcengineSupportedAudio(mediaPath)) {
    return { mediaPath, timings: [] };
  }

  const startedAt = Date.now();
  const fileName = `${path.basename(mediaPath).replace(/[^\w.-]+/g, "-") || "media"}.mp3`;
  const converted = await extractLocalAudio(mediaPath, fileName);
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`火山引擎请求超时：${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveShareUrl(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
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
    return url;
  } finally {
    clearTimeout(timeout);
  }
}

function detectLinkPlatform(url: string): Platform | "unknown" {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("bilibili.com") || hostname === "b23.tv") return "bilibili";
    if (hostname.includes("douyin.com") || hostname.includes("iesdouyin.com")) return "douyin";
  } catch {
    if (/bilibili|b23\.tv/i.test(url)) return "bilibili";
    if (/douyin|iesdouyin/i.test(url)) return "douyin";
  }
  return "unknown";
}

async function resolveLinkMediaUrl(input: {
  url: string;
  resolvedUrl: string;
  platform: Platform;
}): Promise<LinkMediaInfo> {
  if (input.platform === "douyin") {
    return resolveDouyinLinkMedia(input.resolvedUrl || input.url);
  }

  if (input.platform === "bilibili") {
    return resolveBilibiliLinkMedia(input.resolvedUrl || input.url);
  }

  return resolveGenericLinkMedia(input.resolvedUrl || input.url);
}

async function resolveBilibiliLinkMedia(url: string) {
  const workspace = `bilibili-link-transcribe-${process.pid}-${Date.now()}-${safeFileName(url).slice(0, 18)}`;

  try {
    await execFileAsync(process.env.OPENCLI_BIN || "opencli", [
      "browser",
      "--workspace",
      workspace,
      "--window",
      "background",
      "--keep-tab",
      "true",
      "open",
      url
    ], {
      maxBuffer: 1024 * 1024 * 8,
      timeout: 30_000
    });
    await execFileAsync(process.env.OPENCLI_BIN || "opencli", ["browser", "--workspace", workspace, "wait", "time", "3"], {
      maxBuffer: 1024 * 1024,
      timeout: 12_000
    }).catch(() => undefined);
    const { stdout } = await execFileAsync(process.env.OPENCLI_BIN || "opencli", [
      "browser",
      "--workspace",
      workspace,
      "eval",
      BILIBILI_LINK_MEDIA_EXTRACT_JS
    ], {
      maxBuffer: 1024 * 1024 * 20,
      timeout: 30_000
    });
    const data = parseOpenCliJsonish(stdout.trim());
    const object = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const mediaUrls = Array.isArray(object.mediaUrls) ? object.mediaUrls.map((value) => String(value || "")) : [];
    return {
      mediaId: String(object.bvid || extractBvid(url) || ""),
      title: normalizeTitle(String(object.title || object.description || "")),
      mediaUrls: sortLinkMediaUrls(mediaUrls)
    };
  } finally {
    await execFileAsync(process.env.OPENCLI_BIN || "opencli", ["browser", "--workspace", workspace, "close"], {
      maxBuffer: 1024 * 1024,
      timeout: 5_000
    }).catch(() => undefined);
  }
}

async function resolveDouyinLinkMedia(url: string) {
  const workspace = `douyin-link-transcribe-${process.pid}-${Date.now()}-${safeFileName(url).slice(0, 18)}`;

  try {
    await execFileAsync(process.env.OPENCLI_BIN || "opencli", [
      "browser",
      "--workspace",
      workspace,
      "--window",
      "background",
      "--keep-tab",
      "true",
      "open",
      url
    ], {
      maxBuffer: 1024 * 1024 * 8,
      timeout: 30_000
    });
    await execFileAsync(process.env.OPENCLI_BIN || "opencli", ["browser", "--workspace", workspace, "wait", "time", "2"], {
      maxBuffer: 1024 * 1024,
      timeout: 10_000
    }).catch(() => undefined);
    const { stdout } = await execFileAsync(process.env.OPENCLI_BIN || "opencli", [
      "browser",
      "--workspace",
      workspace,
      "eval",
      DOUYIN_LINK_MEDIA_EXTRACT_JS
    ], {
      maxBuffer: 1024 * 1024 * 20,
      timeout: 30_000
    });
    const data = parseOpenCliJsonish(stdout.trim());
    const object = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const mediaUrls = Array.isArray(object.mediaUrls) ? object.mediaUrls.map((value) => String(value || "")) : [];
    return {
      mediaId: String(object.awemeId || ""),
      title: normalizeTitle(String(object.title || object.description || "")),
      mediaUrls: sortLinkMediaUrls(mediaUrls)
    };
  } finally {
    await execFileAsync(process.env.OPENCLI_BIN || "opencli", ["browser", "--workspace", workspace, "close"], {
      maxBuffer: 1024 * 1024,
      timeout: 5_000
    }).catch(() => undefined);
  }
}

async function resolveGenericLinkMedia(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
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
    mediaUrls: sortLinkMediaUrls(mediaUrls)
  };
}

async function downloadFirstAvailableRemoteAudio(urls: string[], fileName: string) {
  const attempts: Array<{ url: string; error?: string; ms?: number }> = [];
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  let lastError: unknown;

  for (const [index, url] of uniqueUrls.entries()) {
    try {
      const downloaded = await downloadRemoteAudio(url, `${index + 1}-${fileName}`);
      attempts.push({ url, ms: downloaded.ms });
      return { ...downloaded, attempts };
    } catch (error) {
      lastError = error;
      attempts.push({ url, error: error instanceof Error ? error.message : "音频提取失败" });
      if (!isNoAudioStreamError(error)) break;
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
  const collect = () => {
    const urls = [];
    const pushUrl = (value) => {
      const normalized = normalizeUrl(String(value || ""));
      if (/^https?:\\/\\//i.test(normalized)) urls.push(normalized);
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
    for (const script of Array.from(document.querySelectorAll("script"))) {
      const text = script.textContent || "";
      if (!/aweme|play_addr|download_addr|douyinvod|url_list/.test(text)) continue;
      const matches = text.match(/https?:\\\\?\\/\\\\?\\/[^"'<>\\\\]+/g) || [];
      for (const match of matches) pushUrl(match.replaceAll("\\\\/", "/"));
      const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);
      if (jsonMatch && jsonMatch[0].length < 8_000_000) {
        try {
          collectUrlsDeep(JSON.parse(jsonMatch[0]));
        } catch {}
      }
    }
    const metas = Object.fromEntries(
      Array.from(document.querySelectorAll("meta[property], meta[name]"))
        .map((meta) => [meta.getAttribute("property") || meta.getAttribute("name") || "", meta.getAttribute("content") || ""])
        .filter(([key, value]) => key && value)
    );
    const awemeId = (location.href.match(/\\/video\\/(\\d{10,})/) || [])[1] || "";
    return {
      awemeId,
      title: clean(metas["og:title"] || document.title || ""),
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
  const isCandidate = (url) => /\\/upgcxcode\\/|\\/bfs\\/archive\\/|mime_type=video|mime_type=audio|\\.m4s|\\.mp4|\\.m4a|\\.mp3|akamaized|bilivideo/i.test(url);
  const collect = () => {
    const urls = [];
    const pushUrl = (value) => {
      const normalized = normalizeUrl(String(value || "").replaceAll("\\\\/", "/"));
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
    for (const script of Array.from(document.querySelectorAll("script"))) {
      const text = script.textContent || "";
      if (!/playinfo|dash|baseUrl|backupUrl|upgcxcode|bilivideo/.test(text)) continue;
      const matches = text.match(/https?:\\\\?\\/\\\\?\\/[^"'<>\\\\]+/g) || [];
      for (const match of matches) pushUrl(match);
      const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);
      if (jsonMatch && jsonMatch[0].length < 10_000_000) {
        try {
          collectUrlsDeep(JSON.parse(jsonMatch[0]));
        } catch {}
      }
    }
    const metas = Object.fromEntries(
      Array.from(document.querySelectorAll("meta[property], meta[name]"))
        .map((meta) => [meta.getAttribute("property") || meta.getAttribute("name") || "", meta.getAttribute("content") || ""])
        .filter(([key, value]) => key && value)
    );
    const bvid = (location.href.match(/BV[0-9A-Za-z]+/) || [])[0] || "";
    return {
      bvid,
      title: clean(metas["og:title"] || document.title || ""),
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

function sortLinkMediaUrls(urls: string[]) {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  return unique.sort((a, b) => linkMediaUrlScore(b) - linkMediaUrlScore(a));
}

function linkMediaUrlScore(url: string) {
  let score = 0;
  try {
    const parsed = new URL(url);
    const text = `${parsed.hostname} ${parsed.pathname} ${parsed.search}`.toLowerCase();
    const mimeType = (parsed.searchParams.get("mime_type") || "").toLowerCase();
    if (mimeType.startsWith("audio_")) score += 1000;
    if (/\.(m4a|mp3|aac|wav|flac|ogg)(\?|$)/i.test(parsed.pathname)) score += 900;
    if (/audio|30216|30232|30280|30250/.test(text)) score += 700;
    if (/douyinvod|audio|music|playwm|play_addr|download_addr/.test(text)) score += 160;
    if (/bilivideo|upgcxcode|mime_type=audio|\.m4s/.test(text)) score += 140;
    if (mimeType === "video_mp4" || /\.(mp4|webm|mov)(\?|$)/i.test(parsed.pathname)) score += 80;
  } catch {
    if (/\.(m4a|mp3|aac|wav|flac|ogg)(\?|$)/i.test(url)) score += 900;
    if (/audio|30216|30232|30280|30250/i.test(url)) score += 700;
    if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) score += 80;
  }
  return score;
}

function extractHtmlTitle(html: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return ogTitle || title || "";
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

function browserUserAgent() {
  return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
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

async function downloadDouyinAudio(account: Account, video: Video, prefetchedMediaUrl?: string) {
  const mediaUrlStartedAt = Date.now();
  const mediaUrl = prefetchedMediaUrl || video.downloadUrl || (await refreshDouyinVideoDownloadUrl(account, video));
  const mediaUrlMs = Date.now() - mediaUrlStartedAt;
  if (!mediaUrl) {
    throw new Error("opencli 没有返回当前抖音视频的媒体地址，请先重新采集账号后再试。");
  }

  const timings = [
    {
      stage: prefetchedMediaUrl ? "douyin-media-url-prefetched" : video.downloadUrl ? "douyin-media-url-cached" : "douyin-opencli",
      ms: mediaUrlMs
    }
  ];
  let extracted: { mediaPath: string; ms: number };
  try {
    extracted = await downloadRemoteAudio(mediaUrl, `${video.id}.mp3`);
  } catch (error) {
    if (!isNoAudioStreamError(error) && (prefetchedMediaUrl || !video.downloadUrl)) throw error;

    const fallbackStartedAt = Date.now();
    const fallbackUrl = await refreshDouyinVideoDownloadUrl(account, video, {
      preferBrowser: !video.downloadUrl,
      excludeUrls: [mediaUrl]
    });
    timings.push({ stage: "douyin-media-url-audio-fallback", ms: Date.now() - fallbackStartedAt });
    if (!fallbackUrl || fallbackUrl === mediaUrl) throw error;
    try {
      extracted = await downloadRemoteAudio(fallbackUrl, `${video.id}.mp3`);
    } catch (fallbackError) {
      if (!isNoAudioStreamError(fallbackError)) throw fallbackError;
      const browserStartedAt = Date.now();
      const browserUrl = await refreshDouyinVideoDownloadUrl(account, video, {
        preferBrowser: true,
        excludeUrls: [mediaUrl, fallbackUrl]
      });
      timings.push({ stage: "douyin-media-url-browser-fallback", ms: Date.now() - browserStartedAt });
      if (!browserUrl || browserUrl === mediaUrl || browserUrl === fallbackUrl) throw fallbackError;
      extracted = await downloadRemoteAudio(browserUrl, `${video.id}.mp3`);
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

async function downloadBilibiliAudio(video: Video) {
  const mediaUrlStartedAt = Date.now();
  const pageUrl = video.url || (extractBvid(video.id) ? `https://www.bilibili.com/video/${extractBvid(video.id)}` : "");
  if (!pageUrl) {
    throw new Error("无法解析 B站视频链接，不能提取远程音频");
  }

  const media = await resolveBilibiliLinkMedia(pageUrl);
  const timings: Timing[] = [{ stage: "bilibili-browser-media-url", ms: Date.now() - mediaUrlStartedAt }];
  if (!media.mediaUrls.length) {
    throw new Error("没有解析到可转写的 B站媒体地址");
  }

  const downloaded = await downloadFirstAvailableRemoteAudio(
    media.mediaUrls,
    `${safeFileName(media.mediaId || video.id || "bilibili-video")}.mp3`
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

async function downloadRemoteAudio(url: string, fileName: string) {
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
    const startedAt = Date.now();
    await execFileAsync(ffmpegBin(), args, {
      maxBuffer: 1024 * 1024 * 4,
      timeout: 10 * 60 * 1000
    });
    return { mediaPath: target, ms: Date.now() - startedAt };
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => undefined);
    throw new Error(`音频提取失败：${describeFfmpegError(error)}`);
  }
}

async function extractLocalAudio(mediaPath: string, fileName: string) {
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
    const startedAt = Date.now();
    await execFileAsync(ffmpegBin(), args, {
      maxBuffer: 1024 * 1024 * 4,
      timeout: 10 * 60 * 1000
    });
    return { mediaPath: target, ms: Date.now() - startedAt };
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => undefined);
    throw new Error(`音频提取失败：${describeFfmpegError(error)}`);
  }
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
}) {
  if (input.platform === "bilibili" && !input.hadBilibiliSubtitle) {
    if (input.mediaError) {
      return `此 B站视频的公开字幕接口没有返回外挂或智能字幕轨，已改走远程媒体音频提取和火山转写，但音频提取失败：${input.mediaError}`;
    }
    return "此 B站视频的公开字幕接口没有返回外挂或智能字幕轨，也没有解析到可转写的远程媒体音频地址。";
  }

  if (input.mediaError) {
    return `没有可转写的本地媒体文件：${input.mediaError}`;
  }

  return "没有平台字幕，也没有可转写的本地媒体文件。";
}

function buildProviderErrorReason(platform: Platform, error: unknown) {
  const message = error instanceof Error ? error.message : "转写失败";
  if (platform === "bilibili" && message.includes("VOLCENGINE_ASR_API_KEY")) {
    return "此 B站视频没有发现外挂或智能字幕，已回退到火山转写，但当前未配置 VOLCENGINE_ASR_API_KEY。";
  }
  return message;
}
