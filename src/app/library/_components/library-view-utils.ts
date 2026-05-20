import { formatDateWithYear } from "@/components/Formatters";
import type { Platform, Video, VideoListItem } from "@/lib/types";
import { buildDouyinVideoUrl, extractDouyinAwemeId, isLikelyDirectMediaUrl } from "@/lib/utils";

export type BatchLimit = 3 | 5 | 10 | "all";
export type VideoSortMode = "hot" | "views" | "likes" | "comments" | "favorites" | "latest";

export const VIDEO_SORT_OPTIONS: Array<{ value: VideoSortMode; label: string }> = [
  { value: "hot", label: "综合热度" },
  { value: "views", label: "播放最多" },
  { value: "likes", label: "点赞最多" },
  { value: "comments", label: "评论最多" },
  { value: "favorites", label: "收藏最多" },
  { value: "latest", label: "发布时间" }
];

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

export function getAvailableSortOptions(platform?: Platform) {
  return VIDEO_SORT_OPTIONS.filter((option) => !(platform === "douyin" && option.value === "views"));
}
