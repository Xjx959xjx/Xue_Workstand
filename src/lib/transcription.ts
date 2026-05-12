import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { downloadBilibiliVideo, getBilibiliSubtitle, refreshDouyinVideoDownloadUrl } from "./opencli";
import { getVideo, markTranscriptFailed, saveTranscript } from "./storage";
import { cleanTranscriptText } from "./transcript-cleaning";
import { Account, Platform, Video } from "./types";

const execFileAsync = promisify(execFile);
type Timing = { stage: string; ms: number };

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
          mediaPath = await downloadBilibiliVideo(video);
          cleanupTargets.push(path.dirname(mediaPath));
        } catch (error) {
          mediaError = error instanceof Error ? error.message : "B站视频下载失败";
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
      return `此 B站视频的公开字幕接口没有返回外挂或智能字幕轨；如果页面里看到的是弹幕或视频内嵌文字，这类内容无法直接当作字幕提取。回退下载音视频也失败了：${input.mediaError}`;
    }
    return "此 B站视频的公开字幕接口没有返回外挂或智能字幕轨；如果页面里看到的是弹幕或视频内嵌文字，这类内容无法直接当作字幕提取。请提供本地音视频路径，或先安装 yt-dlp 以便下载视频后再转写。";
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
