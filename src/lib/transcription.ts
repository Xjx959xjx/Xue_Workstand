import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { getBilibiliSubtitle } from "./opencli";
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

  if (input.platform === "bilibili") {
    const subtitle = await getBilibiliSubtitle(video).catch(() => "");
    if (subtitle.trim()) {
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

  const mediaPath =
    input.mediaPath ||
    (input.allowRemoteDownload && (video.downloadUrl || video.url)
      ? await downloadRemoteMedia(video.downloadUrl || video.url, `${video.id}.mp4`)
      : "");

  if (!mediaPath) {
    await markTranscriptFailed(input.platform, input.accountId, input.videoId, "没有平台字幕，也没有可转写的本地媒体文件");
    throw new Error("没有平台字幕。请提供本地音视频路径，或确保采集结果里有可下载地址。");
  }

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
