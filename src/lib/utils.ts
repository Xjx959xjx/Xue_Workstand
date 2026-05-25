import crypto from "crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function safeSegment(input: string, fallback = "untitled") {
  const cleaned = input
    .trim()
    .replace(/[\\/:*?"<>|#%{}[\]^~`]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || fallback;
}

export function shortHash(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 10);
}

export function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;

  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return 0;

  const unit = normalized.match(/^([\d.]+)\s*([万億亿wWkKmM]?)$/);
  if (!unit) {
    const parsed = Number(normalized.replace(/[^\d.]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const base = Number(unit[1]);
  if (!Number.isFinite(base)) return 0;

  const suffix = unit[2].toLowerCase();
  if (suffix === "w") return Math.round(base * 10_000);
  if (suffix === "万") return Math.round(base * 10_000);
  if (suffix === "亿" || suffix === "億") return Math.round(base * 100_000_000);
  if (suffix === "k") return Math.round(base * 1_000);
  if (suffix === "m") return Math.round(base * 1_000_000);
  return Math.round(base);
}

export function clampText(input: string, maxLength: number) {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}…`;
}

export function makeTitleFromPrompt(prompt: string) {
  return makeDraftTitleFromContent(prompt, "draft");
}

export function makeDraftTitleFromContent(content: string, fallback = "未命名草稿") {
  const candidates = collectDraftTitleCandidates(content, fallback);
  const best = candidates
    .map((candidate, index) => ({ ...candidate, title: cleanDraftTitleCandidate(candidate.text), index }))
    .filter((candidate) => candidate.title && !DRAFT_TITLE_STOP_WORDS.has(candidate.title))
    .sort((a, b) => scoreDraftTitle(b.title, b.index, b.weight) - scoreDraftTitle(a.title, a.index, a.weight))[0]?.title;

  return clampDraftTitle(best || cleanDraftTitleCandidate(fallback) || "未命名草稿", 20);
}

type DraftTitleCandidate = {
  text: string;
  weight: number;
};

function collectDraftTitleCandidates(content: string, fallback: string) {
  const normalized = content.replace(/\r/g, "").trim();
  const candidates: DraftTitleCandidate[] = [];
  const rawLines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  rawLines.slice(0, 16).forEach((line, index) => {
    const titleLine = line.match(/^(?:#{1,4}\s*)?(?:标题|题目|名称)(?:\s*[：:]\s*(.+)|\s+(.+))?$/);
    const inlineTitle = titleLine?.[1] || titleLine?.[2];
    if (inlineTitle) {
      candidates.push({ text: inlineTitle, weight: 500 });
      return;
    }

    if (titleLine && rawLines[index + 1]) {
      candidates.push({ text: rawLines[index + 1], weight: 500 });
    }
  });

  for (const match of normalized.matchAll(/(?:^|\n)\s*(?:#{1,4}\s*)?(?:标题|题目|名称)\s*[：:]\s*([^\n]+)/g)) {
    candidates.push({ text: match[1], weight: 500 });
  }

  for (const match of normalized.matchAll(/[《“"]([^》”"\n]{2,30})[》”"]/g)) {
    candidates.push({ text: match[1], weight: 180 });
  }

  const lines = rawLines.slice(0, 12);
  candidates.push(...lines.map((line) => ({ text: line, weight: 80 })));

  const chunks = normalized
    .replace(/[，,、]/g, "。")
    .split(/[。！？!?；;\n]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .slice(0, 24);
  candidates.push(...chunks.map((chunk) => ({ text: chunk, weight: 0 })));

  if (fallback) candidates.push({ text: fallback, weight: -20 });
  return candidates;
}

function cleanDraftTitleCandidate(candidate: string) {
  return candidate
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/#[\u4e00-\u9fa5A-Za-z0-9_-]+/g, " ")
    .replace(/^[\s#>*_`-]+/, "")
    .replace(/^\d+[.、]\s*/, "")
    .replace(/^(标题|题目|名称|正文|文案|口播稿|开头|结尾|互动|节奏)\s*[：:]?/i, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, "")
    .trim();
}

function scoreDraftTitle(title: string, index: number, weight: number) {
  const length = Array.from(title).length;
  const hasChinese = /[\u4e00-\u9fa5]/.test(title);
  const idealLength = length >= 4 && length <= 20 ? 100 : 0;
  const lengthPenalty = Math.abs(Math.min(length, 28) - 12) * 2;
  return weight + idealLength + (hasChinese ? 30 : 0) - lengthPenalty - index;
}

function clampDraftTitle(title: string, maxLength: number) {
  return Array.from(title).slice(0, maxLength).join("");
}

const DRAFT_TITLE_STOP_WORDS = new Set([
  "标题",
  "题目",
  "名称",
  "正文",
  "文案",
  "口播稿",
  "开头",
  "结尾",
  "互动",
  "节奏",
  "未命名草稿",
  "draft"
]);

export function extractBvid(input?: string) {
  if (!input) return "";
  const match = input.match(/BV[0-9A-Za-z]+/);
  return match?.[0] ?? "";
}

export function extractBilibiliUid(input: string) {
  const trimmed = input.trim();
  const match = trimmed.match(/space\.bilibili\.com\/(\d+)/);
  return match?.[1] ?? trimmed;
}

export function extractDouyinSecUid(input: string) {
  const trimmed = input.trim();
  const param = trimmed.match(/[?&]sec_uid=([^&]+)/);
  if (param?.[1]) return decodeURIComponent(param[1]);

  const path = trimmed.match(/\/user\/([^/?]+)/);
  return path?.[1] ? decodeURIComponent(path[1]) : trimmed;
}

export function extractDouyinAwemeId(input?: string) {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (/^\d{10,}$/.test(trimmed)) return trimmed;

  const pathMatch = trimmed.match(/\/video\/(\d{10,})/);
  if (pathMatch?.[1]) return pathMatch[1];

  const shareMatch = trimmed.match(/\/aweme\/share\/video\/(\d{10,})/);
  if (shareMatch?.[1]) return shareMatch[1];

  const queryMatch = trimmed.match(/[?&](?:aweme_id|modal_id|item_id)=(\d{10,})/i);
  if (queryMatch?.[1]) return queryMatch[1];

  const genericMatch = trimmed.match(/(?:aweme_id|awemeId|modal_id|item_id)["'=:\s/]+(\d{10,})/i);
  if (genericMatch?.[1]) return genericMatch[1];

  return "";
}

export function buildDouyinVideoUrl(awemeId?: string) {
  const normalized = extractDouyinAwemeId(awemeId);
  return normalized ? `https://www.douyin.com/video/${encodeURIComponent(normalized)}` : "";
}

export function isLikelyDirectMediaUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return false;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const mimeType = (parsed.searchParams.get("mime_type") || "").toLowerCase();

    if (/\.(mp4|m4a|mp3|wav|aac|flac|ogg|webm|mov|mkv)$/i.test(pathname)) return true;
    if (parsed.hostname.toLowerCase().includes("douyinvod.com")) return true;
    if (/^(video|audio)_/.test(mimeType)) return true;
    if (pathname.includes("/video/tos/")) return true;
  } catch {
    return /\.(mp4|m4a|mp3|wav|aac|flac|ogg|webm|mov|mkv)(\?|$)/i.test(url);
  }

  return false;
}
