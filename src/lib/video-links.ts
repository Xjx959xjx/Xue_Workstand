import type { GrossMarginPriceTable } from "./types";
import { extractFirstLinkFromInput, normalizeLinkInput } from "./link-input";

type GrossMarginPlatform = GrossMarginPriceTable["platform"];

export function extractVideoUrl(input?: string) {
  return extractFirstLinkFromInput(input, { kind: "video" });
}

export function normalizeVideoUrlInput(input: string) {
  return normalizeLinkInput(input, { kind: "video" });
}

export function detectVideoPlatform(input?: string): GrossMarginPlatform | null {
  const text = input || "";
  if (/BV[0-9A-Za-z]+|bilibili\.com|b23\.tv/i.test(text)) return "bilibili";
  if (/douyin\.com|iesdouyin\.com|aweme/i.test(text)) return "douyin";
  return null;
}

export function getVideoComparableKey(input?: string) {
  const normalized = extractVideoUrl(input) || input?.trim() || "";
  if (!normalized) return "";

  const bvid = normalized.match(/BV[0-9A-Za-z]+/i)?.[0];
  if (bvid) return `bilibili:${bvid.toUpperCase()}`;

  const douyinVideoId =
    normalized.match(/\/video\/(\d{10,})/i)?.[1] ||
    normalized.match(/\/aweme\/share\/video\/(\d{10,})/i)?.[1];
  if (douyinVideoId) return `douyin:${douyinVideoId}`;

  try {
    const parsed = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
    const platform = detectVideoPlatform(normalized) || parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${platform}:${parsed.hostname.toLowerCase()}${pathname}`;
  } catch {
    return normalized.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}
