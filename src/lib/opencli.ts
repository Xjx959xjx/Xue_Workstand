import { Account, CollectOrder, Platform, Video } from "./types";
import {
  asArray,
  buildOpenCliBrowserArgs,
  mergeTimingMeta,
  opencliBin,
  openCliRows,
  parseJsonish,
  parseOpenCliJsonish,
  resolveOpenCliCommand,
  runOpenCli,
  stringField,
  timeOpenCliOperation,
  withTimingMeta,
  type OpenCliTimingEntry,
  type OpenCliTimingMeta,
  type OpenCliTimingOptions,
  type OpenCliTimingSink
} from "./opencli-runtime";
import {
  buildDouyinVideoUrl,
  extractBilibiliUid,
  extractDouyinAwemeId,
  extractDouyinSecUid,
  getVideoComparableKey,
  isLikelyDirectMediaUrl
} from "./platform-links";
import { nowIso, safeSegment, shortHash, toNumber } from "./utils";
import { firstNumber, isRelatedVideoRelevant, normalizeCommentText, normalizeTimestamp, uniqueStrings } from "./opencli-normalizers";
import { collectBilibiliVideos, searchBilibiliUserUid } from "./opencli-bilibili";
import {
  DOUYIN_AWEME_ID_EXTRACT_JS,
  DOUYIN_MEDIA_EXTRACT_JS,
  DOUYIN_RELATED_VIDEO_EXTRACT_JS,
  DOUYIN_SEARCH_EXTRACT_JS,
  DOUYIN_VIDEO_COMMENT_EXTRACT_JS,
  buildDouyinBatchStatsExtractJs,
  buildDouyinBatchPostExtractJs,
  buildDouyinDetailExtractJs,
  buildDouyinPostExtractJs,
  buildDouyinStatsExtractJs
} from "./opencli-douyin-scripts";

const DOUYIN_BROWSER_VIDEO_SCAN_LIMIT = 500;
const DOUYIN_BATCH_POST_SCAN_TIMEOUT_MS = 300_000;
const DOUYIN_RELATED_COMMENT_VIDEO_LIMIT = 6;
const DOUYIN_RELATED_COMMENT_PER_VIDEO_LIMIT = 20;

type DouyinMediaLookupOptions = {
  limit?: number;
  signal?: AbortSignal;
};
type VideoStatsTimingOptions = OpenCliTimingOptions;

export type DouyinBatchVideoCollectResult = {
  account: Account;
  status: "completed" | "failed";
  rawCount: number;
  raw: unknown[];
  videos: Video[];
  error?: string;
};

export type { OpenCliTimingEntry, OpenCliTimingMeta, OpenCliTimingSink };
export {
  buildOpenCliBrowserArgs,
  openCliRows,
  parseOpenCliJsonish,
  resolveOpenCliCommand
};
export {
  downloadBilibiliVideo,
  getBilibiliComments,
  getBilibiliRelatedTopicComments,
  getBilibiliSubtitle,
  getBilibiliVideoReference,
  getBilibiliVideoStatsByUrl,
  hydrateBilibiliVideoStats
} from "./opencli-bilibili";
export type {
  BilibiliCommentSample,
  BilibiliRelatedCommentResult,
  BilibiliRelatedCommentVideo,
  BilibiliVideoReference,
  BilibiliVideoStatsResult
} from "./opencli-bilibili";

export type DouyinRelatedCommentVideo = {
  id: string;
  title: string;
  likes: number;
  url: string;
};

export type DouyinRelatedCommentResult = {
  query: string;
  videos: DouyinRelatedCommentVideo[];
  comments: string[];
};

type DouyinVideoStatsSnapshot = {
  title: string;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  shareCount: number;
  publishedAt?: string;
  authorName?: string;
  authorSecUid?: string;
};

type DouyinVideoStatsResult = {
  platform: "douyin";
  title: string;
  url: string;
  videoKey: string;
  publishedAt?: string;
  authorName?: string;
  authorSecUid?: string;
  stats: {
    like: number;
    comment: number;
    favorite: number;
    share: number;
  };
};

const DOUYIN_STATS_BROWSER_WORKSPACE = `douyin-video-stats-${process.pid}`;
const DOUYIN_STATS_HOME_URL = "https://www.douyin.com/robots.txt";
let douyinStatsBrowserReady = false;
let douyinStatsBrowserQueue: Promise<unknown> = Promise.resolve();

export function normalizeAccountInput(platform: Platform, uidOrUrl: string) {
  return platform === "bilibili" ? extractBilibiliUid(uidOrUrl) : extractDouyinSecUid(uidOrUrl);
}

export async function resolveAccountUid(
  platform: Platform,
  name: string,
  uidOrUrl?: string,
  options: { signal?: AbortSignal } = {}
) {
  const explicit = uidOrUrl?.trim();
  if (explicit) return normalizeAccountInput(platform, explicit);

  if (platform === "bilibili") {
    return searchBilibiliUserUid(name, { signal: options.signal });
  }

  return searchDouyinUserSecUid(name, { signal: options.signal });
}

async function searchDouyinUserSecUid(name: string, options: { signal?: AbortSignal } = {}) {
  return searchDouyinUserSecUidWithBrowser(name, options);
}

async function searchDouyinUserSecUidWithBrowser(name: string, options: { signal?: AbortSignal } = {}) {
  const workspace = `douyin-search-${process.pid}-${Date.now()}-${shortHash(name)}`;
  const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(name)}?type=user`;

  try {
    const openResult = parseJsonish(
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [searchUrl], { window: "background" }), {
        timeout: 30_000,
        signal: options.signal
      })
    );
    const tab = openResult && typeof openResult === "object" ? String((openResult as Record<string, unknown>).page || "") : "";
    const evalArgs = buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_SEARCH_EXTRACT_JS], tab ? { tab } : {});
    const rows = asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 20_000, signal: options.signal })));
    return selectDouyinSecUidFromRows(rows, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `opencli browser 没有解析到抖音账号「${name}」：${message || "没有返回结果"}。请确认账号名能在抖音搜索到，或临时填写主页链接 / sec_uid。`
    );
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }
}

export async function getDouyinRelatedTopicComments(
  query: string,
  options: { videoLimit?: number; commentLimit?: number } = {}
): Promise<DouyinRelatedCommentResult> {
  const cleanQuery = query.replace(/\s+/g, " ").trim();
  if (!cleanQuery) {
    return { query: "", videos: [], comments: [] };
  }

  const workspace = `douyin-topic-comments-${process.pid}-${Date.now()}-${shortHash(cleanQuery)}`;
  const videoLimit = Math.max(1, Math.min(options.videoLimit || DOUYIN_RELATED_COMMENT_VIDEO_LIMIT, 8));
  const commentLimit = Math.max(1, Math.min(options.commentLimit || DOUYIN_RELATED_COMMENT_PER_VIDEO_LIMIT, 30));
  const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(cleanQuery)}?type=general`;

  try {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [searchUrl], { window: "background" }), {
      timeout: 30_000
    });
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "wait", ["time", "5"]), { timeout: 12_000 }).catch(() => undefined);

    const videos = asArray(parseJsonish(await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_RELATED_VIDEO_EXTRACT_JS]), { timeout: 20_000 })))
      .map(normalizeDouyinRelatedVideo)
      .filter((video): video is DouyinRelatedCommentVideo => Boolean(video?.id))
      .filter((video) => isRelatedVideoRelevant(video.title, cleanQuery))
      .sort((a, b) => b.likes - a.likes)
      .slice(0, videoLimit);

    const comments: string[] = [];
    for (const video of videos) {
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [video.url]), { timeout: 30_000 }).catch(() => undefined);
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "wait", ["time", "5"]), { timeout: 12_000 }).catch(() => undefined);
      const rows = asArray(parseJsonish(await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_VIDEO_COMMENT_EXTRACT_JS]), { timeout: 35_000 })));
      comments.push(...rows.map(normalizeCommentText).filter(Boolean).slice(0, commentLimit));
    }

    return {
      query: cleanQuery,
      videos,
      comments: uniqueStrings(comments)
    };
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }
}

function normalizeDouyinRelatedVideo(row: unknown): DouyinRelatedCommentVideo | null {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const id = String(object.id || object.aweme_id || extractDouyinAwemeId(String(object.url || ""))).trim();
  if (!id) return null;
  const title = String(object.title || "").replace(/\s+/g, " ").trim();
  return {
    id,
    title,
    likes: toNumber(object.likes),
    url: `https://www.douyin.com/video/${encodeURIComponent(id)}`
  };
}

function selectDouyinSecUidFromRows(rows: unknown[], name: string) {
  const normalizedName = normalizeDouyinUserSearchText(name);
  const candidates = rows
    .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : null))
    .filter(Boolean) as Array<Record<string, unknown>>;
  const ranked = candidates
    .map((row) => ({
      row,
      matchScore: douyinUserSearchMatchScore(row, normalizedName),
      rank: douyinUserSearchRank(row)
    }))
    .filter((candidate) => candidate.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore || b.rank - a.rank);
  const matched = ranked[0]?.row;

  if (!candidates.length) {
    throw new Error(`没有搜索到抖音账号：${name}`);
  }
  if (!matched) {
    throw new Error(
      `抖音搜索返回了账号候选，但没有昵称匹配「${name}」的结果${formatDouyinSearchCandidateHint(candidates)}。请粘贴该账号主页链接或 sec_uid 再采集。`
    );
  }

  const secUid = extractSecUidFromSearchRow(matched);
  if (!secUid) {
    throw new Error(`没有从搜索结果里解析到抖音 sec_uid：${name}`);
  }

  return secUid;
}

function douyinUserSearchMatchScore(row: Record<string, unknown>, normalizedName: string) {
  if (!normalizedName) return 0;
  const names = getDouyinUserSearchNames(row).map(normalizeDouyinUserSearchText).filter(Boolean);
  if (names.some((name) => name === normalizedName)) return 3;
  if (normalizedName.length >= 2 && names.some((name) => name.includes(normalizedName))) return 2;
  if (names.some((name) => name.length >= 2 && normalizedName.includes(name))) return 1;
  return 0;
}

function getDouyinUserSearchNames(row: Record<string, unknown>) {
  const userInfo = row.user_info && typeof row.user_info === "object" ? (row.user_info as Record<string, unknown>) : {};
  return [
    row.nickname,
    row.name,
    row.title,
    row.unique_id,
    row.short_id,
    userInfo.nickname,
    userInfo.name,
    userInfo.unique_id,
    userInfo.short_id
  ].map((value) => String(value || "").trim());
}

function normalizeDouyinUserSearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .replace(/[，。、《》“”"':：_\-·.]/g, "");
}

function douyinUserSearchRank(row: Record<string, unknown>) {
  const userInfo = row.user_info && typeof row.user_info === "object" ? (row.user_info as Record<string, unknown>) : {};
  const rankPenalty = toNumber(row.rank) ? Math.max(0, 500 - toNumber(row.rank)) : 0;
  return rankPenalty + toNumber(row.follower_count ?? userInfo.follower_count ?? row.followers);
}

function formatDouyinSearchCandidateHint(candidates: Array<Record<string, unknown>>) {
  const labels = candidates
    .flatMap(getDouyinUserSearchNames)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .slice(0, 5);
  return labels.length ? `（候选：${labels.join("、")}）` : "";
}

function extractSecUidFromSearchRow(row: Record<string, unknown>) {
  const userInfo = row.user_info && typeof row.user_info === "object" ? (row.user_info as Record<string, unknown>) : {};
  return String(row.sec_uid || row.sec_user_id || row.secUid || userInfo.sec_uid || userInfo.sec_user_id || extractDouyinSecUid(String(row.url || "")));
}

export async function collectVideos(input: {
  platform: Platform;
  account: Account;
  limit: number;
  order?: CollectOrder;
  page?: number;
  hydrateDetails?: boolean;
  fromDate?: string;
  toDate?: string;
  signal?: AbortSignal;
}) {
  if (input.platform === "bilibili") {
    return collectBilibiliVideos({
      account: input.account,
      limit: input.limit,
      order: input.order,
      page: input.page,
      hydrateDetails: input.hydrateDetails,
      signal: input.signal
    });
  }

  const args = [
    "browser",
    "aweme-post",
    `https://www.douyin.com/user/${input.account.uid}`,
    "--limit",
    String(input.limit),
    ...(input.fromDate ? ["--from", input.fromDate] : []),
    ...(input.toDate ? ["--to", input.toDate] : [])
  ];
  let rows: unknown[];
  try {
    rows = await scanDouyinPostVideoRows(input.account, {
      limit: input.limit,
      fromDate: input.fromDate,
      toDate: input.toDate,
      signal: input.signal
    });
  } catch {
    if (input.signal?.aborted) throw createAbortError();
    rows = await getDouyinVideoRows(input.account, { limit: input.limit, signal: input.signal });
  }

  return {
    command: `${opencliBin()} ${args.join(" ")}`,
    rawCount: rows.length,
    raw: rows,
    videos: rows.map((row) => normalizeDouyinVideo(row, input.account))
  };
}

export async function collectDouyinPostVideosBatch(input: {
  accounts: Account[];
  concurrency: number;
  limit: number;
  fromDate?: string;
  toDate?: string;
  signal?: AbortSignal;
}): Promise<DouyinBatchVideoCollectResult[]> {
  if (!input.accounts.length) return [];

  const workspace = `douyin-post-batch-${process.pid}-${Date.now()}-${shortHash(input.accounts.map((account) => account.uid).join("|"))}`;
  const scanLimit = Math.min(Math.max(input.limit, 1), DOUYIN_BROWSER_VIDEO_SCAN_LIMIT);
  const concurrency = Math.min(Math.max(input.concurrency, 1), input.accounts.length);

  try {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [DOUYIN_STATS_HOME_URL], { window: "background" }), {
      timeout: 30_000,
      signal: input.signal
    });
    const stdout = await runOpenCli(
      buildOpenCliBrowserArgs(workspace, "eval", [
        buildDouyinBatchPostExtractJs({
          accounts: input.accounts.map((account) => ({
            id: account.id,
            name: account.name,
            uid: account.uid
          })),
          concurrency,
          fromDate: input.fromDate,
          limit: scanLimit,
          toDate: input.toDate
        })
      ]),
      {
        timeout: DOUYIN_BATCH_POST_SCAN_TIMEOUT_MS,
        signal: input.signal
      }
    );
    return normalizeDouyinBatchCollectResults(input.accounts, asArray(parseJsonish(stdout)));
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) throw createAbortError();
    const message = error instanceof Error ? error.message : "抖音批量抓取失败";
    return input.accounts.map((account) => makeFailedDouyinBatchCollectResult(account, `抖音批量抓取失败：${message}`));
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }
}

async function scanDouyinPostVideoRows(
  account: Account,
  options: {
    limit: number;
    fromDate?: string;
    toDate?: string;
    signal?: AbortSignal;
  }
) {
  const workspace = `douyin-post-${process.pid}-${Date.now()}-${shortHash(account.uid)}`;
  const scanLimit = Math.min(Math.max(options.limit, 1), DOUYIN_BROWSER_VIDEO_SCAN_LIMIT);

  try {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [DOUYIN_STATS_HOME_URL], { window: "background" }), {
      timeout: 30_000,
      signal: options.signal
    });
    const evalArgs = buildOpenCliBrowserArgs(workspace, "eval", [
      buildDouyinPostExtractJs({
        secUid: account.uid,
        limit: scanLimit,
        fromDate: options.fromDate,
        toDate: options.toDate
      })
    ]);
    return asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 90_000, signal: options.signal })));
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }
}

function normalizeDouyinBatchCollectResults(
  accounts: Account[],
  rawResults: unknown[]
): DouyinBatchVideoCollectResult[] {
  const resultsByAccount = new Map<string, Record<string, unknown>>();
  for (const raw of rawResults) {
    if (!raw || typeof raw !== "object") continue;
    const result = raw as Record<string, unknown>;
    const accountId = stringField(result.accountId);
    const uid = stringField(result.uid);
    if (accountId) resultsByAccount.set(accountId, result);
    if (uid) resultsByAccount.set(uid, result);
  }

  return accounts.map((account) => {
    const result = resultsByAccount.get(account.id) || resultsByAccount.get(account.uid);
    if (!result) {
      return makeFailedDouyinBatchCollectResult(account, "抖音批量抓取没有返回这个账号的结果。");
    }

    if (result.status !== "completed") {
      return makeFailedDouyinBatchCollectResult(account, stringField(result.error) || "抖音批量抓取账号失败。");
    }

    const rows = Array.isArray(result.rows) ? result.rows : [];
    return {
      account,
      status: "completed",
      raw: rows,
      rawCount: rows.length,
      videos: rows.map((row) => normalizeDouyinVideo(row, account))
    };
  });
}

function makeFailedDouyinBatchCollectResult(account: Account, error: string): DouyinBatchVideoCollectResult {
  return {
    account,
    error,
    raw: [],
    rawCount: 0,
    status: "failed",
    videos: []
  };
}

export async function refreshDouyinVideoDownloadUrl(
  account: Account,
  video: Pick<Video, "id" | "url" | "raw">,
  options: { preferBrowser?: boolean; excludeUrls?: string[]; signal?: AbortSignal } = {}
) {
  const awemeId = resolveDouyinAwemeId(video);
  if (!awemeId) return "";
  const excludedUrls = new Set(options.excludeUrls || []);
  if (options.preferBrowser) {
    const browserUrl = await getDouyinVideoDownloadUrlWithBrowser(awemeId, { signal: options.signal }).catch((error) => {
      if (isAbortError(error)) throw error;
      return "";
    });
    if (browserUrl && !excludedUrls.has(browserUrl)) return browserUrl;
  }

  const limit = resolveDouyinVideoLookupLimit(video);
  const urls = await getDouyinVideoDownloadUrlsWithUserVideos(account, { limit, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return new Map<string, string>();
  });
  const opencliUrl = urls.get(awemeId);
  if (opencliUrl && !excludedUrls.has(opencliUrl)) return opencliUrl;
  const browserUrl = await getDouyinVideoDownloadUrlWithBrowser(awemeId, { signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return "";
  });
  return browserUrl && !excludedUrls.has(browserUrl) ? browserUrl : "";
}

export async function checkDouyinVideoAvailability(
  account: Account,
  video: Pick<Video, "id" | "url" | "raw">
) {
  const awemeId = resolveDouyinAwemeId(video);
  if (!awemeId) {
    return {
      visible: false,
      reason: "无法解析抖音视频 ID。"
    };
  }

  try {
    const rows = await getDouyinVideoRows(account, { limit: 50 });
    const row = rows.find((item) => getDouyinRowAwemeId(item) === awemeId);
    if (row) {
      return {
        visible: true,
        reason: findDouyinMediaUrl(row) ? "" : "视频仍在账号列表中，但 opencli 没有返回可转写媒体地址。"
      };
    }
    return {
      visible: false,
      reason: "当前账号最近 50 条视频里找不到这条，可能已删除、隐藏、下架，或账号权限不可见。"
    };
  } catch (error) {
    return {
      visible: null,
      reason: `无法检查视频是否仍可见：${error instanceof Error ? error.message : "opencli 检查失败"}`
    };
  }
}

export async function getDouyinVideoDownloadUrls(account: Account, options: DouyinMediaLookupOptions = {}) {
  return getDouyinVideoDownloadUrlsWithUserVideos(account, options);
}

export function getDouyinVideoDownloadLookupLimit(videos: Array<Pick<Video, "id" | "url" | "raw">>) {
  return videos.reduce((limit, video) => Math.max(limit, resolveDouyinVideoLookupLimit(video)), 20);
}

async function getDouyinVideoDownloadUrlsWithUserVideos(account: Account, options: DouyinMediaLookupOptions = {}) {
  const urls = new Map<string, string>();

  try {
    const rows = await getDouyinVideoRows(account, options);
    for (const row of rows) {
      const awemeId = getDouyinRowAwemeId(row);
      if (!awemeId) continue;
      const mediaUrl = findDouyinMediaUrl(row);
      if (mediaUrl) urls.set(awemeId, mediaUrl);
    }
    return urls;
  } catch (error) {
    const message = error instanceof Error ? error.message : "opencli 未返回结果";
    throw new Error(`刷新抖音媒体地址失败：${message}`);
  }
}

async function getDouyinVideoRows(account: Account, options: DouyinMediaLookupOptions = {}) {
  const stdout = await runOpenCli([
    "douyin",
    "user-videos",
    account.uid,
    "--limit",
    String(Math.max(1, Math.min(options.limit || 20, 50))),
    "--with_comments",
    "false",
    "-f",
    "json"
  ], {
    timeout: 90_000,
    signal: options.signal
  });
  return asArray(parseJsonish(stdout))
    .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : null))
    .filter(Boolean) as Array<Record<string, unknown>>;
}

export async function getDouyinVideoDetailMap(
  account: Account,
  videos: Array<Pick<Video, "id" | "url" | "raw">>,
  options: { commentLimit?: number } = {}
) {
  const awemeIds = [...new Set(videos.map((video) => getDouyinAwemeId(video)).filter(Boolean))];
  const details = new Map<string, { commentCount?: number; topComments: string[] }>();
  if (!awemeIds.length) return details;

  const workspace = `douyin-detail-${process.pid}-${Date.now()}-${shortHash(account.uid)}`;
  const profileUrl = `https://www.douyin.com/user/${encodeURIComponent(account.uid)}`;

  try {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [profileUrl], { window: "background" }), {
      timeout: 30_000
    });
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "wait", ["time", "2"]), { timeout: 10_000 }).catch(() => undefined);

    for (const awemeId of awemeIds) {
      const detail = await getDouyinVideoDetailWithBrowser(workspace, awemeId, options).catch(() => null);
      if (!detail) continue;
      details.set(awemeId, detail);
    }
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }

  return details;
}

export function resetDouyinVideoStatsBrowser() {
  douyinStatsBrowserReady = false;
  return runOpenCli(buildOpenCliBrowserArgs(DOUYIN_STATS_BROWSER_WORKSPACE, "close"), { timeout: 5_000 }).catch(() => undefined);
}

export async function getDouyinVideoStatsByUrl(
  url: string,
  options: VideoStatsTimingOptions = {}
): Promise<DouyinVideoStatsResult> {
  return withDouyinStatsBrowser((workspace) => getDouyinVideoStatsByUrlInWorkspace(workspace, url, options), options);
}

export async function getDouyinVideoStatsBatchByUrl(
  urls: string[],
  options: VideoStatsTimingOptions = {}
): Promise<Array<DouyinVideoStatsResult | null>> {
  const normalizedUrls = urls.map((url) => url.trim());
  if (!normalizedUrls.length) return [];

  return withDouyinStatsBrowser(async (workspace) => {
    const directItems = await timeOpenCliOperation(
      options,
      "douyin.batch.resolve-share-url",
      () => Promise.all(
        normalizedUrls.map(async (url, index) => {
          const resolvedShareUrl = await resolveDouyinShareVideoUrl(url, options).catch(ignoreAbortToEmptyString);
          const awemeId = extractDouyinAwemeId(url) || extractDouyinAwemeId(resolvedShareUrl);
          return {
            index,
            url,
            resolvedUrl: resolvedShareUrl,
            awemeId
          };
        })
      ),
      { count: normalizedUrls.length }
    );
    const resultByIndex = new Map<number, DouyinVideoStatsResult | null>();
    const directAwemeIds = [...new Set(directItems.map((item) => item.awemeId).filter(Boolean))];
    const detailByAwemeId = await getDouyinVideoDetailSnapshots(workspace, directAwemeIds, options).catch(() => new Map<string, DouyinVideoStatsSnapshot>());

    for (const item of directItems) {
      const detail = item.awemeId ? detailByAwemeId.get(item.awemeId) : null;
      if (!item.awemeId || !detail) continue;
      resultByIndex.set(
        item.index,
        formatDouyinVideoStatsResult(detail, buildDouyinVideoUrl(item.awemeId) || item.resolvedUrl || item.url)
      );
    }

    await mapWithLocalConcurrency(
      directItems.filter((item) => !resultByIndex.has(item.index)),
      2,
      async (item) => {
        const result = await getDouyinVideoStatsByUrlInWorkspace(
          workspace,
          item.url,
          withTimingMeta(options, { index: item.index, fallback: true })
        ).catch(() => null);
        resultByIndex.set(item.index, result);
      }
    );

    return normalizedUrls.map((_, index) => resultByIndex.get(index) || null);
  }, options);
}

async function withDouyinStatsBrowser<T>(
  callback: (workspace: string) => Promise<T>,
  options: VideoStatsTimingOptions = {}
): Promise<T> {
  const run = douyinStatsBrowserQueue.then(async () => {
    await ensureDouyinStatsBrowser(options);
    return callback(DOUYIN_STATS_BROWSER_WORKSPACE);
  });
  douyinStatsBrowserQueue = run.catch(() => undefined);
  return run;
}

async function ensureDouyinStatsBrowser(options: VideoStatsTimingOptions = {}) {
  if (douyinStatsBrowserReady) return;
  await runOpenCli(buildOpenCliBrowserArgs(DOUYIN_STATS_BROWSER_WORKSPACE, "open", [DOUYIN_STATS_HOME_URL], { window: "background" }), {
    timeout: 30_000,
    timingStage: "douyin.browser.ensure-open",
    onTiming: options.onTiming,
    timingMeta: options.timingMeta,
    signal: options.signal
  });
  douyinStatsBrowserReady = true;
}

async function getDouyinVideoStatsByUrlInWorkspace(
  workspace: string,
  url: string,
  options: VideoStatsTimingOptions = {}
): Promise<DouyinVideoStatsResult> {
  const inputUrl = url.trim();
  const resolvedShareUrl = await timeOpenCliOperation(
    options,
    "douyin.resolve-share-url",
    () => resolveDouyinShareVideoUrl(inputUrl, options).catch(ignoreAbortToEmptyString),
    { shortLink: /v\.douyin\.com/i.test(inputUrl) }
  );
  const initialAwemeId = extractDouyinAwemeId(inputUrl) || extractDouyinAwemeId(resolvedShareUrl);
  const pageUrl = initialAwemeId ? buildDouyinVideoUrl(initialAwemeId) || resolvedShareUrl || inputUrl : resolvedShareUrl || inputUrl;

  try {
    if (initialAwemeId) {
      const fastDetail = await getDouyinVideoDetailSnapshot(workspace, initialAwemeId, options).catch(ignoreAbortToNull);
      if (fastDetail) {
        return formatDouyinVideoStatsResult(fastDetail, buildDouyinVideoUrl(initialAwemeId) || pageUrl);
      }
    }

    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [pageUrl], { window: "background" }), {
      timeout: 30_000,
      timingStage: "douyin.browser.open-video",
      onTiming: options.onTiming,
      timingMeta: options.timingMeta,
      signal: options.signal
    });
    const resolved = await resolveDouyinAwemeIdFromOpenPage(workspace, initialAwemeId, options);
    const awemeId = resolved.awemeId;
    if (!awemeId) {
      throw new Error("没有从链接里解析到抖音视频 ID，请确认是单条视频链接，或粘贴完整视频页链接。");
    }
    const detail = await waitForDouyinVideoStats(workspace, awemeId, options);

    if (!detail) {
      throw new Error("抖音页面已打开，但没有从真实浏览器网络里抓到点赞、评论、收藏或转发数据。");
    }

    const resolvedUrl = resolved.url || buildDouyinVideoUrl(awemeId) || pageUrl;
    return formatDouyinVideoStatsResult(detail, resolvedUrl);
  } catch (error) {
    if (isOpenCliBrowserSessionError(error)) {
      douyinStatsBrowserReady = false;
    }
    throw error;
  }
}

export async function getDouyinVideoCommentsByUrl(
  url: string,
  options: { commentLimit?: number } = {}
) {
  const inputUrl = url.trim();
  const initialAwemeId = extractDouyinAwemeId(inputUrl);
  const workspace = `douyin-video-comments-${process.pid}-${Date.now()}-${shortHash(inputUrl || initialAwemeId)}`;
  const pageUrl = initialAwemeId ? buildDouyinVideoUrl(initialAwemeId) || inputUrl : inputUrl;
  const commentLimit = Math.max(1, Math.min(options.commentLimit || 30, 50));

  try {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [pageUrl], { window: "background" }), {
      timeout: 30_000
    });
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "wait", ["time", "5"]), { timeout: 12_000 }).catch(() => undefined);
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "state"), { timeout: 12_000 }).catch(() => undefined);

    const resolved = await resolveDouyinAwemeIdFromOpenPage(workspace, initialAwemeId);
    const awemeId = resolved.awemeId;
    if (!awemeId) {
      return {
        url: inputUrl,
        resolvedUrl: resolved.url || inputUrl,
        awemeId: "",
        title: "",
        commentCount: 0,
        comments: []
      };
    }

    const [detail, snapshot] = await Promise.all([
      getDouyinVideoDetailWithBrowser(workspace, awemeId, { commentLimit }).catch(() => null),
      getDouyinVideoDetailSnapshot(workspace, awemeId).catch(() => null)
    ]);

    return {
      url: inputUrl,
      resolvedUrl: resolved.url || buildDouyinVideoUrl(awemeId) || pageUrl,
      awemeId,
      title: snapshot?.title || "",
      commentCount: detail?.commentCount || snapshot?.commentCount || 0,
      comments: detail?.topComments || []
    };
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }
}

export async function getDouyinVideoStatsFromAccount(input: {
  account: Account;
  url: string;
  limit?: number;
  videos?: Video[];
}) {
  const awemeId = extractDouyinAwemeId(input.url);
  if (!awemeId) {
    throw new Error("没有从链接里解析到抖音视频 ID，请粘贴完整视频链接。");
  }

  const videos =
    input.videos ||
    (
      await collectVideos({
        platform: "douyin",
        account: input.account,
        limit: input.limit || 500
      })
    ).videos;
  const matched = videos.find((video) => getDouyinAwemeId(video) === awemeId);
  if (!matched) {
    throw new Error(`账号「${input.account.name}」最近 ${videos.length} 条视频里没有找到这条视频。`);
  }

  return {
    platform: "douyin" as const,
    title: matched.title,
    url: matched.url || buildDouyinVideoUrl(awemeId) || input.url,
    publishedAt: matched.publishedAt,
    stats: {
      like: matched.stats.likes,
      comment: matched.stats.comments,
      favorite: matched.stats.favorites,
      share: matched.stats.shares || 0
    }
  };
}

async function getDouyinVideoDetailFromNetwork(
  workspace: string,
  awemeId: string,
  options: VideoStatsTimingOptions = {}
): Promise<DouyinVideoStatsSnapshot | null> {
  const previews = await getDouyinNetworkPreviews(workspace, options);
  const candidates = getOpenCliNetworkEntries(previews)
    .filter((entry) => isLikelyDouyinAwemeDetailEntry(entry, awemeId))
    .sort(compareDouyinNetworkEntries);

  for (const entry of candidates) {
    const key = stringField(entry.key);
    if (!key) continue;

    const detail = parseJsonish(
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "network", ["--detail", key, "--max-body", "0"]), {
        timeout: 20_000,
        timingStage: "douyin.browser.network.detail",
        onTiming: options.onTiming,
        timingMeta: mergeTimingMeta(options.timingMeta, { awemeId }),
        signal: options.signal
      })
    );
    const snapshot = extractDouyinStatsSnapshotFromNetworkDetail(detail, awemeId);
    if (snapshot) return snapshot;
  }

  return null;
}

async function resolveDouyinShareVideoUrl(url: string, options: VideoStatsTimingOptions = {}) {
  if (!/v\.douyin\.com/i.test(url)) return "";
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) throw createAbortError();
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 style-library",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const resolvedUrl = response.url || "";
    return extractDouyinAwemeId(resolvedUrl) ? resolvedUrl : "";
  } catch (error) {
    if (options.signal?.aborted) throw createAbortError();
    if (isAbortError(error)) throw error;
    return "";
  } finally {
    options.signal?.removeEventListener("abort", abort);
    clearTimeout(timeout);
  }
}

async function waitForDouyinVideoStats(
  workspace: string,
  awemeId: string,
  options: VideoStatsTimingOptions = {}
) {
  const deadline = Date.now() + 8_000;
  let lastDetail: DouyinVideoStatsSnapshot | null = null;

  while (Date.now() < deadline) {
    lastDetail =
      (await getDouyinVideoDetailSnapshot(workspace, awemeId, options).catch(ignoreAbortToNull)) ||
      (await getDouyinVideoDetailFromNetwork(workspace, awemeId, options).catch(ignoreAbortToNull));
    if (lastDetail) return lastDetail;
    await wait(700, options.signal);
  }

  return (
    lastDetail ||
    (await getDouyinVideoDetailFromNetwork(workspace, awemeId, options).catch(ignoreAbortToNull)) ||
    (await getDouyinVideoDetailSnapshot(workspace, awemeId, options).catch(ignoreAbortToNull))
  );
}

function formatDouyinVideoStatsResult(detail: DouyinVideoStatsSnapshot, url: string): DouyinVideoStatsResult {
  return {
    platform: "douyin",
    title: detail.title,
    url,
    videoKey: getVideoComparableKey(url),
    publishedAt: detail.publishedAt,
    authorName: detail.authorName,
    authorSecUid: detail.authorSecUid,
    stats: {
      like: detail.likeCount,
      comment: detail.commentCount,
      favorite: detail.favoriteCount,
      share: detail.shareCount
    }
  };
}

function wait(durationMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, durationMs);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function mapWithLocalConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await mapper(items[index], index);
      }
    })
  );
}

function isOpenCliBrowserSessionError(error: unknown) {
  return error instanceof Error && /browser|session|target|tab|context|closed|crash/i.test(error.message);
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted|任务已停止/i.test(error.message));
}

function createAbortError() {
  const error = new Error("任务已停止");
  error.name = "AbortError";
  return error;
}

function ignoreAbortToNull(error: unknown) {
  if (isAbortError(error)) throw error;
  return null;
}

function ignoreAbortToEmptyString(error: unknown) {
  if (isAbortError(error)) throw error;
  return "";
}

async function getDouyinNetworkPreviews(workspace: string, options: VideoStatsTimingOptions = {}) {
  const filtered = await runOpenCli(
    buildOpenCliBrowserArgs(workspace, "network", ["--since", "60s", "--filter", "aweme_detail,statistics"]),
    {
      timeout: 12_000,
      timingStage: "douyin.browser.network.preview-filtered",
      onTiming: options.onTiming,
      timingMeta: options.timingMeta,
      signal: options.signal
    }
  ).catch(ignoreAbortToEmptyString);
  const parsedFiltered = parseJsonish(filtered);
  if (getOpenCliNetworkEntries(parsedFiltered).length) return parsedFiltered;

  const all = await runOpenCli(buildOpenCliBrowserArgs(workspace, "network", ["--since", "60s"]), {
    timeout: 12_000,
    timingStage: "douyin.browser.network.preview-all",
    onTiming: options.onTiming,
    timingMeta: options.timingMeta,
    signal: options.signal
  }).catch(ignoreAbortToEmptyString);
  return parseJsonish(all);
}

function getOpenCliNetworkEntries(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }
  if (!raw || typeof raw !== "object") return [];

  const object = raw as Record<string, unknown>;
  for (const key of ["entries", "items", "results", "requests", "list", "data"]) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
    }
  }
  return [];
}

function isLikelyDouyinAwemeDetailEntry(entry: Record<string, unknown>, awemeId: string) {
  const url = stringField(entry.url);
  const shape = JSON.stringify(entry.shape || entry.body_shape || entry.preview || "");
  if (url.includes("/aweme/v1/web/aweme/detail/")) return !awemeId || url.includes(awemeId) || url.includes("aweme_id=");
  return /aweme_detail|statistics|digg_count|comment_count|collect_count|share_count/i.test(shape);
}

function compareDouyinNetworkEntries(left: Record<string, unknown>, right: Record<string, unknown>) {
  return getDouyinNetworkEntryScore(right) - getDouyinNetworkEntryScore(left);
}

function getDouyinNetworkEntryScore(entry: Record<string, unknown>) {
  const url = stringField(entry.url);
  const shape = JSON.stringify(entry.shape || entry.body_shape || entry.preview || "");
  let score = 0;
  if (url.includes("/aweme/v1/web/aweme/detail/")) score += 50;
  if (shape.includes("aweme_detail")) score += 30;
  if (shape.includes("statistics")) score += 20;
  return score;
}

function extractDouyinStatsSnapshotFromNetworkDetail(detail: unknown, awemeId: string): DouyinVideoStatsSnapshot | null {
  const payload = parseOpenCliNetworkBody(detail);
  const awemeDetail = findDouyinAwemeDetail(payload, awemeId);
  if (!awemeDetail) return null;

  const statistics = awemeDetail.statistics && typeof awemeDetail.statistics === "object"
    ? (awemeDetail.statistics as Record<string, unknown>)
    : null;
  if (!statistics) return null;

  return {
    title: stringField(awemeDetail.desc) || stringField(awemeDetail.title),
    likeCount: toNumber(statistics.digg_count),
    commentCount: toNumber(statistics.comment_count),
    favoriteCount: toNumber(statistics.collect_count),
    shareCount: toNumber(statistics.share_count),
    publishedAt: normalizeTimestamp(awemeDetail.create_time || awemeDetail.createTime),
    authorName: extractDouyinAuthorName(awemeDetail),
    authorSecUid: extractDouyinAuthorSecUid(awemeDetail)
  };
}

function extractDouyinAuthorName(awemeDetail: Record<string, unknown>) {
  const author = awemeDetail.author && typeof awemeDetail.author === "object" ? (awemeDetail.author as Record<string, unknown>) : {};
  return stringField(author.nickname) || stringField(author.name) || stringField(author.unique_id);
}

function extractDouyinAuthorSecUid(awemeDetail: Record<string, unknown>) {
  const author = awemeDetail.author && typeof awemeDetail.author === "object" ? (awemeDetail.author as Record<string, unknown>) : {};
  return stringField(author.sec_uid) || stringField(author.secUid) || stringField(author.sec_user_id);
}

function parseOpenCliNetworkBody(detail: unknown): unknown {
  const object = detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : null;
  const body = object && "body" in object ? object.body : detail;
  if (typeof body !== "string") return body;

  try {
    return JSON.parse(body);
  } catch {
    const jsonMatch = body.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return body;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return body;
    }
  }
}

function findDouyinAwemeDetail(value: unknown, awemeId: string, depth = 0): Record<string, unknown> | null {
  if (!value || depth > 8) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDouyinAwemeDetail(item, awemeId, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  const object = value as Record<string, unknown>;
  const direct = object.aweme_detail || object.awemeDetail;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const found = findDouyinAwemeDetail(direct, awemeId, depth + 1);
    if (found) return found;
  }

  if (object.statistics && typeof object.statistics === "object" && matchesDouyinAwemeId(object, awemeId)) {
    return object;
  }

  for (const nested of Object.values(object)) {
    const found = findDouyinAwemeDetail(nested, awemeId, depth + 1);
    if (found) return found;
  }

  return null;
}

function matchesDouyinAwemeId(object: Record<string, unknown>, awemeId: string) {
  if (!awemeId) return true;
  const candidates = [
    object.aweme_id,
    object.awemeId,
    object.id,
    object.item_id,
    object.itemId,
    object.group_id,
    object.groupId
  ];
  return candidates.some((candidate) => String(candidate || "") === awemeId);
}

async function resolveDouyinAwemeIdFromOpenPage(
  workspace: string,
  fallbackAwemeId = "",
  options: VideoStatsTimingOptions = {}
) {
  if (fallbackAwemeId) {
    return {
      awemeId: fallbackAwemeId,
      url: buildDouyinVideoUrl(fallbackAwemeId)
    };
  }

  const result = parseJsonish(
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_AWEME_ID_EXTRACT_JS]), {
      timeout: 20_000,
      timingStage: "douyin.browser.eval.resolve-id",
      onTiming: options.onTiming,
      timingMeta: options.timingMeta
    })
  );
  const object = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
  const awemeId = extractDouyinAwemeId(stringField(object.awemeId)) || extractDouyinAwemeId(stringField(object.url));
  return {
    awemeId,
    url: stringField(object.url)
  };
}

async function getDouyinVideoDetailWithBrowser(
  workspace: string,
  awemeId: string,
  options: { commentLimit?: number } = {}
) {
  const commentLimit = Math.max(1, Math.min(options.commentLimit || 10, 50));
  const result = parseJsonish(
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [
      buildDouyinDetailExtractJs({
        awemeId,
        commentLimit
      })
    ]), { timeout: 20_000 })
  );
  const object = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
  const topComments = Array.isArray(object.topComments)
    ? object.topComments.map((comment) => normalizeCommentText(comment)).filter(Boolean)
    : [];
  const commentCount = toNumber(object.commentCount);
  if (!topComments.length && commentCount <= 0) return null;
  return {
    commentCount: commentCount > 0 ? commentCount : undefined,
    topComments
  };
}

async function getDouyinVideoDetailSnapshot(
  workspace: string,
  awemeId: string,
  options: VideoStatsTimingOptions = {}
): Promise<DouyinVideoStatsSnapshot | null> {
  const result = parseJsonish(
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [buildDouyinStatsExtractJs(awemeId)]), {
      timeout: 20_000,
      timingStage: "douyin.browser.eval.stats",
      onTiming: options.onTiming,
      timingMeta: mergeTimingMeta(options.timingMeta, { awemeId })
    })
  );
  const object = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
  if (!object.hasStats) return null;
  return {
    title: stringField(object.title),
    likeCount: toNumber(object.likeCount),
    commentCount: toNumber(object.commentCount),
    favoriteCount: toNumber(object.favoriteCount),
    shareCount: toNumber(object.shareCount),
    publishedAt: normalizeTimestamp(object.publishedAt || object.createTime || object.create_time)
  };
}

async function getDouyinVideoDetailSnapshots(
  workspace: string,
  awemeIds: string[],
  options: VideoStatsTimingOptions = {}
) {
  const uniqueAwemeIds = [...new Set(awemeIds.filter(Boolean))];
  const details = new Map<string, DouyinVideoStatsSnapshot>();
  if (!uniqueAwemeIds.length) return details;

  const result = parseJsonish(
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [buildDouyinBatchStatsExtractJs(uniqueAwemeIds)]), {
      timeout: Math.max(20_000, uniqueAwemeIds.length * 2_500),
      timingStage: "douyin.browser.eval.batch-stats",
      onTiming: options.onTiming,
      timingMeta: mergeTimingMeta(options.timingMeta, { count: uniqueAwemeIds.length })
    })
  );
  const rows = asArray(result);
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const object = row as Record<string, unknown>;
    const awemeId = extractDouyinAwemeId(stringField(object.awemeId));
    if (!awemeId || !object.hasStats) continue;
    details.set(awemeId, {
      title: stringField(object.title),
      likeCount: toNumber(object.likeCount),
      commentCount: toNumber(object.commentCount),
      favoriteCount: toNumber(object.favoriteCount),
      shareCount: toNumber(object.shareCount),
      publishedAt: normalizeTimestamp(object.publishedAt || object.createTime || object.create_time),
      authorName: stringField(object.authorName),
      authorSecUid: stringField(object.authorSecUid)
    });
  }
  return details;
}

export async function getDouyinTopComments(account: Account, options: { limit?: number; commentLimit?: number } = {}) {
  const stdout = await runOpenCli([
    "douyin",
    "user-videos",
    account.uid,
    "--limit",
    String(Math.max(1, Math.min(options.limit || 20, 50))),
    "--with_comments",
    "true",
    "--comment_limit",
    String(Math.max(1, Math.min(options.commentLimit || 10, 30))),
    "-f",
    "json"
  ]);
  return asArray(parseJsonish(stdout))
    .flatMap((row) => {
      const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const topComments = Array.isArray(object.top_comments) ? object.top_comments : [];
      return topComments.map((comment) => normalizeCommentText(comment)).filter(Boolean);
    })
    .filter(Boolean);
}

function resolveDouyinVideoLookupLimit(video: Pick<Video, "id" | "url" | "raw">) {
  const raw = video.raw && typeof video.raw === "object" ? (video.raw as Record<string, unknown>) : {};
  const index = toNumber(raw.index);
  return Math.min(Math.max(index || 20, 20), 50);
}

async function getDouyinVideoDownloadUrlWithBrowser(awemeId: string, options: { signal?: AbortSignal } = {}) {
  const workspace = `douyin-media-${process.pid}-${Date.now()}-${shortHash(awemeId)}`;
  const videoUrl = buildDouyinVideoUrl(awemeId);
  if (!videoUrl) return "";

  try {
    const openResult = parseJsonish(
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [videoUrl], { window: "background" }), {
        timeout: 30_000,
        signal: options.signal
      })
    );
    const tab = openResult && typeof openResult === "object" ? String((openResult as Record<string, unknown>).page || "") : "";
    const evalArgs = buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_MEDIA_EXTRACT_JS], tab ? { tab } : {});
    const candidates = asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 20_000, signal: options.signal })))
      .map((value) => String(value || "").trim())
      .filter(isLikelyDirectMediaUrl);
    return selectBestDouyinMediaUrl(candidates);
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }
}

export function getDouyinAwemeId(video: Pick<Video, "id" | "url" | "raw">) {
  return resolveDouyinAwemeId(video);
}

function resolveDouyinAwemeId(video: Pick<Video, "id" | "url" | "raw">) {
  const raw = video.raw && typeof video.raw === "object" ? (video.raw as Record<string, unknown>) : {};
  return (
    extractDouyinAwemeId(video.id) ||
    extractDouyinAwemeId(video.url) ||
    getDouyinRowAwemeId(raw)
  );
}

function getDouyinRowAwemeId(row: Record<string, unknown>) {
  const explicit = extractDouyinAwemeId(
    String(row.aweme_id || row.awemeId || row.awemeID || row.video_id || row.videoId || "")
  );
  if (explicit) return explicit;

  for (const key of ["share_url", "shareUrl", "web_url", "link", "page_url", "pageUrl", "uri"]) {
    const awemeId = extractDouyinAwemeId(String(row[key] || ""));
    if (awemeId) return awemeId;
  }

  return "";
}

function findDouyinMediaUrl(row: Record<string, unknown>) {
  const candidates = [
    row.play_url,
    row.download_url,
    row.video_url,
    row.media_url,
    row.video_play_url,
    row.url
  ]
    .map((value) => String(value || "").trim())
    .filter(isLikelyDirectMediaUrl);

  const video = row.video && typeof row.video === "object" ? (row.video as Record<string, unknown>) : {};
  const playAddr = video.play_addr && typeof video.play_addr === "object" ? (video.play_addr as Record<string, unknown>) : {};
  const downloadAddr =
    video.download_addr && typeof video.download_addr === "object" ? (video.download_addr as Record<string, unknown>) : {};

  for (const source of [playAddr, downloadAddr]) {
    const urlList = source.url_list;
    if (!Array.isArray(urlList)) continue;
    candidates.push(...urlList.map((value) => String(value || "").trim()).filter(isLikelyDirectMediaUrl));
  }

  return selectBestDouyinMediaUrl(candidates);
}

function selectBestDouyinMediaUrl(urls: string[]) {
  const unique = [...new Set(urls.filter(Boolean))];
  return unique.sort((a, b) => douyinMediaUrlScore(b) - douyinMediaUrlScore(a))[0] || "";
}

function douyinMediaUrlScore(url: string) {
  let score = 0;
  try {
    const parsed = new URL(url);
    const text = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    const mimeType = (parsed.searchParams.get("mime_type") || "").toLowerCase();

    if (mimeType.startsWith("audio_")) score += 1000;
    if (mimeType === "video_mp4") score -= 300;
    if (/\.(m4a|mp3|aac|wav|flac|ogg)(\?|$)/i.test(parsed.pathname)) score += 900;
    if (/playwm|play_addr|download_addr|music|audio/.test(text)) score += 120;
    if (/mime_type=video_mp4|\/video\/tos\//.test(text)) score -= 120;

    const bitrate = Number(parsed.searchParams.get("br") || parsed.searchParams.get("bt") || 0);
    if (Number.isFinite(bitrate)) score += Math.min(bitrate, 2000) / 100;
  } catch {
    if (/\.(m4a|mp3|aac|wav|flac|ogg)(\?|$)/i.test(url)) score += 900;
  }

  return score;
}

function normalizeDouyinVideo(row: unknown, account: Account): Video {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const title = String(object.title || object.desc || object.caption || "未命名视频");
  const awemeId = getDouyinRowAwemeId(object);
  const sourceUrls = [
    object.play_url,
    object.download_url,
    object.video_url,
    object.share_url,
    object.shareUrl,
    object.web_url,
    object.link,
    object.url
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const downloadUrl = sourceUrls.find(isLikelyDirectMediaUrl) || "";
  const pageUrl =
    sourceUrls.find((url) => /^https?:\/\//i.test(url) && !isLikelyDirectMediaUrl(url)) ||
    buildDouyinVideoUrl(awemeId) ||
    downloadUrl;
  const rawStatistics =
    object.raw_statistics && typeof object.raw_statistics === "object" ? (object.raw_statistics as Record<string, unknown>) : {};
  const statistics =
    object.statistics && typeof object.statistics === "object" ? (object.statistics as Record<string, unknown>) : {};
  const nestedStats = object.stats && typeof object.stats === "object" ? (object.stats as Record<string, unknown>) : {};
  const topComments = Array.isArray(object.top_comments)
    ? object.top_comments.map((comment) => normalizeCommentText(comment)).filter(Boolean)
    : [];

  return {
    id: safeSegment(awemeId || shortHash(`${title}-${downloadUrl}`)),
    platform: "douyin",
    accountId: account.id,
    title,
    url: pageUrl,
    duration: String(object.duration || ""),
    publishedAt: normalizeTimestamp(object.date || object.create_time || object.created_at),
    stats: {
      views: firstNumber(
        object.play_count,
        object.view_count,
        object.video_play_count,
        object.total_play_count,
        object.play,
        object.views,
        object.view,
        rawStatistics.play_count,
        rawStatistics.view_count,
        rawStatistics.video_play_count,
        rawStatistics.total_play_count,
        statistics.play_count,
        statistics.view_count,
        statistics.video_play_count,
        statistics.total_play_count,
        nestedStats.play_count,
        nestedStats.view_count,
        nestedStats.video_play_count,
        nestedStats.total_play_count,
        nestedStats.views
      ),
      likes: firstNumber(object.digg_count, rawStatistics.digg_count, statistics.digg_count, nestedStats.digg_count, object.likes, object.like),
      comments: firstNumber(object.comment_count, rawStatistics.comment_count, statistics.comment_count, nestedStats.comment_count, object.comments),
      favorites: firstNumber(object.collect_count, rawStatistics.collect_count, statistics.collect_count, nestedStats.collect_count, object.favorites, object.collect),
      shares: firstNumber(object.share_count, rawStatistics.share_count, statistics.share_count, nestedStats.share_count, object.shares)
    },
    hotScore: 0,
    relativeViewRate: 0,
    transcriptStatus: "not_started",
    downloadUrl,
    topComments,
    raw: row,
    updatedAt: nowIso()
  };
}
