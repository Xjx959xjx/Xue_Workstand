import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { downloadBilibiliVideo, getBilibiliSubtitle, refreshDouyinVideoDownloadUrl } from "./opencli";
import { getVideo, markTranscriptFailed, saveTranscript } from "./storage";
import { cleanTranscriptText } from "./transcript-cleaning";
import { Account, Platform, Video } from "./types";

const execFileAsync = promisify(execFile);

function transcriptionConfig() {
  return {
    apiKey: process.env.SILICONFLOW_API_KEY || "",
    baseUrl: (process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1").replace(/\/$/, ""),
    model: process.env.SILICONFLOW_TRANSCRIBE_MODEL || "FunAudioLLM/SenseVoiceSmall"
  };
}

export async function transcribeVideo(input: {
  platform: Platform;
  accountId: string;
  videoId: string;
  mediaPath?: string;
  douyinMediaUrl?: string;
  allowRemoteDownload?: boolean;
}) {
  const timings: Array<{ stage: string; ms: number }> = [];
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
      const text = await transcribeWithSiliconFlow(mediaPath);
      timings.push({ stage: "siliconflow-transcribe", ms: Date.now() - transcribeStartedAt });
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
        source: "siliconflow"
      });
      timings.push({ stage: "save-transcript", ms: Date.now() - saveStartedAt });
      return {
        ...saved,
        usedProvider: "siliconflow",
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

async function transcribeWithSiliconFlow(mediaPath: string) {
  const config = transcriptionConfig();
  if (!config.apiKey) {
    throw new Error("未配置 SILICONFLOW_API_KEY，无法调用硅基流动转写");
  }

  const bytes = await fs.readFile(mediaPath);
  const formData = new FormData();
  formData.append("model", config.model);
  formData.append("file", new Blob([bytes]), path.basename(mediaPath));

  const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`硅基流动转写失败：${response.status} ${body}`);
  }

  const data = (await response.json()) as { text?: string };
  if (!data.text?.trim()) {
    throw new Error("硅基流动没有返回转写文本");
  }

  return data.text.trim();
}

async function downloadDouyinAudio(account: Account, video: Video, prefetchedMediaUrl?: string) {
  const mediaUrlStartedAt = Date.now();
  const mediaUrl = prefetchedMediaUrl || (await refreshDouyinVideoDownloadUrl(account, video));
  const mediaUrlMs = Date.now() - mediaUrlStartedAt;
  if (!mediaUrl) {
    throw new Error("opencli 没有返回当前抖音视频的媒体地址，请先重新采集账号后再试。");
  }

  const timings = [{ stage: prefetchedMediaUrl ? "douyin-media-url-prefetched" : "douyin-opencli", ms: mediaUrlMs }];
  let extracted: { mediaPath: string; ms: number };
  try {
    extracted = await extractRemoteAudio(mediaUrl, `${video.id}.m4a`);
  } catch (error) {
    if (!isNoAudioStreamError(error)) throw error;

    const fallbackStartedAt = Date.now();
    const fallbackUrl = await refreshDouyinVideoDownloadUrl(account, video, {
      preferBrowser: true,
      excludeUrls: [mediaUrl]
    });
    timings.push({ stage: "douyin-media-url-audio-fallback", ms: Date.now() - fallbackStartedAt });
    if (!fallbackUrl || fallbackUrl === mediaUrl) throw error;
    extracted = await extractRemoteAudio(fallbackUrl, `${video.id}.m4a`);
  }

  return {
    mediaPath: extracted.mediaPath,
    timings: [
      ...timings,
      { stage: "douyin-ffmpeg-audio", ms: extracted.ms }
    ]
  };
}

async function extractRemoteAudio(url: string, fileName: string) {
  const target = path.join(os.tmpdir(), `style-library-${Date.now()}-${fileName}`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
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
    "aac",
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
    throw new Error(`抖音音频提取失败：${describeFfmpegError(error)}`);
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
  if (platform === "bilibili" && message.includes("SILICONFLOW_API_KEY")) {
    return "此 B站视频没有发现外挂或智能字幕，已回退到音频转写，但当前未配置 SILICONFLOW_API_KEY。";
  }
  return message;
}
