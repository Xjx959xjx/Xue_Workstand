import { promises as fs } from "fs";
import path from "path";
import { createHotlistSurgeState, getHotlistSurgeDecision, isHotlistSurgeActive } from "../douyin-hotlist-surge";
import type { Account, Video, VideoHotlistSurgeState, VideoHotlistTrend } from "../types";
import { nowIso, safeSegment, shortHash } from "../utils";
import { libraryRoot, normalizeStorageSegment } from "./core";
import { readJsonFile, writeJsonFile } from "./fs";

const HOTLIST_DIR = "douyin-hotlist";
const ACCOUNTS_DIR = "accounts";
const WATCHLIST_FILE = "watchlist.json";

type DouyinHotlistWatchlist = {
  version: 1;
  accountIds: string[];
  updatedAt: string;
  lastRefreshedAt?: string;
};

function hotlistPath() {
  return path.join(libraryRoot(), HOTLIST_DIR);
}

function hotlistAccountsPath() {
  return path.join(hotlistPath(), ACCOUNTS_DIR);
}

function watchlistPath() {
  return path.join(hotlistPath(), WATCHLIST_FILE);
}

function hotlistAccountPath(slug: string) {
  return path.join(hotlistAccountsPath(), slug);
}

function hotlistAccountJsonPath(slug: string) {
  return path.join(hotlistAccountPath(slug), "account.json");
}

function hotlistVideosPath(slug: string) {
  return path.join(hotlistAccountPath(slug), "videos");
}

function hotlistVideoJsonPath(slug: string, videoId: string) {
  return path.join(hotlistVideosPath(slug), `${normalizeStorageSegment(videoId, "热榜视频 ID")}.json`);
}

export async function ensureDouyinHotlistDirs() {
  await fs.mkdir(hotlistAccountsPath(), { recursive: true });
}

async function ensureDouyinHotlistAccountDirs(slug: string) {
  await fs.mkdir(hotlistVideosPath(slug), { recursive: true });
}

export async function readDouyinHotlistWatchlist(): Promise<DouyinHotlistWatchlist> {
  await ensureDouyinHotlistDirs();
  const file = await readJsonFile<Partial<DouyinHotlistWatchlist>>(watchlistPath());
  if (!file) {
    return {
      version: 1,
      accountIds: [],
      updatedAt: nowIso()
    };
  }

  const migrated = await migrateLegacyWatchlistAccountIds(file.accountIds || []);
  const next: DouyinHotlistWatchlist = {
    version: 1,
    accountIds: normalizeDouyinHotlistAccountIds(migrated.accountIds),
    updatedAt: file.updatedAt || nowIso(),
    lastRefreshedAt: file.lastRefreshedAt
  };

  if (migrated.changed || next.accountIds.length !== (file.accountIds || []).length) {
    next.updatedAt = nowIso();
    await writeJsonFile(watchlistPath(), next);
  }

  return next;
}

export async function addDouyinHotlistAccountRef(accountId: string) {
  const current = await readDouyinHotlistWatchlist();
  const next = {
    ...current,
    accountIds: normalizeDouyinHotlistAccountIds([...current.accountIds, accountId]),
    updatedAt: nowIso()
  };
  await writeJsonFile(watchlistPath(), next);
  return next;
}

export async function removeDouyinHotlistAccountRefs(accountIds: string[]) {
  const removed = new Set(normalizeDouyinHotlistAccountIds(accountIds));
  const current = await readDouyinHotlistWatchlist();
  const next = {
    ...current,
    accountIds: current.accountIds.filter((accountId) => !removed.has(accountId)),
    updatedAt: nowIso()
  };
  await writeJsonFile(watchlistPath(), next);
  return next;
}

export async function markDouyinHotlistRefreshed(refreshedAt = nowIso()) {
  const current = await readDouyinHotlistWatchlist();
  const next = {
    ...current,
    updatedAt: refreshedAt,
    lastRefreshedAt: refreshedAt
  };
  await writeJsonFile(watchlistPath(), next);
  return next;
}

export async function resolveDouyinHotlistAccount(accountIdOrSlug: string) {
  await ensureDouyinHotlistDirs();
  const slug = normalizeDouyinHotlistAccountSlug(accountIdOrSlug);
  const account = await readJsonFile<Account>(hotlistAccountJsonPath(slug));
  if (!account) {
    throw new Error(`找不到抖音热榜账号：${slug}`);
  }
  return account;
}

export async function findDouyinHotlistAccountByName(name: string) {
  await ensureDouyinHotlistDirs();
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName) return null;

  for (const slug of await readDouyinHotlistAccountSlugs()) {
    const account = await readJsonFile<Account>(hotlistAccountJsonPath(slug));
    if (account?.name.trim().toLowerCase() === normalizedName) return account;
  }

  return null;
}

export async function findDouyinHotlistAccountByUid(uid: string) {
  await ensureDouyinHotlistDirs();
  const normalizedUid = uid.trim();
  if (!normalizedUid) return null;

  for (const slug of await readDouyinHotlistAccountSlugs()) {
    const account = await readJsonFile<Account>(hotlistAccountJsonPath(slug));
    if (account?.uid === normalizedUid) return account;
  }

  return null;
}

export async function upsertDouyinHotlistAccount(input: {
  name: string;
  uid: string;
  sourceUrl?: string;
  avatarUrl?: string;
  lastCollectedAt?: string;
}) {
  await ensureDouyinHotlistDirs();
  const existing = await findDouyinHotlistAccountByUid(input.uid);
  const now = nowIso();
  const slug = existing?.slug ? normalizeDouyinHotlistAccountSlug(existing.slug) : createHotlistSlug(input.name || input.uid, input.uid);
  await ensureDouyinHotlistAccountDirs(slug);

  const account: Account = {
    id: `douyin-hotlist:${slug}`,
    slug,
    platform: "douyin",
    name: input.name || existing?.name || input.uid,
    uid: input.uid,
    sourceUrl: input.sourceUrl || existing?.sourceUrl,
    avatarUrl: input.avatarUrl || existing?.avatarUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastCollectedAt: input.lastCollectedAt ?? existing?.lastCollectedAt
  };

  await writeJsonFile(hotlistAccountJsonPath(slug), account);
  return account;
}

export async function getDouyinHotlistAccountVideos(account: Account) {
  await ensureDouyinHotlistAccountDirs(account.slug);
  let files = await fs.readdir(hotlistVideosPath(account.slug)).catch(() => []);
  if (!files.some((file) => file.endsWith(".json"))) {
    await migrateLegacyAccountVideos(account);
    files = await fs.readdir(hotlistVideosPath(account.slug)).catch(() => []);
  }
  const videos = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJsonFile<Video>(path.join(hotlistVideosPath(account.slug), file)))
    )
  ).filter(Boolean) as Video[];

  return videos.sort((left, right) => right.hotScore - left.hotScore);
}

export async function saveDouyinHotlistVideos(account: Account, incoming: Video[]) {
  await ensureDouyinHotlistAccountDirs(account.slug);
  const averageViews =
    incoming.reduce((sum, video) => sum + (video.stats.views || 0), 0) /
      Math.max(incoming.filter((video) => video.stats.views > 0).length, 1) || 0;
  const saved: Video[] = [];

  for (const video of incoming) {
    const id = safeSegment(video.id, shortHash(`${video.title}-${video.url}`));
    const existing = await readJsonFile<Video>(hotlistVideoJsonPath(account.slug, id));
    const mergedStats = mergeVideoStats(existing, video);
    const hotScore = calculateStoredHotScore({ ...video, stats: mergedStats });
    const updatedAt = nowIso();
    const hotlistTrend = buildHotlistTrend(existing, hotScore, updatedAt);
    const next: Video = {
      ...existing,
      ...video,
      id,
      accountId: account.id,
      platform: "douyin",
      stats: mergedStats,
      hotScore,
      relativeViewRate:
        mergedStats.views > 0 && averageViews > 0 ? Number((mergedStats.views / averageViews).toFixed(2)) : 0,
      transcriptStatus: existing?.transcriptStatus ?? video.transcriptStatus,
      transcriptPath: existing?.transcriptPath ?? video.transcriptPath,
      transcriptSource: existing?.transcriptSource ?? video.transcriptSource,
      hotlistTrend,
      hotlistSurge: resolveHotlistSurgeState(existing?.hotlistSurge, hotlistTrend, existing?.hotlistTrend, updatedAt),
      updatedAt
    };

    await writeJsonFile(hotlistVideoJsonPath(account.slug, id), next);
    saved.push(next);
  }

  return saved.sort((left, right) => right.hotScore - left.hotScore);
}

async function readDouyinHotlistAccountSlugs() {
  const entries = await fs.readdir(hotlistAccountsPath(), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function normalizeDouyinHotlistAccountIds(accountIds: string[]) {
  return [...new Set(accountIds.map(normalizeDouyinHotlistAccountId).filter(Boolean))];
}

function normalizeDouyinHotlistAccountId(accountId: string) {
  const [scope, rawSlug] = accountId.split(":");
  if (scope !== "douyin-hotlist" || !rawSlug) return "";
  return `douyin-hotlist:${normalizeStorageSegment(rawSlug, "抖音热榜账号 ID")}`;
}

function normalizeDouyinHotlistAccountSlug(accountIdOrSlug: string) {
  const slug = accountIdOrSlug.includes(":") ? accountIdOrSlug.split(":").at(-1)! : accountIdOrSlug;
  return normalizeStorageSegment(slug, "抖音热榜账号 ID");
}

function createHotlistSlug(name: string, uid: string) {
  return normalizeStorageSegment(safeSegment(name, shortHash(uid)), "抖音热榜账号 ID");
}

function mergeVideoStats(existing: Video | null, incoming: Video) {
  if (!existing) return incoming.stats;
  return {
    views: pickPreferredMetric(existing.stats.views, incoming.stats.views),
    likes: pickPreferredMetric(existing.stats.likes, incoming.stats.likes),
    comments: pickPreferredMetric(existing.stats.comments, incoming.stats.comments),
    favorites: pickPreferredMetric(existing.stats.favorites, incoming.stats.favorites),
    shares: pickPreferredMetric(existing.stats.shares, incoming.stats.shares)
  };
}

function pickPreferredMetric(existing?: number, incoming?: number) {
  const safeExisting = Number.isFinite(existing) ? Number(existing) : 0;
  const safeIncoming = Number.isFinite(incoming) ? Number(incoming) : 0;
  return safeIncoming > 0 ? safeIncoming : safeExisting;
}

function buildHotlistTrend(existing: Video | null, currentHotScore: number, updatedAt: string): VideoHotlistTrend | undefined {
  if (!existing?.updatedAt) return undefined;

  const previousTime = new Date(existing.updatedAt).getTime();
  const currentTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) {
    return undefined;
  }

  const previousHotScore = Number.isFinite(existing.hotScore) ? existing.hotScore : calculateStoredHotScore(existing);
  const intervalHours = (currentTime - previousTime) / 3_600_000;

  return {
    previousHotScore,
    currentHotScore,
    heatDelta: currentHotScore - previousHotScore,
    intervalHours: roundTo(intervalHours, 2),
    previousUpdatedAt: existing.updatedAt,
    updatedAt
  };
}

function resolveHotlistSurgeState(
  existing: VideoHotlistSurgeState | undefined,
  trend: VideoHotlistTrend | undefined,
  previousTrend: VideoHotlistTrend | undefined,
  updatedAt: string
): VideoHotlistSurgeState | undefined {
  const decision = getHotlistSurgeDecision(trend);
  if (decision) return createHotlistSurgeState(decision, updatedAt);

  const updatedTime = new Date(updatedAt).getTime();
  const now = Number.isFinite(updatedTime) ? updatedTime : Date.now();
  if (isHotlistSurgeActive(existing, now)) return existing;

  const previousDecision = getHotlistSurgeDecision(previousTrend);
  if (previousDecision && previousTrend?.updatedAt) {
    const carried = createHotlistSurgeState(previousDecision, previousTrend.updatedAt);
    if (isHotlistSurgeActive(carried, now)) return carried;
  }

  return undefined;
}

function calculateStoredHotScore(video: Video) {
  return (
    video.stats.views +
    video.stats.likes * 20 +
    video.stats.comments * 60 +
    video.stats.favorites * 80 +
    (video.stats.shares ?? 0) * 50
  );
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function migrateLegacyWatchlistAccountIds(accountIds: string[]) {
  const migrated: string[] = [];
  let changed = false;

  for (const accountId of accountIds) {
    if (accountId.startsWith("douyin-hotlist:")) {
      migrated.push(accountId);
      continue;
    }

    if (!accountId.startsWith("douyin:")) {
      changed = true;
      continue;
    }

    const legacy = await readLegacyDouyinAccount(accountId);
    if (!legacy) {
      changed = true;
      continue;
    }

    const account = await upsertDouyinHotlistAccount({
      name: legacy.name,
      uid: legacy.uid,
      sourceUrl: legacy.sourceUrl,
      avatarUrl: legacy.avatarUrl,
      lastCollectedAt: legacy.lastCollectedAt
    });
    migrated.push(account.id);
    changed = true;
  }

  return { accountIds: migrated, changed };
}

async function readLegacyDouyinAccount(accountId: string) {
  const slug = accountId.includes(":") ? accountId.split(":").at(-1)! : accountId;
  const normalizedSlug = normalizeStorageSegment(slug, "抖音账号 ID");
  return readJsonFile<Account>(path.join(libraryRoot(), "douyin", normalizedSlug, "account.json"));
}

async function migrateLegacyAccountVideos(account: Account) {
  const legacyVideosPath = path.join(libraryRoot(), "douyin", account.slug, "videos");
  const files = await fs.readdir(legacyVideosPath).catch(() => []);
  const videos = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJsonFile<Video>(path.join(legacyVideosPath, file)))
    )
  ).filter(Boolean) as Video[];

  if (!videos.length) return;
  await saveDouyinHotlistVideos(account, videos);
}
