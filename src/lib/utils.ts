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

  const unit = normalized.match(/^([\d.]+)\s*([万億亿kKmM]?)$/);
  if (!unit) {
    const parsed = Number(normalized.replace(/[^\d.]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const base = Number(unit[1]);
  if (!Number.isFinite(base)) return 0;

  const suffix = unit[2].toLowerCase();
  if (suffix === "万") return Math.round(base * 10_000);
  if (suffix === "亿" || suffix === "億") return Math.round(base * 100_000_000);
  if (suffix === "k") return Math.round(base * 1_000);
  if (suffix === "m") return Math.round(base * 1_000_000);
  return Math.round(base);
}

export function clampText(input: string, maxLength: number) {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}...`;
}

export function makeTitleFromPrompt(prompt: string) {
  return safeSegment(clampText(prompt.replace(/\s+/g, " "), 32), "draft");
}

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
