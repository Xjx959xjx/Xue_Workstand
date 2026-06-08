import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  asArray,
  mergeTimingMeta,
  opencliBin,
  parseJsonish,
  runOpenCli,
  stringField,
  timeOpenCliOperation,
  type OpenCliTimingOptions
} from "./opencli-runtime";
import { extractBilibiliUid, extractBvid } from "./platform-links";
import { Account, CollectOrder, Video } from "./types";
import { nowIso, safeSegment, shortHash, toNumber } from "./utils";
import { firstNumber, isRelatedVideoRelevant, normalizeCommentText, normalizeTimestamp, uniqueStrings } from "./opencli-normalizers";

const BILIBILI_FETCH_TIMEOUT_MS = 15_000;
const BILIBILI_OPENCLI_VIDEO_TIMEOUT_MS = 45_000;

export type BilibiliCommentSample = {
  rank: number;
  author: string;
  text: string;
  likes: number;
  replies: number;
  time: string;
};

export type BilibiliVideoReference = {
  bvid: string;
  aid?: string;
  cid?: string;
  thumbnail?: string;
  title?: string;
};

export type BilibiliRelatedCommentVideo = {
  id: string;
  title: string;
  author: string;
  score: number;
  url: string;
};

export type BilibiliRelatedCommentResult = {
  query: string;
  videos: BilibiliRelatedCommentVideo[];
  comments: string[];
};

export type BilibiliVideoStatsResult = {
  platform: "bilibili";
  title: string;
  url: string;
  publishedAt?: string;
  authorName?: string;
  stats: {
    play: number;
    like: number;
    coin: number;
    favorite: number;
    comment: number;
    share: number;
    danmaku: number;
  };
};

class BilibiliSubtitleFetchError extends Error {
  constructor(bvid: string, errors: unknown[]) {
    const detail = errors.map(formatErrorMessage).filter(Boolean).join("；");
    super(`B站视频 ${bvid} 字幕抓取失败：${detail || "opencli 未返回可用字幕结果"}`);
    this.name = "BilibiliSubtitleFetchError";
  }
}

export async function searchBilibiliUserUid(name: string, options: { signal?: AbortSignal } = {}) {
  const stdout = await runOpenCli(["bilibili", "search", name, "--type", "user", "--limit", "8", "-f", "json"], {
    timeout: BILIBILI_OPENCLI_VIDEO_TIMEOUT_MS,
    signal: options.signal
  });
  const rows = asArray(parseJsonish(stdout));
  const normalizedName = name.trim().toLowerCase();
  const candidates = rows
    .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : null))
    .filter(Boolean) as Array<Record<string, unknown>>;
  const matched = candidates.sort((a, b) => userSearchRank(b, normalizedName) - userSearchRank(a, normalizedName))[0];

  if (!matched || typeof matched !== "object") {
    throw new Error(`没有搜索到 B站账号：${name}`);
  }

  const object = matched as Record<string, unknown>;
  const uid = extractBilibiliUid(String(object.url || object.uid || object.mid || ""));
  if (!uid) {
    throw new Error(`没有从搜索结果里解析到 B站 UID：${name}`);
  }

  return uid;
}

export async function collectBilibiliVideos(input: {
  account: Account;
  limit: number;
  order?: CollectOrder;
  page?: number;
  hydrateDetails?: boolean;
  signal?: AbortSignal;
}) {
  const args = [
    "bilibili",
    "user-videos",
    input.account.uid,
    "--limit",
    String(input.limit),
    "--order",
    getBilibiliOpenCliOrder(input.order),
    "--page",
    String(input.page || 1),
    "-f",
    "json"
  ];
  const stdout = await runOpenCli(args, {
    timeout: BILIBILI_OPENCLI_VIDEO_TIMEOUT_MS,
    signal: input.signal
  });
  const raw = parseJsonish(stdout);
  const rows = asArray(raw);
  const videos = await Promise.all(
    rows.map((row) =>
      normalizeBilibiliVideo(row, input.account, {
        hydrateDetails: input.hydrateDetails ?? true,
        signal: input.signal
      })
    )
  );

  return {
    command: `${opencliBin()} ${args.join(" ")}`,
    rawCount: rows.length,
    raw,
    videos
  };
}

export async function getBilibiliRelatedTopicComments(
  query: string,
  options: { videoLimit?: number; commentLimit?: number } = {}
): Promise<BilibiliRelatedCommentResult> {
  const cleanQuery = query.replace(/\s+/g, " ").trim();
  if (!cleanQuery) {
    return { query: "", videos: [], comments: [] };
  }

  const videoLimit = Math.max(1, Math.min(options.videoLimit || 4, 8));
  const commentLimit = Math.max(1, Math.min(options.commentLimit || 20, 50));
  const stdout = await runOpenCli([
    "bilibili",
    "search",
    cleanQuery,
    "--type",
    "video",
    "--limit",
    String(Math.max(videoLimit * 2, videoLimit)),
    "-f",
    "json"
  ], { timeout: 30_000 });
  const videos = asArray(parseJsonish(stdout))
    .map(normalizeBilibiliRelatedVideo)
    .filter((video): video is BilibiliRelatedCommentVideo => Boolean(video?.id))
    .filter((video) => isRelatedVideoRelevant(video.title, cleanQuery))
    .sort((a, b) => b.score - a.score)
    .slice(0, videoLimit);

  const comments: string[] = [];
  for (const video of videos) {
    const rows = await getBilibiliComments({ id: video.id, url: video.url, raw: video.url }, commentLimit).catch(() => []);
    comments.push(...rows.map((comment) => comment.text).filter(Boolean));
  }

  return {
    query: cleanQuery,
    videos,
    comments: uniqueStrings(comments)
  };
}

export async function getBilibiliSubtitle(video: Video, options: { signal?: AbortSignal } = {}) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return "";

  const errors: unknown[] = [];
  const preferredLangs = ["zh-CN", "ai-zh"];
  for (const lang of preferredLangs) {
    const stdout = await runBilibiliSubtitleCommand(["bilibili", "subtitle", bvid, "--lang", lang, "-f", "json"], errors, options);
    const text = extractSubtitleText(parseJsonish(stdout));
    if (isUsableBilibiliSubtitle(text, video)) return text;
  }

  const stdout = await runBilibiliSubtitleCommand(["bilibili", "subtitle", bvid, "-f", "json"], errors, options);
  const text = extractSubtitleText(parseJsonish(stdout));
  if (isUsableBilibiliSubtitle(text, video)) return text;
  if (errors.length) throw new BilibiliSubtitleFetchError(bvid, errors);
  return "";
}

export async function getBilibiliComments(video: Pick<Video, "id" | "url" | "raw">, limit = 50) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return [];

  const stdout = await runOpenCli([
    "bilibili",
    "comments",
    bvid,
    "--limit",
    String(Math.max(1, Math.min(limit, 50))),
    "-f",
    "json"
  ]);
  return asArray(parseJsonish(stdout))
    .map((row, index) => normalizeBilibiliComment(row, index))
    .filter((comment) => comment.text) as BilibiliCommentSample[];
}

export async function getBilibiliVideoReference(
  video: Pick<Video, "id" | "url" | "raw" | "title" | "coverUrl">,
  options: OpenCliTimingOptions = {}
) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return null;

  const opencliFields: Record<string, unknown> = await getBilibiliVideoFields(bvid, options).catch((error) => {
    if (isAbortError(error, options.signal)) throw error;
    return {};
  });
  const publicFields =
    extractBilibiliCid(opencliFields) && (stringField(opencliFields.thumbnail) || stringField(opencliFields.pic))
      ? {}
      : await getBilibiliPublicVideoFields(bvid, options).catch((error) => {
          if (isAbortError(error, options.signal)) throw error;
          return {};
        });
  const fields: Record<string, unknown> = {
    ...publicFields,
    ...opencliFields
  };
  const reference: BilibiliVideoReference = {
    bvid,
    aid: stringField(fields.aid),
    cid: extractBilibiliCid(fields),
    thumbnail: stringField(fields.thumbnail) || stringField(fields.pic) || video.coverUrl || findCoverUrlInRaw(video.raw),
    title: stringField(fields.title) || video.title
  };
  return reference;
}

export async function downloadBilibiliVideo(video: Video, options: { signal?: AbortSignal } = {}) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) {
    throw new Error("无法解析 B站视频 BV 号，不能下载音视频文件");
  }

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "style-library-bilibili-"));
  let completed = false;

  try {
    const stdout = await runOpenCli(["bilibili", "download", bvid, "--output", outputDir, "-f", "json"], {
      signal: options.signal
    });
    const raw = parseJsonish(stdout);
    const rows = asArray(raw);
    const failed = rows.find((row) => {
      if (!row || typeof row !== "object") return false;
      return String((row as Record<string, unknown>).status || "").toLowerCase() === "failed";
    }) as Record<string, unknown> | undefined;

    if (failed) {
      const detail = String(failed.size || failed.message || failed.error || "下载失败");
      throw new Error(`B站视频下载失败：${detail}`);
    }

    const files = await collectMediaFiles(outputDir);
    if (!files.length) {
      throw new Error("B站视频下载后没有找到可转写的本地媒体文件");
    }

    completed = true;
    return files[0];
  } finally {
    if (!completed) {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function hydrateBilibiliVideoStats(video: Video) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return video;

  const metadata = await getBilibiliVideoFields(bvid);
  return {
    ...video,
    coverUrl: String(metadata.thumbnail || video.coverUrl || ""),
    duration: String(metadata.duration || video.duration || ""),
    stats: {
      views: toNumber(metadata.view ?? video.stats.views),
      likes: toNumber(metadata.like ?? video.stats.likes),
      comments: toNumber(metadata.reply ?? video.stats.comments),
      favorites: toNumber(metadata.favorite ?? video.stats.favorites),
      shares: toNumber(metadata.share ?? video.stats.shares)
    },
    raw: { ...(typeof video.raw === "object" && video.raw ? video.raw : {}), metadata },
    updatedAt: nowIso()
  };
}

export async function getBilibiliVideoStatsByUrl(
  url: string,
  options: OpenCliTimingOptions = {}
): Promise<BilibiliVideoStatsResult> {
  const resolvedUrl = await timeOpenCliOperation(
    options,
    "bilibili.resolve-url",
    () => resolveBilibiliVideoUrl(url, options),
    { shortLink: /b23\.tv/i.test(url) }
  );
  const bvid = extractBvid(resolvedUrl);
  if (!bvid) {
    throw new Error("没有从链接里解析到 B 站 BV 号，请粘贴完整视频链接。");
  }

  const [opencliResult, publicResult] = await Promise.allSettled([
    getBilibiliVideoFields(bvid, options),
    getBilibiliPublicVideoFields(bvid, options)
  ]);
  const opencliFields = opencliResult.status === "fulfilled" ? opencliResult.value : {};
  const publicFields = publicResult.status === "fulfilled" ? publicResult.value : {};
  const stat = publicFields.stat && typeof publicFields.stat === "object" ? (publicFields.stat as Record<string, unknown>) : {};
  const metadata = {
    ...publicFields,
    ...stat,
    ...opencliFields
  };
  if (!hasBilibiliStatFields(metadata)) {
    throw new Error(formatBilibiliStatsFetchError(bvid, opencliResult, publicResult));
  }
  const owner = metadata.owner && typeof metadata.owner === "object" ? (metadata.owner as Record<string, unknown>) : {};

  return {
    platform: "bilibili" as const,
    title: stringField(metadata.title),
    url: `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`,
    publishedAt: normalizeTimestamp(metadata.pubdate || metadata.publish_time || metadata.created_at || metadata.date),
    authorName:
      stringField(owner.name) ||
      stringField(owner.uname) ||
      stringField(metadata.owner_name) ||
      stringField(metadata.author) ||
      stringField(metadata.uname),
    stats: {
      play: firstNumber(metadata.view, metadata.views),
      like: firstNumber(metadata.like, metadata.likes),
      coin: firstNumber(metadata.coin),
      favorite: firstNumber(metadata.favorite, metadata.favorites),
      comment: firstNumber(metadata.reply, metadata.comments),
      share: firstNumber(metadata.share, metadata.shares),
      danmaku: firstNumber(metadata.danmaku)
    }
  };
}

function userSearchRank(row: Record<string, unknown>, normalizedName: string) {
  const hasAuthor = String(row.author || "").trim() ? 10_000 : 0;
  const title = String(row.title || row.name || row.author || "").trim().toLowerCase();
  const exactName = title === normalizedName ? 10_000 : 0;
  const containsName = title && (title.includes(normalizedName) || normalizedName.includes(title)) ? 3_000 : 0;
  return exactName + containsName + hasAuthor + toNumber(row.followers || row.fans);
}

function normalizeBilibiliRelatedVideo(row: unknown): BilibiliRelatedCommentVideo | null {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const url = stringField(object.url);
  const id = extractBvid(url || stringField(object.id) || stringField(object.bvid) || String(object.raw || ""));
  if (!id) return null;
  const title = String(object.title || "").replace(/\s+/g, " ").trim();
  return {
    id,
    title,
    author: String(object.author || object.owner || object.uname || ""),
    score: toNumber(object.views || object.play || object.view) + toNumber(object.likes || object.like) * 2,
    url: url || `https://www.bilibili.com/video/${id}`
  };
}

function getBilibiliOpenCliOrder(order: CollectOrder | undefined) {
  if (order === "pubdate") return "pubdate";
  if (order === "favorites") return "stow";
  return "click";
}

async function normalizeBilibiliVideo(
  row: unknown,
  account: Account,
  options: { hydrateDetails?: boolean; signal?: AbortSignal } = {}
): Promise<Video> {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const title = String(object.title || object.name || "未命名视频");
  const url = String(object.url || object.link || "");
  const bvid = extractBvid(url) || String(object.bvid || object.BVID || object.aid || "");
  const metadata: Record<string, unknown> =
    options.hydrateDetails !== false && bvid
      ? await getBilibiliVideoFields(bvid, { signal: options.signal }).catch((error) => {
          if (isAbortError(error, options.signal)) throw error;
          return {};
        })
      : {};
  const views = toNumber(object.plays ?? object.views ?? object.play ?? object.view ?? metadata.view);
  const likes = toNumber(object.likes ?? object.like ?? metadata.like);
  const comments = toNumber(object.comments ?? object.reply ?? object.replies ?? metadata.reply);
  const favorites = toNumber(object.favorites ?? object.stow ?? object.collect ?? metadata.favorite);

  return {
    id: safeSegment(bvid || shortHash(`${title}-${url}`)),
    platform: "bilibili",
    accountId: account.id,
    title,
    url,
    coverUrl: stringField(metadata.thumbnail) || stringField(object.thumbnail) || stringField(object.pic),
    duration: String(metadata.duration || object.duration || ""),
    publishedAt: String(object.date || object.pubdate || object.created_at || metadata.publish_time || ""),
    stats: { views, likes, comments, favorites },
    hotScore: 0,
    relativeViewRate: 0,
    transcriptStatus: "not_started",
    raw: { ...(typeof row === "object" && row ? row : { value: row }), metadata },
    updatedAt: nowIso()
  };
}

async function resolveBilibiliVideoUrl(url: string, options: OpenCliTimingOptions = {}) {
  const directBvid = extractBvid(url);
  if (directBvid) return url;
  if (!/b23\.tv/i.test(url)) return url;

  try {
    const response = await fetchWithTimeout(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 style-library",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    }, BILIBILI_FETCH_TIMEOUT_MS, options.signal);
    const resolvedUrl = response.url || url;
    if (extractBvid(resolvedUrl)) return resolvedUrl;

    const text = await response.text().catch(() => "");
    return extractBvid(text) ? text : resolvedUrl;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return url;
  }
}

async function getBilibiliVideoFields(bvid: string, options: OpenCliTimingOptions = {}) {
  const stdout = await runOpenCli(["bilibili", "video", bvid, "-f", "json"], {
    timeout: BILIBILI_OPENCLI_VIDEO_TIMEOUT_MS,
    signal: options.signal,
    timingStage: "bilibili.opencli.video",
    onTiming: options.onTiming,
    timingMeta: mergeTimingMeta(options.timingMeta, { bvid })
  });
  const raw = parseJsonish(stdout);
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const object = item as Record<string, unknown>;
          return [String(object.field || ""), object.value] as const;
        })
        .filter((entry): entry is readonly [string, unknown] => Boolean(entry?.[0]))
    ) as Record<string, unknown>;
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

async function getBilibiliPublicVideoFields(bvid: string, options: OpenCliTimingOptions = {}) {
  const response = await timeOpenCliOperation(
    options,
    "bilibili.public.view",
    () => fetchWithTimeout(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 style-library",
        Referer: `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`
      }
    }, BILIBILI_FETCH_TIMEOUT_MS, options.signal),
    { bvid }
  );
  if (!response.ok) {
    throw new Error(`公开接口 HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const code = toNumber(object.code);
  if (code !== 0) {
    const message = stringField(object.message) || stringField(object.msg);
    throw new Error(`公开接口返回 ${code}${message ? `：${message}` : ""}`);
  }
  const data = object.data && typeof object.data === "object" ? (object.data as Record<string, unknown>) : {};
  if (!Object.keys(data).length) {
    throw new Error("公开接口未返回视频数据");
  }
  return data;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`B站接口请求超时：${Math.round(timeoutMs / 1000)} 秒`));
  }, timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function hasBilibiliStatFields(metadata: Record<string, unknown>) {
  return [
    "view",
    "views",
    "play",
    "plays",
    "like",
    "likes",
    "coin",
    "favorite",
    "favorites",
    "reply",
    "comments",
    "share",
    "shares",
    "danmaku"
  ].some((key) => metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== "");
}

function formatBilibiliStatsFetchError(
  bvid: string,
  opencliResult: PromiseSettledResult<Record<string, unknown>>,
  publicResult: PromiseSettledResult<Record<string, unknown>>
) {
  const details = [
    describeBilibiliStatsSource("opencli", opencliResult),
    describeBilibiliStatsSource("公开接口", publicResult)
  ].filter(Boolean);
  return `B站视频 ${bvid} 当前数据抓取失败：${details.join("；") || "没有返回可用统计数据"}。请检查本机网络或稍后重试。`;
}

function describeBilibiliStatsSource(label: string, result: PromiseSettledResult<Record<string, unknown>>) {
  if (result.status === "rejected") {
    return `${label}：${formatErrorMessage(result.reason)}`;
  }
  if (!Object.keys(result.value).length) {
    return `${label}：未返回可用数据`;
  }
  return "";
}

function formatErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  if (/Failed to fetch|fetch failed/i.test(message)) return "网络请求失败（fetch failed）";
  if (message) return message.replace(/\s+/g, " ").slice(0, 240);
  return "未知错误";
}

async function runBilibiliSubtitleCommand(args: string[], errors: unknown[], options: { signal?: AbortSignal } = {}) {
  try {
    return await runOpenCli(args, { signal: options.signal });
  } catch (error) {
    if (isAbortError(error, options.signal)) throw error;
    if (isBilibiliSubtitleMissingError(error)) return "";
    errors.push(error);
    return "";
  }
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true;
  return error instanceof Error && (error.name === "AbortError" || /任务已停止|aborted/i.test(error.message));
}

function isBilibiliSubtitleMissingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /没有字幕|无字幕|字幕不存在|未找到字幕|暂无字幕|no subtitles?|subtitle not found|not found subtitle/i.test(message);
}

function normalizeBilibiliComment(row: unknown, index: number): BilibiliCommentSample {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  return {
    rank: toNumber(object.rank) || index + 1,
    author: String(object.author || object.uname || ""),
    text: normalizeCommentText(object.text || object.content || object.message),
    likes: toNumber(object.likes || object.like),
    replies: toNumber(object.replies || object.reply),
    time: String(object.time || object.ctime || "")
  };
}

function extractBilibiliCid(fields: Record<string, unknown>) {
  const direct = stringField(fields.cid);
  if (direct) return direct;

  const pages = fields.pages || fields.parts || fields.videos;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      if (!page || typeof page !== "object") continue;
      const cid = stringField((page as Record<string, unknown>).cid);
      if (cid) return cid;
    }
  }
  return "";
}

function findCoverUrlInRaw(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const object = raw as Record<string, unknown>;
  for (const key of ["thumbnail", "pic", "cover", "cover_url", "pic_url"]) {
    const value = stringField(object[key]);
    if (value) return value;
  }
  const metadata = object.metadata && typeof object.metadata === "object" ? (object.metadata as Record<string, unknown>) : {};
  for (const key of ["thumbnail", "pic", "cover"]) {
    const value = stringField(metadata[key]);
    if (value) return value;
  }
  return "";
}

function extractSubtitleText(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const object = item as Record<string, unknown>;
          return String(object.content || object.text || object.body || "").trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    for (const key of ["text", "subtitle", "content", "body"]) {
      if (typeof object[key] === "string") return object[key] as string;
    }
    for (const key of ["data", "items", "body", "subtitles"]) {
      const nested = extractSubtitleText(object[key]);
      if (nested) return nested;
    }
  }

  return "";
}

function isUsableBilibiliSubtitle(text: string, video: Video) {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const title = String(video.title || "");
  const expectedChinese = hasCjkText(title);
  if (!expectedChinese) return true;

  const cjkCount = countMatches(trimmed, /[\u3400-\u9fff]/gu);
  const latinWordCount = countMatches(trimmed, /[A-Za-z]{2,}/g);
  const totalSignal = cjkCount + latinWordCount;
  if (!totalSignal) return true;

  const cjkRatio = cjkCount / totalSignal;
  return cjkCount >= 20 || cjkRatio >= 0.15;
}

function hasCjkText(text: string) {
  return /[\u3400-\u9fff]/u.test(text);
}

function countMatches(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(pattern)).length;
}

async function collectMediaFiles(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const mediaFiles: string[] = [];

  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      mediaFiles.push(...(await collectMediaFiles(target)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (/\.(mp4|m4a|mp3|wav|aac|flac|ogg|webm|mov|mkv)$/i.test(entry.name)) {
      mediaFiles.push(target);
    }
  }

  return mediaFiles;
}
