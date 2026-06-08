import { toNumber } from "./utils";

export function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = toNumber(value);
    if (number > 0) return number;
  }
  return 0;
}

export function normalizeCommentText(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["text", "content", "message", "comment", "reply"]) {
      const text: string = normalizeCommentText(object[key]);
      if (text) return text;
    }
    return JSON.stringify(value);
  }
  return "";
}

export function normalizeTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return normalizeTimestamp(Number(trimmed));
    return trimmed;
  }

  return "";
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

export function isRelatedVideoRelevant(title: string, query: string) {
  const normalizedTitle = normalizeSearchComparableText(title);
  if (!normalizedTitle) return false;
  const terms = extractRelatedSearchTerms(query);
  if (!terms.length) return true;

  const matched = terms.filter((term) => normalizedTitle.includes(normalizeSearchComparableText(term)));
  if (matched.length >= Math.min(2, terms.length)) return true;
  return matched.some((term) => Array.from(term).length >= 4);
}

function extractRelatedSearchTerms(query: string) {
  return uniqueStrings(
    query
      .split(/[\s，,。.!！?？；;：:、｜|/\\()[\]{}<>《》“”"‘’#]+/)
      .map((term) => term.trim())
      .filter((term) => Array.from(term).length >= 2)
      .filter((term) => !RELATED_SEARCH_TERM_STOP_WORDS.has(term.toLowerCase()))
  ).slice(0, 8);
}

function normalizeSearchComparableText(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9._-]+/g, "")
    .toLowerCase();
}

const RELATED_SEARCH_TERM_STOP_WORDS = new Set([
  "视频",
  "评论",
  "弹幕",
  "文案",
  "素材",
  "热点",
  "话题",
  "生成",
  "douyin",
  "抖音"
]);
