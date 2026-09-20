import { mapWithConcurrency } from "./concurrency";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  asArray,
  mergeTimingMeta,
  opencliBin,
  parseJsonish,
  runOpenCli,
  runPersistentOpenCliBrowserAdapter,
  stringField,
  timeOpenCliOperation,
  type OpenCliTimingOptions
} from "./opencli-runtime";
import { extractBilibiliUid, extractBvid } from "./platform-links";
import { Account, CollectOrder, Video } from "./types";
import { nowIso, safeSegment, shortHash, toNumber } from "./utils";
import {
  containsPlatformUserMention,
  firstNumber,
  isExcludedRelatedVideo,
  isRelatedVideoRelevant,
  normalizeCommentText,
  normalizeTimestamp,
  uniqueStrings
} from "./opencli-normalizers";

const BILIBILI_FETCH_TIMEOUT_MS = 15_000;
const BILIBILI_OPENCLI_VIDEO_TIMEOUT_MS = 45_000;
const BILIBILI_DETAIL_CONCURRENCY = 6;
const BILIBILI_COMMENT_CONCURRENCY = 6;

export type BilibiliCommentSample = {
  rank: number;
  rpid?: string;
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
  views: number;
  likes: number;
  publishedAt?: string;
  url: string;
};

export type BilibiliRelatedCommentSample = BilibiliCommentSample & {
  videoId: string;
  videoTitle: string;
};

export type BilibiliRelatedCommentResult = {
  query: string;
  videos: BilibiliRelatedCommentVideo[];
  comments: string[];
  commentSamples: BilibiliRelatedCommentSample[];
  replyCommentCount: number;
  appliedMinViews: number;
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

type BilibiliStatsFieldSources = {
  metadata: Record<string, unknown>;
  opencliResult: PromiseSettledResult<Record<string, unknown>>;
  publicResult: PromiseSettledResult<Record<string, unknown>>;
};

type BilibiliHydratedVideoFieldsResult = {
  error?: string;
  fallbackReason?: string;
  metadata: Record<string, unknown>;
  source: "public" | "opencli" | "none";
};

class BilibiliSubtitleFetchError extends Error {
  constructor(bvid: string, errors: unknown[]) {
    const detail = errors.map(formatErrorMessage).filter(Boolean).join("；");
    super(`B站视频 ${bvid} 字幕抓取失败：${detail || "opencli 未返回可用字幕结果"}`);
    this.name = "BilibiliSubtitleFetchError";
  }
}

export async function searchBilibiliUserUid(name: string, options: { signal?: AbortSignal } = {}) {
  const stdout = await runPersistentOpenCliBrowserAdapter(["bilibili", "search", name, "--type", "user", "--limit", "8", "-f", "json"], {
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
  const stdout = await runPersistentOpenCliBrowserAdapter(args, {
    timeout: BILIBILI_OPENCLI_VIDEO_TIMEOUT_MS,
    signal: input.signal
  });
  const raw = parseJsonish(stdout);
  const rows = asArray(raw);
  const videos = await mapWithConcurrency(
    rows,
    BILIBILI_DETAIL_CONCURRENCY,
    (row) =>
      normalizeBilibiliVideo(row, input.account, {
        hydrateDetails: input.hydrateDetails ?? true,
        signal: input.signal
      })
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
  options: {
    videoLimit?: number;
    commentLimit?: number;
    replyLimit?: number;
    minViews?: number;
    excludedVideoIds?: string[];
    signal?: AbortSignal;
  } = {}
): Promise<BilibiliRelatedCommentResult> {
  const cleanQuery = query.replace(/\s+/g, " ").trim();
  if (!cleanQuery) {
    return { query: "", videos: [], comments: [], commentSamples: [], replyCommentCount: 0, appliedMinViews: 0 };
  }

  const videoLimit = Math.max(1, Math.min(options.videoLimit || 4, 8));
  const commentLimit = Math.max(1, Math.min(options.commentLimit || 20, 100));
  const replyLimit = Math.max(0, Math.min(options.replyLimit ?? 8, 20));
  const stdout = await runPersistentOpenCliBrowserAdapter([
    "bilibili",
    "search",
    cleanQuery,
    "--type",
    "video",
    "--limit",
    String(Math.max(videoLimit * 8, 24)),
    "-f",
    "json"
  ], { timeout: 30_000, signal: options.signal });
  const candidates = asArray(parseJsonish(stdout))
    .map(normalizeBilibiliRelatedVideo)
    .filter((video): video is BilibiliRelatedCommentVideo => Boolean(video?.id))
    .filter((video) => !isExcludedRelatedVideo(video.id, options.excludedVideoIds))
    .filter((video) => isRelatedVideoRelevant(video.title, cleanQuery));
  const videos = candidates.sort(compareBilibiliRelatedVideos).slice(0, videoLimit);
  const appliedMinViews = videos.length ? Math.min(...videos.map((video) => video.views)) : 0;

  const videoCommentResults = await mapWithConcurrency(videos, BILIBILI_COMMENT_CONCURRENCY, async (video) => {
    const rows = await getBilibiliComments(
      { id: video.id, url: video.url, raw: video.url },
      commentLimit,
      { signal: options.signal }
    ).catch((error) => {
      if (isAbortError(error, options.signal)) throw error;
      return [];
    });
    const usableRows = rows.filter((comment) => !containsPlatformUserMention(comment.text));
    const comments = usableRows.map((comment) => comment.text).filter(Boolean);
    const commentSamples = usableRows.map((comment) => ({ ...comment, videoId: video.id, videoTitle: video.title }));
    const replyRoot = usableRows
      .filter((comment) => comment.rpid && comment.replies > 0)
      .sort((left, right) => right.replies - left.replies || right.likes - left.likes)[0];
    let replyCommentCount = 0;
    if (replyLimit && replyRoot?.rpid) {
      const replies = await getBilibiliCommentReplies(video.id, replyRoot.rpid, replyLimit, options.signal).catch((error) => {
        if (isAbortError(error, options.signal)) throw error;
        return [];
      });
      const usableReplies = replies.filter((comment) => !containsPlatformUserMention(comment.text));
      replyCommentCount += usableReplies.length;
      comments.push(...usableReplies.map((comment) => comment.text).filter(Boolean));
      commentSamples.push(...usableReplies.map((comment) => ({ ...comment, videoId: video.id, videoTitle: video.title })));
    }
    return { comments, commentSamples, replyCommentCount };
  });
  const comments = videoCommentResults.flatMap((result) => result.comments);
  const commentSamples = videoCommentResults.flatMap((result) => result.commentSamples);
  const replyCommentCount = videoCommentResults.reduce((sum, result) => sum + result.replyCommentCount, 0);

  return {
    query: cleanQuery,
    videos,
    comments: uniqueStrings(comments),
    commentSamples: dedupeBilibiliCommentSamples(commentSamples),
    replyCommentCount,
    appliedMinViews
  };
}

async function getBilibiliCommentReplies(bvid: string, rpid: string, limit: number, signal?: AbortSignal) {
  return resolveBilibiliCommentRows(
    () => getBilibiliPublicCommentReplies(bvid, rpid, limit, signal),
    async () => {
      const stdout = await runOpenCli([
        "bilibili",
        "comments",
        bvid,
        "--parent",
        rpid,
        "--limit",
        String(Math.max(1, Math.min(limit, 20))),
        "-f",
        "json"
      ], { timeout: 30_000, signal });
      return asArray(parseJsonish(stdout))
        .map((row, index) => normalizeBilibiliComment(row, index))
        .filter((comment) => comment.text);
    },
    { signal, label: `B站视频 ${bvid} 的回复` }
  );
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

export async function getBilibiliComments(
  video: Pick<Video, "id" | "url" | "raw">,
  limit = 50,
  options: { signal?: AbortSignal } = {}
) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return [];

  const normalizedLimit = Math.max(1, Math.min(limit, 200));
  return resolveBilibiliCommentRows(
    () => getBilibiliPublicComments(bvid, normalizedLimit, options.signal),
    async () => {
      const stdout = await runOpenCli([
        "bilibili",
        "comments",
        bvid,
        "--limit",
        String(Math.min(normalizedLimit, 50)),
        "-f",
        "json"
      ], { timeout: 30_000, signal: options.signal });
      return asArray(parseJsonish(stdout))
        .map((row, index) => normalizeBilibiliComment(row, index))
        .filter((comment) => comment.text) as BilibiliCommentSample[];
    },
    { signal: options.signal, label: `B站视频 ${bvid} 的评论` }
  );
}

export async function resolveBilibiliCommentRows<T>(
  loadPublicRows: () => Promise<T[]>,
  loadOpenCliRows: () => Promise<T[]>,
  options: { signal?: AbortSignal; label?: string } = {}
) {
  let publicError: unknown;
  try {
    const rows = await loadPublicRows();
    if (rows.length) return rows;
  } catch (error) {
    if (isAbortError(error, options.signal)) throw error;
    publicError = error;
  }

  try {
    return await loadOpenCliRows();
  } catch (error) {
    if (isAbortError(error, options.signal)) throw error;
    const label = options.label || "B站评论";
    const publicReason = publicError ? formatErrorMessage(publicError) : "未返回可用数据";
    throw new Error(`${label}抓取失败：官方接口：${publicReason}；OpenCLI：${formatErrorMessage(error)}`);
  }
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

export async function getBilibiliPublicVideoReference(
  video: Pick<Video, "id" | "url" | "raw" | "title" | "coverUrl">,
  options: OpenCliTimingOptions = {}
) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return null;

  const fields = await getBilibiliPublicVideoFields(bvid, options);
  return {
    bvid,
    aid: stringField(fields.aid),
    cid: extractBilibiliCid(fields),
    thumbnail: stringField(fields.thumbnail) || stringField(fields.pic) || video.coverUrl || findCoverUrlInRaw(video.raw),
    title: stringField(fields.title) || video.title
  } satisfies BilibiliVideoReference;
}

export async function downloadBilibiliVideo(video: Video, options: { signal?: AbortSignal } = {}) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) {
    throw new Error("无法解析 B站视频 BV 号，不能下载音视频文件");
  }

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "style-library-bilibili-"));
  let completed = false;

  try {
    const stdout = await runPersistentOpenCliBrowserAdapter(["bilibili", "download", bvid, "--output", outputDir, "-f", "json"], {
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

export async function hydrateBilibiliVideoStats(video: Video): Promise<Video> {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) throw new Error("没有从视频记录里解析到 B 站 BV 号，无法补全统计数据。");

  const metadata = await getBilibiliVideoFields(bvid);
  const requiredFields = ["view", "like", "reply", "favorite"] as const;
  const fieldMap = {
    view: "views",
    like: "likes",
    reply: "comments",
    favorite: "favorites"
  } as const;
  const missingFields: Array<keyof Video["stats"]> = requiredFields
    .filter((field) => metadata[field] === undefined || metadata[field] === null)
    .map((field) => fieldMap[field]);
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
    statsHydration: {
      status: missingFields.length ? "partial" : "complete",
      source: "opencli",
      checkedAt: nowIso(),
      missingFields
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

  const { metadata, opencliResult, publicResult } = await resolveBilibiliStatsFieldSources(
    () => getBilibiliPublicVideoFields(bvid, options),
    () => getBilibiliVideoFields(bvid, options)
  );
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

export async function resolveBilibiliStatsFieldSources(
  loadPublicFields: () => Promise<Record<string, unknown>>,
  loadOpenCliFields: () => Promise<Record<string, unknown>>
): Promise<BilibiliStatsFieldSources> {
  const [publicResult] = await Promise.allSettled([loadPublicFields()]);
  if (publicResult.status === "fulfilled") {
    const publicFields = publicResult.value;
    const stat = publicFields.stat && typeof publicFields.stat === "object"
      ? (publicFields.stat as Record<string, unknown>)
      : {};
    const metadata = { ...publicFields, ...stat };
    if (hasBilibiliStatFields(metadata)) {
      return {
        metadata,
        publicResult,
        opencliResult: { status: "fulfilled", value: {} }
      };
    }
  }

  const [opencliResult] = await Promise.allSettled([loadOpenCliFields()]);
  const publicFields = publicResult.status === "fulfilled" ? publicResult.value : {};
  const stat = publicFields.stat && typeof publicFields.stat === "object"
    ? (publicFields.stat as Record<string, unknown>)
    : {};
  const opencliFields = opencliResult.status === "fulfilled" ? opencliResult.value : {};
  return {
    metadata: { ...publicFields, ...stat, ...opencliFields },
    opencliResult,
    publicResult
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
    views: toNumber(object.views || object.play || object.view),
    likes: toNumber(object.likes || object.like),
    publishedAt: normalizeTimestamp(object.date || object.pubdate || object.created_at || object.publish_time),
    url: url || `https://www.bilibili.com/video/${id}`
  };
}

function compareBilibiliRelatedVideos(left: BilibiliRelatedCommentVideo, right: BilibiliRelatedCommentVideo) {
  return relatedVideoRank(right.score, right.publishedAt) - relatedVideoRank(left.score, left.publishedAt);
}

function relatedVideoRank(metric: number, publishedAt?: string) {
  const timestamp = publishedAt ? Date.parse(publishedAt) : 0;
  if (!timestamp) return metric;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  const recencyWeight = ageDays <= 30 ? 1.25 : ageDays <= 180 ? 1.15 : ageDays <= 365 ? 1.05 : 0.9;
  return metric * recencyWeight;
}

function dedupeBilibiliCommentSamples(values: BilibiliRelatedCommentSample[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.videoId}\n${value.text.toLowerCase()}`;
    if (!value.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const metadataResult =
    options.hydrateDetails !== false && bvid
      ? await getBilibiliHydratedVideoFields(bvid, { signal: options.signal })
      : ({ metadata: {}, source: "none" } satisfies BilibiliHydratedVideoFieldsResult);
  const metadata = metadataResult.metadata;
  const views = firstNumber(object.plays, object.views, object.play, object.view, metadata.view);
  const likes = firstNumber(object.likes, object.like, metadata.like);
  const comments = firstNumber(object.comments, object.reply, object.replies, metadata.reply);
  const favorites = firstNumber(object.favorites, object.stow, object.collect, metadata.favorite);

  return {
    id: safeSegment(bvid || shortHash(`${title}-${url}`)),
    platform: "bilibili",
    accountId: account.id,
    title,
    url,
    coverUrl: stringField(metadata.thumbnail) || stringField(metadata.pic) || stringField(metadata.cover) || stringField(object.thumbnail) || stringField(object.pic),
    duration: String(metadata.duration || object.duration || ""),
    publishedAt: normalizeTimestamp(object.date || object.pubdate || object.created_at || metadata.publish_time || metadata.pubdate),
    stats: { views, likes, comments, favorites },
    hotScore: 0,
    relativeViewRate: 0,
    transcriptStatus: "not_started",
    raw: {
      ...(typeof row === "object" && row ? row : { value: row }),
      metadata,
      metadataSource: metadataResult.source,
      ...(metadataResult.fallbackReason ? { metadataFallbackReason: metadataResult.fallbackReason } : {}),
      ...(metadataResult.error ? { metadataError: metadataResult.error } : {})
    },
    updatedAt: nowIso()
  };
}

async function getBilibiliHydratedVideoFields(
  bvid: string,
  options: OpenCliTimingOptions = {}
): Promise<BilibiliHydratedVideoFieldsResult> {
  const publicResult = await getBilibiliPublicVideoFields(bvid, options).catch((error) => {
    if (isAbortError(error, options.signal)) throw error;
    return toError(error);
  });
  if (!(publicResult instanceof Error)) {
    return { metadata: normalizeBilibiliPublicFields(publicResult), source: "public" as const };
  }

  const opencliResult = await getBilibiliVideoFields(bvid, options).catch((error) => {
    if (isAbortError(error, options.signal)) throw error;
    return toError(error);
  });
  if (!(opencliResult instanceof Error)) {
    return {
      fallbackReason: `公开接口：${formatErrorMessage(publicResult)}`,
      metadata: opencliResult,
      source: "opencli" as const
    };
  }

  return {
    error: `公开接口：${formatErrorMessage(publicResult)}；opencli：${formatErrorMessage(opencliResult)}`,
    metadata: {},
    source: "none" as const
  };
}

function normalizeBilibiliPublicFields(fields: Record<string, unknown>) {
  const stat = fields.stat && typeof fields.stat === "object" ? (fields.stat as Record<string, unknown>) : {};
  return {
    ...fields,
    ...stat
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
  const stdout = await runPersistentOpenCliBrowserAdapter(["bilibili", "video", bvid, "-f", "json"], {
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

async function getBilibiliPublicComments(bvid: string, limit: number, signal?: AbortSignal) {
  const fields = await getBilibiliPublicVideoFields(bvid, { signal });
  const aid = stringField(fields.aid);
  if (!aid) throw new Error("官方接口未返回视频 aid");
  const pageSize = Math.min(20, limit);
  const pageCount = Math.ceil(limit / pageSize);
  const pages: BilibiliCommentSample[][] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    pages.push(await getBilibiliPublicCommentPage(bvid, aid, page, pageSize, signal));
  }
  return dedupePublicBilibiliComments(pages.flat()).slice(0, limit);
}

async function getBilibiliPublicCommentPage(
  bvid: string,
  aid: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal
) {
  const url = new URL("https://api.bilibili.com/x/v2/reply");
  url.searchParams.set("type", "1");
  url.searchParams.set("oid", aid);
  url.searchParams.set("pn", String(page));
  url.searchParams.set("ps", String(pageSize));
  url.searchParams.set("sort", "2");
  const payload = await fetchBilibiliPublicCommentPayload(url, bvid, signal);
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  const rows = [
    ...asArray(data.hots),
    ...asArray(data.top_replies),
    ...asArray(data.replies)
  ];
  return rows.map((row, index) => normalizeBilibiliPublicComment(row, (page - 1) * pageSize + index));
}

async function getBilibiliPublicCommentReplies(
  bvid: string,
  rpid: string,
  limit: number,
  signal?: AbortSignal
) {
  const fields = await getBilibiliPublicVideoFields(bvid, { signal });
  const aid = stringField(fields.aid);
  if (!aid) throw new Error("官方接口未返回视频 aid");
  const normalizedLimit = Math.max(1, Math.min(limit, 20));
  const url = new URL("https://api.bilibili.com/x/v2/reply/reply");
  url.searchParams.set("type", "1");
  url.searchParams.set("oid", aid);
  url.searchParams.set("root", rpid);
  url.searchParams.set("pn", "1");
  url.searchParams.set("ps", String(normalizedLimit));
  const payload = await fetchBilibiliPublicCommentPayload(url, bvid, signal);
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  return dedupePublicBilibiliComments(
    asArray(data.replies).map((row, index) => normalizeBilibiliPublicComment(row, index))
  ).slice(0, normalizedLimit);
}

async function fetchBilibiliPublicCommentPayload(url: URL, bvid: string, signal?: AbortSignal) {
  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 style-library",
      Referer: `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`
    }
  }, BILIBILI_FETCH_TIMEOUT_MS, signal);
  if (!response.ok) throw new Error(`公开评论接口 HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  const object = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const code = toNumber(object.code);
  if (code !== 0) {
    const message = stringField(object.message) || stringField(object.msg);
    throw new Error(`公开评论接口返回 ${code}${message ? `：${message}` : ""}`);
  }
  return object;
}

function normalizeBilibiliPublicComment(row: unknown, index: number): BilibiliCommentSample {
  const object = row && typeof row === "object" ? row as Record<string, unknown> : {};
  const member = object.member && typeof object.member === "object" ? object.member as Record<string, unknown> : {};
  const content = object.content && typeof object.content === "object" ? object.content as Record<string, unknown> : {};
  return {
    rank: index + 1,
    rpid: stringField(object.rpid_str) || stringField(object.rpid) || undefined,
    author: stringField(member.uname),
    text: normalizeCommentText(content.message),
    likes: toNumber(object.like),
    replies: toNumber(object.rcount) || asArray(object.replies).length,
    time: normalizeTimestamp(object.ctime)
  };
}

function dedupePublicBilibiliComments(rows: BilibiliCommentSample[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.rpid || row.text.toLowerCase();
    if (!row.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(formatErrorMessage(error));
}

async function runBilibiliSubtitleCommand(args: string[], errors: unknown[], options: { signal?: AbortSignal } = {}) {
  try {
    return await runPersistentOpenCliBrowserAdapter(args, { signal: options.signal });
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
    rpid: String(object.rpid || object.id || "").trim() || undefined,
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
