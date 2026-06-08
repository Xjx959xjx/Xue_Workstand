import type { Draft, Platform } from "./types";

export type WriteCopyScopeInput = {
  targetType?: "account" | "project";
  platform?: Platform;
  accountId?: string;
  projectId?: string;
  mode: Draft["mode"];
  prompt?: string;
  sourceText?: string;
  supportDocLinks?: string;
  brief?: string;
  useWebResearch?: boolean;
};

export function writeCopySourceKey(input: WriteCopyScopeInput) {
  return stableScopeHash(JSON.stringify({
    targetType: input.targetType || "account",
    platform: input.platform || "",
    accountId: input.accountId || "",
    projectId: input.projectId || "",
    mode: input.mode,
    prompt: normalizeScopeText(input.prompt),
    sourceText: normalizeScopeText(input.sourceText),
    supportDocLinks: normalizeScopeLinks(input.supportDocLinks),
    brief: normalizeScopeText(input.brief),
    useWebResearch: Boolean(input.useWebResearch)
  }));
}

export function engagementSourceKey(input: {
  sourceType: "text";
  text: string;
  includeComments?: boolean;
  commentCount?: number;
  includeDanmaku?: boolean;
  danmakuCount?: number;
} | {
  sourceType: "url";
  url: string;
  includeComments?: boolean;
  commentCount?: number;
  includeDanmaku?: boolean;
  danmakuCount?: number;
}) {
  return stableScopeHash(JSON.stringify({
    sourceType: input.sourceType,
    source: input.sourceType === "url" ? normalizeScopeText(input.url) : normalizeScopeText(input.text),
    includeComments: input.includeComments ?? true,
    commentCount: input.commentCount ?? 100,
    includeDanmaku: input.includeDanmaku ?? false,
    danmakuCount: input.danmakuCount ?? 50
  }));
}

function normalizeScopeText(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeScopeLinks(value?: string) {
  return (value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function stableScopeHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}-${value.length.toString(36)}`;
}
