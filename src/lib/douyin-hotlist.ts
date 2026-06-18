import {
  formatHotlistSurgeReason,
  getHotlistSurgeDecision,
  getHotlistSurgeLabel,
  getSurgeMinHeatPerHour,
  isHotlistSurgeActive
} from "./douyin-hotlist-surge";
import {
  collectDouyinPostVideosBatch,
  collectVideos,
  resolveAccountUid,
  type DouyinBatchVideoCollectResult
} from "./opencli";
import { resolveAccountProfile } from "./account-profile";
import {
  addDouyinHotlistAccountRef,
  findDouyinHotlistAccountByName,
  findDouyinHotlistAccountByUid,
  getDouyinHotlistAccountVideos,
  markDouyinHotlistRefreshed,
  readDouyinHotlistWatchlist,
  removeDouyinHotlistAccountRefs,
  resolveDouyinHotlistAccount,
  saveDouyinHotlistVideos,
  upsertDouyinHotlistAccount
} from "./storage/douyin-hotlist";
import { libraryRoot } from "./storage/core";
import type {
  Account,
  DouyinHotlistAccount,
  DouyinHotlistItem,
  DouyinHotlistRefreshAccountResult,
  DouyinHotlistRefreshResult,
  DouyinHotlistResponse,
  DouyinHotlistSurgeHighlight,
  Video,
  VideoHotlistSurgeState,
  VideoHotlistTrend,
  VideoListItem
} from "./types";
import { extractFirstLinkFromInput } from "./platform-links";
import { nowIso, shortHash } from "./utils";

const DEFAULT_WINDOW_KEY = "3d";
const DEFAULT_WINDOW_DAYS = 3;
const DEFAULT_REFRESH_LIMIT = 60;
const MAX_REFRESH_LIMIT = 120;
const MAX_WINDOW_DAYS = 14;
const DEFAULT_REFRESH_CONCURRENCY = 5;
const MAX_REFRESH_CONCURRENCY = 5;
const LIKE_HEAT_WEIGHT = 22;
const COMMENT_HEAT_WEIGHT = 80;
const FAVORITE_HEAT_WEIGHT = 70;
const SHARE_HEAT_WEIGHT = 90;
const MAX_RECENCY_BOOST = 0.25;
const VELOCITY_WINDOW_HOURS = 36;
const VELOCITY_AGE_FLOOR_HOURS = 0.5;
const VELOCITY_BONUS_MULTIPLIER = 14;
const VELOCITY_FULL_CONFIDENCE_HEAT = LIKE_HEAT_WEIGHT * 1000;
const EXPLOSIVE_MAX_AGE_HOURS = 3;
const EXPLOSIVE_MIN_LIKES = 1000;
const EXPLOSIVE_MIN_HEAT_PER_HOUR = LIKE_HEAT_WEIGHT * 300;
const FAST_RISING_MAX_AGE_HOURS = 12;
const FAST_RISING_MIN_LIKES = 500;
const FAST_RISING_MIN_HEAT_PER_HOUR = LIKE_HEAT_WEIGHT * 220;
const DOUYIN_SEC_UID_PATTERN = /MS4wLjAB[0-9A-Za-z_.-]{20,}/;

let activeRefreshPromise: Promise<DouyinHotlistRefreshResult> | null = null;

class DouyinHotlistRefreshInProgressError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("抖音热榜正在刷新中，请等这一轮结束后再试。");
    this.name = "DouyinHotlistRefreshInProgressError";
  }
}

export async function getDouyinHotlist(options: { windowDays?: number; windowKey?: string } = {}): Promise<DouyinHotlistResponse> {
  const window = resolveHotlistWindow(options.windowKey || options.windowDays);
  const watchlist = await readDouyinHotlistWatchlist();
  const resolved = await resolveWatchlistAccounts(watchlist.accountIds);
  const accountVideos = await Promise.all(
    resolved.accounts.map(async (account) => ({
      account,
      videos: await getDouyinHotlistAccountVideos(account)
    }))
  );

  const accounts: DouyinHotlistAccount[] = accountVideos.map(({ account, videos }) => {
    const recentVideoCount = videos.filter((video) => isVideoInWindow(video, window)).length;
    return {
      id: account.id,
      slug: account.slug,
      platform: account.platform,
      name: account.name,
      uid: account.uid,
      sourceUrl: account.sourceUrl,
      avatarUrl: account.avatarUrl,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastCollectedAt: account.lastCollectedAt,
      videoCount: videos.length,
      recentVideoCount
    };
  });

  const rankedItems = accountVideos
    .flatMap(({ account, videos }) => videos
      .filter((video) => isVideoInWindow(video, window))
      .map((video) => buildRankItem(account, video, window)))
    .sort((left, right) => right.heatScore - left.heatScore || comparePublishedAtDesc(left.video, right.video));
  const items = rankedItems.map((item, index) => finalizeRankItem(item, index));

  return {
    root: libraryRoot(),
    accounts,
    items,
    summary: {
      windowDays: window.windowDays,
      windowKey: window.windowKey,
      windowLabel: window.label,
      windowHours: window.windowHours,
      fromDate: window.fromDate,
      toDate: window.toDate,
      accountCount: accounts.length,
      staleAccountIds: resolved.staleAccountIds,
      totalVideoCount: accountVideos.reduce((sum, current) => sum + current.videos.length, 0),
      recentVideoCount: items.length,
      lastRefreshedAt: watchlist.lastRefreshedAt
    }
  };
}

export async function addDouyinHotlistAccount(input: {
  query: string;
  signal?: AbortSignal;
}) {
  const target = resolveAccountTarget(input.query);
  const existingByName = target.uidOrUrl ? null : await findDouyinHotlistAccountByName(target.lookupName);
  const uid =
    existingByName?.uid ||
    (await resolveAccountUid("douyin", target.lookupName, target.uidOrUrl, { signal: input.signal }));
  const existingByUid = await findDouyinHotlistAccountByUid(uid);
  const profile = await resolveAccountProfile({
    platform: "douyin",
    uid,
    fallbackName: existingByUid?.name || existingByName?.name || target.displayName,
    sourceUrl: existingByUid?.sourceUrl || existingByName?.sourceUrl || target.sourceUrl,
    signal: input.signal
  });
  const account = await upsertDouyinHotlistAccount({
    name: profile.name,
    uid,
    sourceUrl: profile.sourceUrl,
    avatarUrl: profile.avatarUrl
  });
  await addDouyinHotlistAccountRef(account.id);
  return getDouyinHotlist();
}

export async function removeDouyinHotlistAccount(accountId: string) {
  await removeDouyinHotlistAccountRefs([accountId]);
  return getDouyinHotlist();
}

export async function refreshDouyinHotlist(options: {
  accountIds?: string[];
  limit?: number;
  windowDays?: number;
  windowKey?: string;
  signal?: AbortSignal;
} = {}): Promise<DouyinHotlistRefreshResult> {
  if (activeRefreshPromise) {
    throw new DouyinHotlistRefreshInProgressError();
  }

  const refreshPromise = refreshDouyinHotlistUnlocked(options);
  activeRefreshPromise = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (activeRefreshPromise === refreshPromise) {
      activeRefreshPromise = null;
    }
  }
}

async function refreshDouyinHotlistUnlocked(options: {
  accountIds?: string[];
  limit?: number;
  windowDays?: number;
  windowKey?: string;
  signal?: AbortSignal;
} = {}): Promise<DouyinHotlistRefreshResult> {
  const window = resolveHotlistWindow(options.windowKey || options.windowDays);
  const limit = clampInteger(options.limit, 1, MAX_REFRESH_LIMIT, DEFAULT_REFRESH_LIMIT);
  const watchlist = await readDouyinHotlistWatchlist();
  const targetIds = options.accountIds?.length ? options.accountIds : watchlist.accountIds;
  const resolved = await resolveWatchlistAccounts(targetIds);
  const concurrency = resolveRefreshConcurrency(resolved.accounts.length);
  const results = await refreshDouyinHotlistAccounts(
    resolved.accounts,
    window,
    limit,
    concurrency,
    options.signal
  );

  const completed = results.filter((result) => result.status === "completed").length;
  if (completed > 0) {
    await markDouyinHotlistRefreshed(nowIso());
  }

  const snapshot = await getDouyinHotlist({ windowKey: window.windowKey });
  const staleResults = resolved.staleAccountIds.map((accountId) => ({
    accountId,
    name: accountId,
    status: "failed" as const,
    error: "热榜关注列表里的账号已经不存在。"
  }));

  return {
    ...snapshot,
    refresh: {
      requested: targetIds.length,
      completed,
      failed: results.length - completed + staleResults.length,
      limit,
      accounts: [...results, ...staleResults]
    }
  };
}

type HotlistWindow = {
  windowKey: string;
  label: string;
  windowDays: number;
  windowHours?: number;
  fromDate: string;
  toDate: string;
  fromTime: number;
  toTime: number;
};

async function refreshDouyinHotlistAccount(
  account: Account,
  window: HotlistWindow,
  limit: number,
  signal?: AbortSignal,
  retryReason?: string
): Promise<DouyinHotlistRefreshAccountResult> {
  throwIfAborted(signal);

  try {
    const collected = await collectVideos({
      platform: "douyin",
      account,
      limit,
      order: "likes",
      fromDate: window.fromDate,
      toDate: window.toDate,
      signal
    });
    throwIfAborted(signal);
    return saveDouyinHotlistRefreshResult(account, collected.videos, collected.rawCount, {
      mode: "single",
      retried: Boolean(retryReason),
      retryReason
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      accountId: account.id,
      name: account.name,
      status: "failed",
      error: error instanceof Error ? error.message : "抖音热榜刷新失败",
      mode: "single",
      retried: Boolean(retryReason),
      retryReason
    };
  }
}

async function refreshDouyinHotlistAccounts(
  accounts: Account[],
  window: HotlistWindow,
  limit: number,
  concurrency: number,
  signal?: AbortSignal
): Promise<DouyinHotlistRefreshAccountResult[]> {
  if (accounts.length <= 1) {
    return mapWithConcurrency(
      accounts,
      concurrency,
      (account) => refreshDouyinHotlistAccount(account, window, limit, signal)
    );
  }

  throwIfAborted(signal);
  const batchResults = await collectDouyinPostVideosBatch({
    accounts,
    concurrency,
    fromDate: window.fromDate,
    limit,
    signal,
    toDate: window.toDate
  });
  const results = new Array<DouyinHotlistRefreshAccountResult>(accounts.length);
  const retryInputs: Array<{ index: number; result: DouyinBatchVideoCollectResult }> = [];

  await Promise.all(
    batchResults.map(async (batchResult, index) => {
      throwIfAborted(signal);
      if (batchResult.status === "failed") {
        retryInputs.push({ index, result: batchResult });
        return;
      }

      results[index] = await saveDouyinHotlistRefreshResult(batchResult.account, batchResult.videos, batchResult.rawCount, {
        mode: "batch"
      });
    })
  );

  if (retryInputs.length) {
    const retryResults = await mapWithConcurrency(
      retryInputs,
      concurrency,
      ({ result }) => refreshDouyinHotlistAccount(result.account, window, limit, signal, result.error)
    );
    retryResults.forEach((retryResult, index) => {
      results[retryInputs[index].index] = retryResult;
    });
  }

  return results.map((result, index) => result || {
    accountId: accounts[index].id,
    error: "抖音批量抓取没有返回这个账号的结果，且未进入重试。",
    mode: "batch",
    name: accounts[index].name,
    status: "failed"
  });
}

async function saveDouyinHotlistRefreshResult(
  account: Account,
  videos: Video[],
  rawCount: number,
  options: Pick<DouyinHotlistRefreshAccountResult, "mode" | "retried" | "retryReason"> = {}
): Promise<DouyinHotlistRefreshAccountResult> {
  const updatedAccount = await upsertDouyinHotlistAccount({
    name: account.name,
    uid: account.uid,
    sourceUrl: account.sourceUrl,
    avatarUrl: account.avatarUrl,
    lastCollectedAt: nowIso()
  });
  const saved = await saveDouyinHotlistVideos(updatedAccount, videos);
  return {
    accountId: updatedAccount.id,
    mode: options.mode,
    name: updatedAccount.name,
    rawCount,
    retried: options.retried || undefined,
    retryReason: options.retryReason,
    savedCount: saved.length,
    status: "completed"
  };
}

async function resolveWatchlistAccounts(accountIds: string[]) {
  const entries = await Promise.all(
    accountIds.map(async (accountId) => ({
      accountId,
      account: await resolveDouyinHotlistAccount(accountId).catch(() => null)
    }))
  );

  return {
    accounts: entries.map((entry) => entry.account).filter((account): account is Account => Boolean(account)),
    staleAccountIds: entries.filter((entry) => !entry.account).map((entry) => entry.accountId)
  };
}

function resolveAccountTarget(query: string) {
  const raw = query.replace(/\s+/g, " ").trim();
  if (!raw) {
    throw new Error("请输入抖音账号名、主页链接或 sec_uid。");
  }

  const link = extractFirstLinkFromInput(raw, { kind: "account" });
  const secUid = raw.match(DOUYIN_SEC_UID_PATTERN)?.[0] || "";
  const uidOrUrl = link || secUid || undefined;
  const label = uidOrUrl ? removeAccountReference(raw, uidOrUrl) : raw;
  const displayName = label || `抖音账号 ${shortHash(uidOrUrl || raw)}`;

  return {
    lookupName: label || raw,
    uidOrUrl,
    sourceUrl: uidOrUrl || raw,
    displayName
  };
}

function removeAccountReference(input: string, reference: string) {
  return input
    .replace(reference, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(?:www\.)?(?:douyin|iesdouyin)\.com\/\S+/gi, "")
    .replace(DOUYIN_SEC_UID_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveHotlistWindow(windowInput?: number | string): HotlistWindow {
  const now = new Date();
  const windowKey = normalizeHotlistWindowKey(windowInput);
  const preset = getHotlistWindowPreset(windowKey);
  const from = resolveHotlistWindowStart(now, preset);
  const fromDate = toDateInputValue(from);
  const toDate = toDateInputValue(now);

  return {
    windowKey,
    label: preset.label,
    windowDays: Math.max(1, Math.ceil((now.getTime() - from.getTime()) / 86_400_000)),
    windowHours: preset.hours,
    fromDate,
    toDate,
    fromTime: from.getTime(),
    toTime: now.getTime()
  };
}

type HotlistWindowPreset = {
  key: string;
  label: string;
  hours?: number;
  days?: number;
};

const HOTLIST_WINDOW_PRESETS: HotlistWindowPreset[] = [
  { key: "3h", label: "近 3 小时", hours: 3 },
  { key: "6h", label: "近 6 小时", hours: 6 },
  { key: "12h", label: "近 12 小时", hours: 12 },
  { key: "24h", label: "近 24 小时", hours: 24 },
  { key: "3d", label: "近 3 天", days: 3 }
];

function normalizeHotlistWindowKey(input?: number | string) {
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (HOTLIST_WINDOW_PRESETS.some((preset) => preset.key === normalized)) return normalized;
    const dayMatch = normalized.match(/^(\d+)d$/);
    if (dayMatch) {
      const days = clampInteger(Number(dayMatch[1]), 1, MAX_WINDOW_DAYS, DEFAULT_WINDOW_DAYS);
      return days === DEFAULT_WINDOW_DAYS ? DEFAULT_WINDOW_KEY : `${days}d`;
    }
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    const days = clampInteger(input, 1, MAX_WINDOW_DAYS, DEFAULT_WINDOW_DAYS);
    return days === DEFAULT_WINDOW_DAYS ? DEFAULT_WINDOW_KEY : `${days}d`;
  }

  return DEFAULT_WINDOW_KEY;
}

function getHotlistWindowPreset(windowKey: string): HotlistWindowPreset {
  const preset = HOTLIST_WINDOW_PRESETS.find((item) => item.key === windowKey);
  if (preset) return preset;

  const dayMatch = windowKey.match(/^(\d+)d$/);
  const days = dayMatch ? clampInteger(Number(dayMatch[1]), 1, MAX_WINDOW_DAYS, DEFAULT_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;
  return {
    key: `${days}d`,
    label: `近 ${days} 天`,
    days
  };
}

function resolveHotlistWindowStart(now: Date, preset: HotlistWindowPreset) {
  const from = new Date(now);
  if (preset.hours) {
    from.setHours(from.getHours() - preset.hours);
    return from;
  }

  from.setDate(from.getDate() - (preset.days || DEFAULT_WINDOW_DAYS));
  return from;
}

type HotlistRankItemDraft = Omit<DouyinHotlistItem, "surge"> & {
  surgeState?: VideoHotlistSurgeState;
  trend?: VideoHotlistTrend;
};

function buildRankItem(
  account: Account,
  video: Video,
  window: HotlistWindow
): HotlistRankItemDraft {
  const ageHours = getVideoAgeHours(video);
  const heatScore = calculateHeatScore(video, ageHours, window);
  const listVideo = stripVideoRaw(video);

  return {
    rank: 0,
    account: {
      id: account.id,
      name: account.name,
      uid: account.uid,
      avatarUrl: account.avatarUrl
    },
    video: {
      ...listVideo,
      title: stripTitleTags(listVideo.title)
    },
    heatScore,
    ageHours,
    tags: extractTags(video.title),
    signal: describeContentSignal(video, ageHours, window.label),
    surgeState: video.hotlistSurge,
    trend: video.hotlistTrend
  };
}

function finalizeRankItem(
  item: HotlistRankItemDraft,
  index: number
): DouyinHotlistItem {
  const rank = index + 1;
  const surge = buildSurgeHighlight(item, rank);

  return {
    account: item.account,
    video: item.video,
    heatScore: item.heatScore,
    ageHours: item.ageHours,
    tags: item.tags,
    signal: item.signal,
    rank,
    ...(surge ? { surge } : {})
  };
}

function buildSurgeHighlight(
  item: HotlistRankItemDraft,
  rank: number
): DouyinHotlistSurgeHighlight | undefined {
  const currentDecision = getHotlistSurgeDecision(item.trend);
  if (currentDecision) {
    return {
      label: getHotlistSurgeLabel(rank, currentDecision.heatPerHour, currentDecision.minHeatPerHour),
      reason: formatHotlistSurgeReason(currentDecision),
      heatDelta: currentDecision.heatDelta,
      heatPerHour: currentDecision.heatPerHour,
      intervalHours: currentDecision.intervalHours
    };
  }

  const surgeState = item.surgeState;
  if (!isHotlistSurgeActive(surgeState)) return undefined;

  return {
    label: getHotlistSurgeLabel(rank, surgeState.heatPerHour, getSurgeMinHeatPerHour(Math.max(0.25, surgeState.intervalHours))),
    reason: formatHotlistSurgeReason(surgeState),
    heatDelta: surgeState.heatDelta,
    heatPerHour: surgeState.heatPerHour,
    intervalHours: surgeState.intervalHours
  };
}

function stripTitleTags(title: string) {
  return title
    .replace(/#[^\s#，。！？、；;,.!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || title;
}

function calculateHeatScore(video: Video, ageHours: number | undefined, window: HotlistWindow) {
  const engagementHeat = calculateEngagementHeat(video);
  const base = video.stats.views + engagementHeat;
  const windowHours = window.windowHours || window.windowDays * 24;
  const recencyMultiplier =
    ageHours === undefined ? 1 : 1 + Math.max(0, windowHours - ageHours) / windowHours * MAX_RECENCY_BOOST;
  const velocity = calculateVelocityMetrics(engagementHeat, ageHours);
  return Math.round(base * recencyMultiplier + velocity.bonus);
}

function describeContentSignal(video: Video, ageHours: number | undefined, windowLabel: string) {
  const likes = video.stats.likes;
  const comments = video.stats.comments;
  const savesAndShares = video.stats.favorites + (video.stats.shares ?? 0);
  const velocity = calculateVelocityMetrics(calculateEngagementHeat(video), ageHours);

  if (isExplosiveVelocity(video, velocity, ageHours)) {
    return `${formatCompactCount(likes)}赞/${formatSignalAge(ageHours)}，正在跑量`;
  }
  if (isFastRisingVelocity(video, velocity, ageHours)) {
    return "短时起量，优先跟进";
  }

  if (ageHours !== undefined && ageHours <= 12 && likes + comments + savesAndShares > 0) {
    return "新发酵，适合快速跟进";
  }
  if (comments >= 20 && comments >= likes * 0.08) {
    return "评论强，优先拆争议点";
  }
  if (savesAndShares >= 20 && savesAndShares >= likes * 0.3) {
    return "收藏/分享强，适合做实用选题";
  }
  if (likes >= 1000) {
    return "点赞高，适合复盘结构";
  }
  return `进入${windowLabel}样本，适合观察切入`;
}

function calculateEngagementHeat(video: Video) {
  return (
    video.stats.likes * LIKE_HEAT_WEIGHT +
    video.stats.comments * COMMENT_HEAT_WEIGHT +
    video.stats.favorites * FAVORITE_HEAT_WEIGHT +
    (video.stats.shares ?? 0) * SHARE_HEAT_WEIGHT
  );
}

function calculateVelocityMetrics(engagementHeat: number, ageHours?: number) {
  if (ageHours === undefined || engagementHeat <= 0) {
    return {
      heatPerHour: 0,
      bonus: 0
    };
  }

  const effectiveAgeHours = Math.max(ageHours, VELOCITY_AGE_FLOOR_HOURS);
  const earlyFactor = Math.max(0, (VELOCITY_WINDOW_HOURS - effectiveAgeHours) / VELOCITY_WINDOW_HOURS);
  const heatPerHour = engagementHeat / effectiveAgeHours;
  const confidence = Math.min(1, engagementHeat / VELOCITY_FULL_CONFIDENCE_HEAT);

  return {
    heatPerHour,
    bonus: heatPerHour * VELOCITY_BONUS_MULTIPLIER * earlyFactor * confidence
  };
}

function isExplosiveVelocity(
  video: Video,
  velocity: ReturnType<typeof calculateVelocityMetrics>,
  ageHours?: number
) {
  return (
    ageHours !== undefined &&
    ageHours <= EXPLOSIVE_MAX_AGE_HOURS &&
    video.stats.likes >= EXPLOSIVE_MIN_LIKES &&
    velocity.heatPerHour >= EXPLOSIVE_MIN_HEAT_PER_HOUR
  );
}

function isFastRisingVelocity(
  video: Video,
  velocity: ReturnType<typeof calculateVelocityMetrics>,
  ageHours?: number
) {
  return (
    ageHours !== undefined &&
    ageHours <= FAST_RISING_MAX_AGE_HOURS &&
    video.stats.likes >= FAST_RISING_MIN_LIKES &&
    velocity.heatPerHour >= FAST_RISING_MIN_HEAT_PER_HOUR
  );
}

function formatCompactCount(value: number) {
  if (value >= 10000) return `${Math.round(value / 1000) / 10}万`;
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function formatSignalAge(ageHours?: number) {
  if (ageHours === undefined || ageHours < 1) return "1h内";
  return `${Math.max(1, Math.round(ageHours))}h`;
}

function stripVideoRaw(video: Video): VideoListItem {
  const copy = { ...video };
  delete copy.raw;
  delete copy.hotlistTrend;
  delete copy.hotlistSurge;
  return copy;
}

function isVideoInWindow(video: Video, window: HotlistWindow) {
  const publishedAt = getPublishedTime(video);
  return publishedAt !== null && publishedAt >= window.fromTime && publishedAt <= window.toTime;
}

function comparePublishedAtDesc(left: VideoListItem, right: VideoListItem) {
  return (getPublishedTime(right) ?? 0) - (getPublishedTime(left) ?? 0);
}

function getVideoAgeHours(video: Video | VideoListItem) {
  const publishedAt = getPublishedTime(video);
  if (publishedAt === null) return undefined;
  const ageMs = Date.now() - publishedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  return Math.round(ageMs / 36_000) / 100;
}

function getPublishedTime(video: Pick<Video, "publishedAt">) {
  if (!video.publishedAt) return null;
  const time = new Date(video.publishedAt).getTime();
  return Number.isFinite(time) ? time : null;
}

function extractTags(title: string) {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const match of title.matchAll(/#[^\s#，。！？、；;,.!?]+/g)) {
    const tag = match[0];
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 4) break;
  }

  return tags;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await run(items[currentIndex], currentIndex);
      }
    })
  );
  return results;
}

function resolveRefreshConcurrency(accountCount: number) {
  if (accountCount <= 1) return 1;
  const parsed = Number.parseInt(process.env.DOUYIN_HOTLIST_REFRESH_CONCURRENCY || "", 10);
  const fallback = DEFAULT_REFRESH_CONCURRENCY;
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(accountCount, Math.max(1, Math.min(value, MAX_REFRESH_CONCURRENCY)));
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("任务已停止");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted|任务已停止/i.test(error.message));
}
