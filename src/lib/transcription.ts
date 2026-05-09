import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { downloadBilibiliVideo, getBilibiliSubtitle } from "./opencli";
import { getVideo, markTranscriptFailed, saveTranscript } from "./storage";
import { Platform } from "./types";

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
  allowRemoteDownload?: boolean;
}) {
  const { video } = await getVideo(input.platform, input.accountId, input.videoId);
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
    if (!mediaPath && input.allowRemoteDownload) {
      if (input.platform === "bilibili") {
        try {
          mediaPath = await downloadBilibiliVideo(video);
          cleanupTargets.push(path.dirname(mediaPath));
        } catch (error) {
          mediaError = error instanceof Error ? error.message : "B站视频下载失败";
        }
      } else {
        const remoteUrl = resolveRemoteMediaUrl(video.downloadUrl, video.url);
        if (remoteUrl) {
          try {
            mediaPath = await downloadRemoteMedia(remoteUrl, `${video.id}.mp4`);
            cleanupTargets.push(mediaPath);
          } catch (error) {
            mediaError = error instanceof Error ? error.message : "下载媒体失败";
          }
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
      const text = await transcribeWithSiliconFlow(mediaPath);
      return {
        ...(await saveTranscript({
          platform: input.platform,
          accountId: input.accountId,
          videoId: input.videoId,
          text,
          source: "siliconflow"
        })),
        usedProvider: "siliconflow"
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

async function downloadRemoteMedia(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载媒体失败：${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const target = path.join(os.tmpdir(), `style-library-${Date.now()}-${fileName}`);
  await fs.writeFile(target, buffer);
  return target;
}

function resolveRemoteMediaUrl(downloadUrl?: string, fallbackUrl?: string) {
  if (downloadUrl?.trim()) return downloadUrl.trim();
  if (fallbackUrl?.trim() && isLikelyDirectMediaUrl(fallbackUrl)) return fallbackUrl.trim();
  return "";
}

function isLikelyDirectMediaUrl(url: string) {
  return /^https?:\/\//i.test(url) && /\.(mp4|m4a|mp3|wav|aac|flac|ogg|webm|mov|mkv)(\?|$)/i.test(url);
}

function buildMissingMediaReason(input: {
  platform: Platform;
  mediaError: string;
  hadBilibiliSubtitle: boolean;
}) {
  if (input.platform === "bilibili" && !input.hadBilibiliSubtitle) {
    if (input.mediaError) {
      return `此 B站视频没有发现外挂或智能字幕，且回退下载音视频也失败了：${input.mediaError}`;
    }
    return "此 B站视频没有发现外挂或智能字幕。请提供本地音视频路径，或先安装 yt-dlp 以便下载视频后再转写。";
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
