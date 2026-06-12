import { formatDateWithYear } from "@/components/Formatters";
import { buildDouyinVideoUrl, extractDouyinAwemeId, isLikelyDirectMediaUrl } from "@/lib/platform-links";
import type { Video, VideoListItem } from "@/lib/types";

export type BatchLimit = 3 | 5 | 10 | "all";
export type VideoSortMode = "hot" | "title" | "views" | "likes" | "comments" | "favorites" | "latest";

export function canReadTranscript(video: Pick<Video, "transcriptStatus" | "transcriptPath"> | null) {
  return Boolean(video?.transcriptPath) || video?.transcriptStatus === "completed";
}

export function getVideoOpenUrl(video: VideoListItem | null) {
  if (!video?.url) return "";
  if (video.platform !== "douyin") return video.url;
  if (!isLikelyDirectMediaUrl(video.url)) return video.url;

  return buildDouyinVideoUrl(extractDouyinAwemeId(video.id)) || video.url;
}

export function makePreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 72);
}

export function getVideoMetaText(video: Pick<Video, "publishedAt">) {
  return formatDateWithYear(video.publishedAt);
}

export function getPrimaryMetric(video: Pick<Video, "platform" | "hotScore" | "stats">) {
  if (video.platform === "douyin") {
    return {
      sortValue: Math.round(video.hotScore)
    };
  }

  return {
    sortValue: video.stats.views
  };
}
