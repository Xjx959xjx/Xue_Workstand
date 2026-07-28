import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import {
  Account,
  AccountDetail,
  AccountDraft,
  AccountListItem,
  AccountSummary,
  CopySource,
  Draft,
  DraftAssets,
  DraftCoverImage,
  DraftCoverReference,
  DraftInput,
  EngagementRecord,
  LibraryOverviewResponse,
  LibraryState,
  Platform,
  Project,
  ProjectDetail,
  ProjectDraft,
  ProjectListItem,
  ProjectSummary,
  TranscriptVersion,
  Video,
  VideoListItem,
  platforms
} from "./types";
import { makeDraftTitleFromContent, nowIso, safeSegment, shortHash } from "./utils";
import { fileExists, readJsonFile, writeFileAtomic, writeJsonFile, writeTextFileAtomic } from "./storage/fs";
import { libraryRoot, normalizeStorageSegment } from "./storage/core";
import { ensureDouyinHotlistDirs } from "./storage/douyin-hotlist";
import { ensureGrossMarginDirs } from "./storage/gross-margin";
export { libraryRoot } from "./storage/core";
export {
  appendGrossMarginPlaySample,
  deleteGrossMarginCategories,
  deleteGrossMarginMonitorRecord,
  deleteGrossMarginTier,
  getGrossMarginLibrary,
  getGrossMarginMonitorRecords,
  getGrossMarginReviewTemplate,
  resetGrossMarginReviewTemplate,
  resolveGrossMarginMonitorRecord,
  saveGrossMarginMonitorRecord,
  saveGrossMarginPriceTable,
  saveGrossMarginReviewTemplate,
  upsertGrossMarginCategory,
  upsertGrossMarginMonitorRecord,
  upsertGrossMarginTier
} from "./storage/gross-margin";

const DEFAULT_STYLE = `# 风格卡

## 内容定位
- 暂未总结。

## 开头方式
- 暂未总结。

## 句式与节奏
- 暂未总结。

## 常用话术
- 暂未总结。

## 结尾 CTA
- 暂未总结。
`;

const draftAssetQueues = new Map<string, Promise<unknown>>();
const engagementRecordQueues = new Map<string, Promise<unknown>>();
const transcriptQueues = new Map<string, Promise<unknown>>();

type DetailReadOptions = {
  includeStyle?: boolean;
};

export type EngagementCacheKind = "source" | "brief" | "research";

export type AccountStyleMeta = {
  sampleHash: string;
  sampleFingerprints: Array<{
    videoId: string;
    hash: string;
  }>;
  sampleVideoIds: string[];
  sampleCount: number;
  generationMode: "full" | "incremental";
  usedModel: string;
  fallback?: boolean;
  fallbackReason?: string;
  updatedAt: string;
};

export type ProjectStyleMeta = {
  sampleHash: string;
  sourceAccountIds: string[];
  sourceMaterialIds: string[];
  accountFingerprints: Array<{
    accountId: string;
    styleHash: string;
    sampleFingerprints: Array<{
      videoId: string;
      hash: string;
    }>;
  }>;
  materialFingerprints: Array<{
    sourceId: string;
    hash: string;
  }>;
  sampleCount: number;
  materialCount: number;
  usedModel: string;
  fallback?: boolean;
  fallbackReason?: string;
  updatedAt: string;
};

export type StyleSampleAnalysisCache = {
  version: 1;
  cacheKey: string;
  kind: "account-video" | "copy-source";
  sourceId: string;
  title: string;
  inputChars: number;
  analysis: string;
  usedModel: string;
  reasoningEffort: string;
  requestedServiceTier?: string;
  actualServiceTier?: string;
  wireApi?: string;
  generatedAt: string;
};

function videoHasTranscript(video: Pick<Video, "transcriptStatus" | "transcriptPath">) {
  return video.transcriptStatus === "completed" || Boolean(video.transcriptPath);
}

function stripVideoRaw(video: Video): VideoListItem {
  const copy = { ...video };
  delete copy.raw;
  return copy;
}

function platformPath(platform: Platform) {
  return path.join(libraryRoot(), platform);
}

function projectsPath() {
  return path.join(libraryRoot(), "projects");
}

function copyToolsPath() {
  return path.join(libraryRoot(), "copy-tools");
}

function copySourcesPath() {
  return path.join(copyToolsPath(), "sources");
}

function engagementPath() {
  return path.join(libraryRoot(), "engagement");
}

function engagementCachePath(kind: EngagementCacheKind) {
  return path.join(engagementPath(), ".cache", kind);
}

function engagementCacheJsonPath(kind: EngagementCacheKind, cacheKey: string) {
  return path.join(engagementCachePath(kind), `${normalizeStorageSegment(cacheKey, "评论缓存键")}.json`);
}

function engagementRecordJsonPath(id: string) {
  return path.join(engagementPath(), `${id}.json`);
}

function copySourceJsonPath(id: string) {
  return path.join(copySourcesPath(), `${id}.json`);
}

function copySourceStyleAnalysisPath(id: string) {
  return path.join(copySourcesPath(), `${id}.style-analysis.json`);
}

function copySourceTranscriptPath(id: string) {
  return path.join(copySourcesPath(), `${id}.txt`);
}

function projectPath(slug: string) {
  return path.join(projectsPath(), slug);
}

function projectJsonPath(slug: string) {
  return path.join(projectPath(slug), "project.json");
}

function projectStylePath(slug: string) {
  return path.join(projectPath(slug), "style.md");
}

function projectStyleMetaPath(slug: string) {
  return path.join(projectPath(slug), "style.meta.json");
}

function projectDraftsPath(slug: string) {
  return path.join(projectPath(slug), "drafts");
}

function projectDraftAssetsPath(slug: string, draftId: string) {
  return path.join(projectDraftsPath(slug), `${safeSegment(draftId)}.assets`);
}

function accountPath(platform: Platform, slug: string) {
  return path.join(platformPath(platform), slug);
}

function accountJsonPath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "account.json");
}

function videosPath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "videos");
}

function transcriptsPath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "transcripts");
}

function transcriptHistoryPath(platform: Platform, slug: string, videoId: string) {
  return path.join(transcriptsPath(platform, slug), ".history", normalizeVideoId(videoId));
}

function draftsPath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "drafts");
}

function draftAssetsPath(platform: Platform, slug: string, draftId: string) {
  return path.join(draftsPath(platform, slug), `${safeSegment(draftId)}.assets`);
}

function stylePath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "style.md");
}

function styleMetaPath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "style.meta.json");
}

function accountStyleSamplesPath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "style-samples");
}

function accountStyleSampleAnalysisPath(platform: Platform, slug: string, videoId: string) {
  return path.join(accountStyleSamplesPath(platform, slug), `${normalizeVideoId(videoId)}.json`);
}

function normalizeAccountSlug(accountIdOrSlug: string) {
  const slug = accountIdOrSlug.includes(":") ? accountIdOrSlug.split(":").at(-1)! : accountIdOrSlug;
  return normalizeStorageSegment(slug, "账号 ID");
}

function normalizeProjectSlug(projectIdOrSlug: string) {
  const slug = projectIdOrSlug.includes(":") ? projectIdOrSlug.split(":").at(-1)! : projectIdOrSlug;
  return normalizeStorageSegment(slug, "项目 ID");
}

function normalizeVideoId(videoId: string) {
  return normalizeStorageSegment(videoId, "视频 ID");
}

function normalizeDraftId(draftId: string) {
  return normalizeStorageSegment(draftId, "草稿 ID");
}

function normalizeDraftTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("草稿名称不能为空");
  }
  return normalized;
}

function normalizeCopySourceId(sourceId: string) {
  return normalizeStorageSegment(sourceId, "文案素材 ID");
}

function createStorageSlug(value: string, fallback: string, label: string) {
  return normalizeStorageSegment(safeSegment(value, fallback), label);
}

function isFsErrorCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

function uniqueTrimmedStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeEngagementRecordId(recordId: string) {
  return normalizeStorageSegment(recordId, "互动素材 ID");
}

async function withDraftAssetsLock<T>(draftId: string, run: () => Promise<T>) {
  const previous = draftAssetQueues.get(draftId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => current, () => current);
  draftAssetQueues.set(draftId, next);

  try {
    await previous.catch(() => undefined);
    return await run();
  } finally {
    release();
    if (draftAssetQueues.get(draftId) === next) {
      draftAssetQueues.delete(draftId);
    }
  }
}

async function withEngagementRecordLock<T>(recordId: string, run: () => Promise<T>) {
  const previous = engagementRecordQueues.get(recordId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => current, () => current);
  engagementRecordQueues.set(recordId, next);

  try {
    await previous.catch(() => undefined);
    return await run();
  } finally {
    release();
    if (engagementRecordQueues.get(recordId) === next) {
      engagementRecordQueues.delete(recordId);
    }
  }
}

async function withTranscriptLock<T>(key: string, run: () => Promise<T>) {
  const previous = transcriptQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => current, () => current);
  transcriptQueues.set(key, next);

  try {
    await previous.catch(() => undefined);
    return await run();
  } finally {
    release();
    if (transcriptQueues.get(key) === next) transcriptQueues.delete(key);
  }
}

async function exists(target: string) {
  return fileExists(target);
}

async function readJson<T>(target: string): Promise<T | null> {
  return readJsonFile<T>(target);
}

async function writeJson(target: string, value: unknown) {
  return writeJsonFile(target, value);
}

async function ensureAccountDirs(platform: Platform, slug: string) {
  await fs.mkdir(videosPath(platform, slug), { recursive: true });
  await fs.mkdir(transcriptsPath(platform, slug), { recursive: true });
  await fs.mkdir(draftsPath(platform, slug), { recursive: true });

  const style = stylePath(platform, slug);
  if (!(await exists(style))) {
    await writeTextFileAtomic(style, DEFAULT_STYLE);
  }
}

async function ensureProjectDirs(slug: string) {
  await fs.mkdir(projectDraftsPath(slug), { recursive: true });

  const style = projectStylePath(slug);
  if (!(await exists(style))) {
    await writeTextFileAtomic(style, DEFAULT_STYLE);
  }
}

export async function ensureLibrary() {
  await fs.mkdir(libraryRoot(), { recursive: true });
  await Promise.all([
    ...platforms.map((platform) => fs.mkdir(platformPath(platform), { recursive: true })),
    fs.mkdir(projectsPath(), { recursive: true }),
    fs.mkdir(copySourcesPath(), { recursive: true }),
    fs.mkdir(engagementPath(), { recursive: true }),
    ensureDouyinHotlistDirs(),
    ensureGrossMarginDirs()
  ]);
}

export async function resolveAccount(platform: Platform, accountIdOrSlug: string) {
  await ensureLibrary();
  const slug = normalizeAccountSlug(accountIdOrSlug);
  const account = await readJson<Account>(accountJsonPath(platform, slug));
  if (!account) {
    throw new Error(`找不到账号：${platform}/${slug}`);
  }
  return account;
}

async function findExistingAccount(platform: Platform, uid: string) {
  const base = platformPath(platform);
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const account = await readJson<Account>(accountJsonPath(platform, entry.name));
    if (account?.uid === uid) return account;
  }

  return null;
}

export async function findAccountByUid(platform: Platform, uid: string) {
  await ensureLibrary();
  return findExistingAccount(platform, uid);
}

export async function findAccountByName(platform: Platform, name: string) {
  await ensureLibrary();
  const base = platformPath(platform);
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const normalizedName = name.trim().toLowerCase();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const account = await readJson<Account>(accountJsonPath(platform, entry.name));
    if (account?.name.trim().toLowerCase() === normalizedName) return account;
  }

  return null;
}

export async function upsertAccount(input: {
  platform: Platform;
  name: string;
  uid: string;
  sourceUrl?: string;
  avatarUrl?: string;
  lastCollectedAt?: string;
}) {
  await ensureLibrary();

  const existing = await findExistingAccount(input.platform, input.uid);
  const now = nowIso();
  const slug = existing?.slug ? normalizeAccountSlug(existing.slug) : createStorageSlug(input.name || input.uid, shortHash(input.uid), "账号 ID");
  await ensureAccountDirs(input.platform, slug);

  const account: Account = {
    id: `${input.platform}:${slug}`,
    slug,
    platform: input.platform,
    name: input.name || existing?.name || input.uid,
    uid: input.uid,
    sourceUrl: input.sourceUrl || existing?.sourceUrl,
    avatarUrl: input.avatarUrl || existing?.avatarUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastCollectedAt: input.lastCollectedAt ?? existing?.lastCollectedAt
  };

  await writeJson(accountJsonPath(input.platform, slug), account);
  return account;
}

export async function deleteAccounts(accountIds: string[]) {
  await ensureLibrary();
  const uniqueIds = [...new Set(accountIds)].filter(Boolean);
  const deleted: string[] = [];

  for (const accountId of uniqueIds) {
    const [platform, slug] = accountId.split(":") as [Platform, string];
    if (!platforms.includes(platform) || !slug) continue;
    const normalizedSlug = normalizeAccountSlug(slug);
    const target = accountPath(platform, normalizedSlug);
    if (!(await exists(target))) continue;
    await fs.rm(target, { recursive: true, force: true });
    deleted.push(`${platform}:${normalizedSlug}`);
  }

  if (deleted.length) {
    await removeDeletedAccountsFromProjects(deleted);
  }

  return { deleted };
}

export async function upsertProject(input: {
  name: string;
  description?: string;
  sourceAccountIds?: string[];
  sourceMaterialIds?: string[];
  projectId?: string;
}) {
  await ensureLibrary();

  const existing = input.projectId ? await resolveProject(input.projectId).catch(() => null) : null;
  const now = nowIso();
  const slug = existing?.slug ? normalizeProjectSlug(existing.slug) : createStorageSlug(input.name, shortHash(input.name), "项目 ID");
  await ensureProjectDirs(slug);
  if (input.sourceAccountIds) {
    await assertAccountsExist(input.sourceAccountIds);
  }
  if (input.sourceMaterialIds) {
    await assertCopySourcesExist(input.sourceMaterialIds);
  }
  const sourceAccountIds = input.sourceAccountIds ? normalizeProjectAccountRefs(input.sourceAccountIds) : existing?.sourceAccountIds ?? [];
  const sourceMaterialIds = input.sourceMaterialIds
    ? uniqueTrimmedStrings(input.sourceMaterialIds).map(normalizeCopySourceId)
    : existing?.sourceMaterialIds ?? [];

  const project: Project = {
    id: `project:${slug}`,
    slug,
    name: input.name || existing?.name || "未命名项目",
    description: input.description ?? existing?.description,
    sourceAccountIds,
    sourceMaterialIds,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await writeJson(projectJsonPath(slug), project);
  if (input.sourceMaterialIds) {
    await syncCopySourceProjectRefs(project.id, sourceMaterialIds);
  }
  return project;
}

export async function deleteProjects(projectIds: string[]) {
  await ensureLibrary();
  const uniqueIds = [...new Set(projectIds)].filter(Boolean);
  const deleted: string[] = [];

  for (const projectId of uniqueIds) {
    const slug = normalizeProjectSlug(projectId);
    const target = projectPath(slug);
    if (!(await exists(target))) continue;
    await fs.rm(target, { recursive: true, force: true });
    deleted.push(`project:${slug}`);
  }

  if (deleted.length) {
    await removeCopySourceProjectRefs(deleted);
  }

  return { deleted };
}

export async function saveCopySource(input: {
  title?: string;
  platform: CopySource["platform"];
  url: string;
  resolvedUrl?: string;
  transcript: string;
  source: CopySource["source"];
  status?: CopySource["status"];
  error?: string;
  fallback?: boolean;
  fallbackReason?: string;
  materialAnalysis?: CopySource["materialAnalysis"];
}) {
  await ensureLibrary();
  const now = nowIso();
  const id = `${now.replace(/[:.]/g, "-")}-${shortHash(`${input.url}-${input.transcript}`)}`;
  const transcript = input.transcript.trim();
  const title = makeDraftTitleFromContent(
    input.title || transcript || input.url,
    input.platform === "unknown" ? "链接素材" : `${formatPlatformName(input.platform)}素材`
  );
  const transcriptFile = copySourceTranscriptPath(id);

  await writeTextFileAtomic(transcriptFile, transcript);

  const source: CopySource = {
    id,
    title,
    platform: input.platform,
    url: input.url,
    resolvedUrl: input.resolvedUrl,
    transcript,
    transcriptPath: transcriptFile,
    source: input.source,
    status: input.status || "completed",
    error: input.error,
    fallback: input.fallback,
    fallbackReason: input.fallbackReason,
    materialAnalysis: input.materialAnalysis,
    projectIds: [],
    createdAt: now,
    updatedAt: now
  };

  try {
    await writeJson(copySourceJsonPath(id), source);
  } catch (error) {
    await fs.rm(transcriptFile, { force: true }).catch(() => undefined);
    throw error;
  }
  return source;
}

export async function updateCopySourceMaterialAnalysis(
  sourceId: string,
  materialAnalysis: CopySource["materialAnalysis"]
) {
  await ensureLibrary();
  const source = await resolveCopySource(sourceId);
  const updated: CopySource = {
    ...source,
    materialAnalysis,
    updatedAt: nowIso()
  };
  await writeJson(copySourceJsonPath(updated.id), updated);
  return updated;
}

export async function createCopySourceProject(input: {
  name: string;
  description?: string;
  sourceMaterialIds: string[];
}) {
  if (!input.sourceMaterialIds.length) {
    throw new Error("请选择至少一份转写文案");
  }

  const sources = await assertCopySourcesExist(input.sourceMaterialIds);
  const project = await upsertProject({
    name: input.name,
    description: input.description,
    sourceAccountIds: [],
    sourceMaterialIds: sources.map((source) => source.id)
  });

  return getProjectSummary(project);
}

export async function getCopySources() {
  await ensureLibrary();
  const files = await fs.readdir(copySourcesPath()).catch(() => []);
  const sources = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json") && !file.endsWith(".style-analysis.json"))
        .map((file) => readJson<CopySource>(path.join(copySourcesPath(), file)))
    )
  )
    .filter(Boolean)
    .map((source) => normalizeCopySource(source as CopySource));

  return sources.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function resolveCopySource(sourceId: string) {
  await ensureLibrary();
  const id = normalizeCopySourceId(sourceId);
  const source = await readJson<CopySource>(copySourceJsonPath(id));
  if (!source) {
    throw new Error(`找不到文案素材：${id}`);
  }
  return normalizeCopySource(source);
}

export async function deleteCopySources(sourceIds: string[]) {
  await ensureLibrary();
  const uniqueIds = [...new Set(sourceIds)].filter(Boolean).map(normalizeCopySourceId);
  const deleted: string[] = [];

  for (const sourceId of uniqueIds) {
    const jsonFile = copySourceJsonPath(sourceId);
    const transcriptFile = copySourceTranscriptPath(sourceId);
    const styleAnalysisFile = copySourceStyleAnalysisPath(sourceId);
    const hasJson = await exists(jsonFile);
    const hasTranscript = await exists(transcriptFile);
    const hasStyleAnalysis = await exists(styleAnalysisFile);
    if (!hasJson && !hasTranscript && !hasStyleAnalysis) continue;
    await Promise.all([
      fs.rm(jsonFile, { force: true }),
      fs.rm(transcriptFile, { force: true }),
      fs.rm(styleAnalysisFile, { force: true })
    ]);
    deleted.push(sourceId);
  }

  if (deleted.length) {
    await removeCopySourcesFromProjects(deleted);
  }

  return { deleted };
}

export async function saveEngagementRecord(input: Omit<EngagementRecord, "id" | "createdAt" | "updatedAt">) {
  await ensureLibrary();
  const now = nowIso();
  const id = `${now.replace(/[:.]/g, "-")}-${shortHash(`${input.sourceType}-${input.title}-${input.sourceText}`)}`;
  const record: EngagementRecord = {
    ...input,
    id,
    title: makeDraftTitleFromContent(input.title || input.sourceText, "互动素材"),
    sourceText: input.sourceText.trim(),
    createdAt: now,
    updatedAt: now
  };
  await writeJson(engagementRecordJsonPath(id), record);
  return record;
}

export async function updateEngagementRecord(
  recordId: string,
  update: (current: EngagementRecord) => EngagementRecord | Promise<EngagementRecord>
) {
  await ensureLibrary();
  const id = normalizeEngagementRecordId(recordId);
  return withEngagementRecordLock(id, async () => {
    const current = await readJson<EngagementRecord>(engagementRecordJsonPath(id));
    if (!current) throw new Error(`找不到互动素材：${id}`);
    const updated = await update(current);
    const next: EngagementRecord = {
      ...updated,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowIso()
    };
    await writeJson(engagementRecordJsonPath(id), next);
    return next;
  });
}

export async function readEngagementCache<T>(kind: EngagementCacheKind, cacheKey: string) {
  await ensureLibrary();
  return readJson<T>(engagementCacheJsonPath(kind, cacheKey));
}

export async function writeEngagementCache(kind: EngagementCacheKind, cacheKey: string, value: unknown) {
  await ensureLibrary();
  await writeJson(engagementCacheJsonPath(kind, cacheKey), value);
}

export async function getEngagementRecords() {
  await ensureLibrary();
  const files = await fs.readdir(engagementPath()).catch(() => []);
  const records = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson<EngagementRecord>(path.join(engagementPath(), file)))
    )
  ).filter(Boolean) as EngagementRecord[];

  return records.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function resolveEngagementRecord(recordId: string) {
  await ensureLibrary();
  const id = normalizeEngagementRecordId(recordId);
  const record = await readJson<EngagementRecord>(engagementRecordJsonPath(id));
  if (!record) {
    throw new Error(`找不到互动素材：${id}`);
  }
  return record;
}

export async function deleteEngagementRecords(recordIds: string[]) {
  await ensureLibrary();
  const uniqueIds = [...new Set(recordIds)].filter(Boolean).map(normalizeEngagementRecordId);
  const deleted: string[] = [];

  for (const recordId of uniqueIds) {
    const target = engagementRecordJsonPath(recordId);
    if (!(await exists(target))) continue;
    await fs.rm(target, { force: true });
    deleted.push(recordId);
  }

  return { deleted };
}

export async function saveVideos(account: Account, incoming: Video[]) {
  await ensureAccountDirs(account.platform, account.slug);
  const averageViews =
    incoming.reduce((sum, video) => sum + (video.stats.views || 0), 0) /
      Math.max(incoming.filter((video) => video.stats.views > 0).length, 1) || 0;

  const saved: Video[] = [];
  for (const video of incoming) {
    const id = safeSegment(video.id, shortHash(`${video.title}-${video.url}`));
    const target = path.join(videosPath(account.platform, account.slug), `${id}.json`);
    const existing = await readJson<Video>(target);
    const transcriptFile = path.join(transcriptsPath(account.platform, account.slug), `${id}.txt`);
    const hasTranscript = await exists(transcriptFile);
    const mergedStats = mergeVideoStats(existing, video);
    const mergedTopComments =
      Array.isArray(video.topComments) && video.topComments.length
        ? video.topComments
        : existing?.topComments;

    const next: Video = {
      ...existing,
      ...video,
      id,
      accountId: account.id,
      platform: account.platform,
      stats: mergedStats,
      topComments: mergedTopComments,
      hotScore: calculateHotScore({ ...video, stats: mergedStats }),
      relativeViewRate:
        mergedStats.views > 0 && averageViews > 0 ? Number((mergedStats.views / averageViews).toFixed(2)) : 0,
      transcriptStatus: hasTranscript ? "completed" : existing?.transcriptStatus ?? video.transcriptStatus,
      transcriptPath: hasTranscript ? transcriptFile : existing?.transcriptPath ?? video.transcriptPath,
      transcriptSource: hasTranscript ? existing?.transcriptSource ?? video.transcriptSource : video.transcriptSource,
      updatedAt: nowIso()
    };

    await writeJson(target, next);
    saved.push(next);
  }

  return saved.sort((a, b) => b.hotScore - a.hotScore);
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
  if (safeIncoming > 0) return safeIncoming;
  return safeExisting;
}

export async function saveVideo(account: Account, video: Video) {
  await ensureAccountDirs(account.platform, account.slug);
  const id = normalizeVideoId(video.id);
  const target = path.join(videosPath(account.platform, account.slug), `${id}.json`);
  const next = {
    ...video,
    id,
    hotScore: calculateHotScore(video),
    updatedAt: nowIso()
  };
  await writeJson(target, next);
  return next;
}

export async function saveVideoAssetFields(
  platform: Platform,
  accountId: string,
  videoId: string,
  fields: Partial<Pick<Video, "coverUrl" | "danmakuSamples" | "topComments" | "raw">>
) {
  const account = await resolveAccount(platform, accountId);
  const normalizedVideoId = normalizeVideoId(videoId);
  const target = path.join(videosPath(account.platform, account.slug), `${normalizedVideoId}.json`);
  const video = await readJson<Video>(target);
  if (!video) throw new Error("找不到视频元数据");

  const next: Video = {
    ...video,
    ...fields,
    updatedAt: nowIso()
  };
  await writeJson(target, next);
  return next;
}

export async function saveTranscript(input: {
  platform: Platform;
  accountId: string;
  videoId: string;
  text: string;
  source: Video["transcriptSource"];
  expectedRevision?: string | null;
}) {
  const account = await resolveAccount(input.platform, input.accountId);
  await ensureAccountDirs(account.platform, account.slug);
  const videoId = normalizeVideoId(input.videoId);
  const lockKey = `${account.platform}:${account.slug}:${videoId}`;

  return withTranscriptLock(lockKey, async () => {
    const videoFile = path.join(videosPath(account.platform, account.slug), `${videoId}.json`);
    const video = await readJson<Video>(videoFile);
    if (!video) throw new Error("找不到视频元数据");

    const transcriptFile = path.join(transcriptsPath(account.platform, account.slug), `${videoId}.txt`);
    const currentTranscript = await readTextIfExists(transcriptFile);
    const currentRevision = getTranscriptRevision(currentTranscript);
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw createTranscriptConflictError();
    }

    const transcript = input.text.trim();
    const revision = getTranscriptRevision(transcript);
    const previousVersionCreated = Boolean(currentTranscript && currentTranscript !== transcript);
    if (previousVersionCreated) {
      await archiveTranscript(account.platform, account.slug, videoId, currentTranscript, currentRevision!);
    }
    await writeTextFileAtomic(transcriptFile, transcript);

    const next: Video = {
      ...video,
      transcriptStatus: "completed",
      transcriptPath: transcriptFile,
      transcriptRevision: revision || undefined,
      transcriptSource: input.source,
      raw: clearTranscriptError(video.raw),
      updatedAt: nowIso()
    };
    await writeJson(videoFile, next);

    return { account, video: next, transcript, revision, previousVersionCreated };
  });
}

export async function getTranscriptSnapshot(platform: Platform, accountId: string, videoId: string) {
  const transcript = await readTranscript(platform, accountId, videoId);
  return {
    transcript,
    revision: getTranscriptRevision(transcript),
    versions: await listTranscriptVersions(platform, accountId, videoId)
  };
}

export async function restoreTranscriptVersion(input: {
  platform: Platform;
  accountId: string;
  videoId: string;
  versionId: string;
  expectedRevision: string | null;
}) {
  const account = await resolveAccount(input.platform, input.accountId);
  const videoId = normalizeVideoId(input.videoId);
  const versionId = normalizeStorageSegment(input.versionId, "转写历史版本 ID");
  const target = path.join(transcriptHistoryPath(account.platform, account.slug, videoId), `${versionId}.txt`);
  const text = await readTextIfExists(target);
  if (!text) throw new Error("找不到这份转写历史版本");
  return saveTranscript({
    platform: account.platform,
    accountId: account.id,
    videoId,
    text,
    source: "manual",
    expectedRevision: input.expectedRevision
  });
}

async function listTranscriptVersions(platform: Platform, accountId: string, videoId: string): Promise<TranscriptVersion[]> {
  const account = await resolveAccount(platform, accountId);
  const normalizedVideoId = normalizeVideoId(videoId);
  const historyDir = transcriptHistoryPath(account.platform, account.slug, normalizedVideoId);
  const files = await fs.readdir(historyDir).catch(() => []);
  const versions = await Promise.all(
    files
      .filter((file) => file.endsWith(".txt"))
      .map(async (file) => {
        const target = path.join(historyDir, file);
        const [text, stat] = await Promise.all([readTextIfExists(target), fs.stat(target)]);
        return {
          id: file.slice(0, -4),
          createdAt: stat.mtime.toISOString(),
          revision: getTranscriptRevision(text) || "",
          preview: text.replace(/\s+/g, " ").trim().slice(0, 96)
        } satisfies TranscriptVersion;
      })
  );
  return versions.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

async function archiveTranscript(platform: Platform, slug: string, videoId: string, text: string, revision: string) {
  const historyDir = transcriptHistoryPath(platform, slug, videoId);
  await fs.mkdir(historyDir, { recursive: true });
  const timestamp = nowIso().replace(/[:.]/g, "-");
  await writeTextFileAtomic(path.join(historyDir, `${timestamp}-${revision.slice(0, 12)}.txt`), text);
}

async function readTextIfExists(target: string) {
  try {
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) return "";
    throw error;
  }
}

function getTranscriptRevision(text: string) {
  if (!text) return null;
  return createHash("sha256").update(text).digest("hex");
}

function createTranscriptConflictError() {
  const error = new Error("转写稿已被其他任务更新，请重新打开后再编辑或转写。") as Error & { statusCode: number };
  error.statusCode = 409;
  return error;
}

function clearTranscriptError(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const next = { ...(raw as Record<string, unknown>) };
  delete next.transcriptError;
  return next;
}

export async function markTranscriptFailed(platform: Platform, accountId: string, videoId: string, reason: string) {
  const account = await resolveAccount(platform, accountId);
  const normalizedVideoId = normalizeVideoId(videoId);
  const videoFile = path.join(videosPath(account.platform, account.slug), `${normalizedVideoId}.json`);
  const video = await readJson<Video>(videoFile);
  if (!video) return;

  await writeJson(videoFile, {
    ...video,
    transcriptStatus: videoHasTranscript(video) ? "completed" : "failed",
    raw: { ...(typeof video.raw === "object" && video.raw ? video.raw : {}), transcriptError: reason },
    updatedAt: nowIso()
  });
}

export async function readTranscript(platform: Platform, accountId: string, videoId: string) {
  const account = await resolveAccount(platform, accountId);
  const normalizedVideoId = normalizeVideoId(videoId);
  const target = path.join(transcriptsPath(account.platform, account.slug), `${normalizedVideoId}.txt`);
  try {
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) return "";
    throw new Error(`读取转写稿失败：${target}，${error instanceof Error ? error.message : "文件系统异常"}`);
  }
}

export async function deleteTranscript(platform: Platform, accountId: string, videoId: string) {
  const account = await resolveAccount(platform, accountId);
  const normalizedVideoId = normalizeVideoId(videoId);
  const lockKey = `${account.platform}:${account.slug}:${normalizedVideoId}`;
  return withTranscriptLock(lockKey, async () => {
    const transcriptFile = path.join(transcriptsPath(account.platform, account.slug), `${normalizedVideoId}.txt`);
    const videoFile = path.join(videosPath(account.platform, account.slug), `${normalizedVideoId}.json`);
    const styleAnalysisFile = accountStyleSampleAnalysisPath(account.platform, account.slug, normalizedVideoId);
    const video = await readJson<Video>(videoFile);
    if (!video) throw new Error("找不到视频元数据");

    const transcript = await readTextIfExists(transcriptFile);
    const revision = getTranscriptRevision(transcript);
    if (transcript && revision) {
      await archiveTranscript(account.platform, account.slug, normalizedVideoId, transcript, revision);
    }

    await Promise.all([
      fs.rm(transcriptFile, { force: true }),
      fs.rm(styleAnalysisFile, { force: true })
    ]);
    const next: Video = {
      ...video,
      transcriptStatus: "not_started",
      transcriptPath: undefined,
      transcriptRevision: undefined,
      transcriptSource: undefined,
      updatedAt: nowIso()
    };
    await writeJson(videoFile, next);

    return { account, video: next };
  });
}

export async function deleteVideos(platform: Platform, accountId: string, videoIds: string[]) {
  const account = await resolveAccount(platform, accountId);
  const uniqueIds = [...new Set(videoIds)].filter(Boolean);
  const deleted: string[] = [];

  for (const videoId of uniqueIds) {
    const normalizedVideoId = normalizeVideoId(videoId);
    const videoFile = path.join(videosPath(account.platform, account.slug), `${normalizedVideoId}.json`);
    if (!(await exists(videoFile))) continue;

    await Promise.all([
      fs.rm(videoFile, { force: true }),
      fs.rm(path.join(transcriptsPath(account.platform, account.slug), `${normalizedVideoId}.txt`), { force: true }),
      fs.rm(transcriptHistoryPath(account.platform, account.slug, normalizedVideoId), { recursive: true, force: true }),
      fs.rm(accountStyleSampleAnalysisPath(account.platform, account.slug, normalizedVideoId), { force: true })
    ]);
    deleted.push(normalizedVideoId);
  }

  if (deleted.length) {
    const draftFiles = await fs.readdir(draftsPath(account.platform, account.slug)).catch(() => []);
    await Promise.all(
      draftFiles
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const target = path.join(draftsPath(account.platform, account.slug), file);
          const draft = await readJson<Draft>(target);
          if (!draft || draft.targetType === "project") return;
          const currentVideoIds = draft.styleRef.videoIds;
          if (!currentVideoIds?.length) return;

          const nextVideoIds = currentVideoIds.filter((videoId: string) => !deleted.includes(videoId));
          if (nextVideoIds.length === currentVideoIds.length) return;

          await writeJson(target, {
            ...draft,
            styleRef: {
              ...draft.styleRef,
              videoIds: nextVideoIds.length ? nextVideoIds : undefined
            },
            updatedAt: nowIso()
          });
        })
    );
  }

  return { account, deleted };
}

export async function saveStyle(platform: Platform, accountId: string, content: string) {
  const account = await resolveAccount(platform, accountId);
  await writeTextFileAtomic(stylePath(account.platform, account.slug), content.trimEnd() + "\n");
  return content.trimEnd();
}

export async function readStyle(platform: Platform, accountId: string) {
  const account = await resolveAccount(platform, accountId);
  await ensureAccountDirs(account.platform, account.slug);
  return fs.readFile(stylePath(account.platform, account.slug), "utf8").catch(() => DEFAULT_STYLE);
}

export async function readAccountStyleMeta(platform: Platform, accountId: string) {
  const account = await resolveAccount(platform, accountId);
  await ensureAccountDirs(account.platform, account.slug);
  return readJson<AccountStyleMeta>(styleMetaPath(account.platform, account.slug));
}

export async function saveAccountStyleMeta(platform: Platform, accountId: string, meta: Omit<AccountStyleMeta, "updatedAt">) {
  const account = await resolveAccount(platform, accountId);
  await ensureAccountDirs(account.platform, account.slug);
  const next: AccountStyleMeta = {
    ...meta,
    updatedAt: nowIso()
  };
  await writeJson(styleMetaPath(account.platform, account.slug), next);
  return next;
}

export async function readAccountStyleSampleAnalysis(platform: Platform, accountId: string, videoId: string) {
  const account = await resolveAccount(platform, accountId);
  await ensureAccountDirs(account.platform, account.slug);
  return readJson<StyleSampleAnalysisCache>(accountStyleSampleAnalysisPath(account.platform, account.slug, videoId));
}

export async function saveAccountStyleSampleAnalysis(
  platform: Platform,
  accountId: string,
  videoId: string,
  cache: StyleSampleAnalysisCache
) {
  const account = await resolveAccount(platform, accountId);
  await ensureAccountDirs(account.platform, account.slug);
  await writeJson(accountStyleSampleAnalysisPath(account.platform, account.slug, videoId), cache);
  return cache;
}

export async function saveProjectStyle(projectId: string, content: string) {
  const project = await resolveProject(projectId);
  await ensureProjectDirs(project.slug);
  await writeTextFileAtomic(projectStylePath(project.slug), content.trimEnd() + "\n");
  return content.trimEnd();
}

export async function readProjectStyle(projectId: string) {
  const project = await resolveProject(projectId);
  await ensureProjectDirs(project.slug);
  return fs.readFile(projectStylePath(project.slug), "utf8").catch(() => DEFAULT_STYLE);
}

export async function readProjectStyleMeta(projectId: string) {
  const project = await resolveProject(projectId);
  await ensureProjectDirs(project.slug);
  return readJson<ProjectStyleMeta>(projectStyleMetaPath(project.slug));
}

export async function saveProjectStyleMeta(projectId: string, meta: Omit<ProjectStyleMeta, "updatedAt">) {
  const project = await resolveProject(projectId);
  await ensureProjectDirs(project.slug);
  const next: ProjectStyleMeta = {
    ...meta,
    updatedAt: nowIso()
  };
  await writeJson(projectStyleMetaPath(project.slug), next);
  return next;
}

export async function readCopySourceStyleAnalysis(sourceId: string) {
  await ensureLibrary();
  const id = normalizeCopySourceId(sourceId);
  return readJson<StyleSampleAnalysisCache>(copySourceStyleAnalysisPath(id));
}

export async function saveCopySourceStyleAnalysis(sourceId: string, cache: StyleSampleAnalysisCache) {
  await ensureLibrary();
  const id = normalizeCopySourceId(sourceId);
  await writeJson(copySourceStyleAnalysisPath(id), cache);
  return cache;
}

export async function saveDraft(input: DraftInput) {
  const now = nowIso();
  const id = `${now.replace(/[:.]/g, "-")}-${shortHash(input.content)}`;
  const title = makeDraftTitleFromContent(input.content || input.prompt || input.title, input.title);

  if (input.targetType === "project") {
    const project = await resolveProject(input.projectId);
    await ensureProjectDirs(project.slug);

    const draft: ProjectDraft = {
      ...input,
      title,
      id,
      createdAt: now,
      updatedAt: now
    };

    await writeJson(path.join(projectDraftsPath(project.slug), `${draft.id}.json`), draft);
    return draft;
  }

  const account = await resolveAccount(input.platform, input.accountId);
  await ensureAccountDirs(account.platform, account.slug);

  const draft: AccountDraft = {
    ...input,
    title,
    id,
    createdAt: now,
    updatedAt: now
  };

  await writeJson(path.join(draftsPath(account.platform, account.slug), `${draft.id}.json`), draft);
  return draft;
}

export async function resolveDraft(draftId: string) {
  await ensureLibrary();
  const normalizedDraftId = normalizeDraftId(draftId);
  const [accountDraft, projectDraft] = await Promise.all([
    findAccountDraft(normalizedDraftId),
    findProjectDraft(normalizedDraftId)
  ]);
  const result = accountDraft || projectDraft;
  if (!result) throw new Error(`找不到草稿：${normalizedDraftId}`);
  return result;
}

export async function updateDraftTitle(draftId: string, title: string) {
  const normalizedDraftId = normalizeDraftId(draftId);
  const normalizedTitle = normalizeDraftTitle(title);

  return withDraftAssetsLock(normalizedDraftId, async () => {
    const resolved = await resolveDraft(normalizedDraftId);
    const nextDraft: Draft = {
      ...resolved.draft,
      title: normalizedTitle,
      updatedAt: nowIso()
    };
    await writeJson(resolved.file, nextDraft);
    return nextDraft;
  });
}

export async function updateDraftAssets(draftId: string, assets: DraftAssets | ((current: DraftAssets) => DraftAssets)) {
  const normalizedDraftId = normalizeDraftId(draftId);
  return withDraftAssetsLock(normalizedDraftId, async () => {
    const resolved = await resolveDraft(normalizedDraftId);
    const nextAssets = typeof assets === "function" ? assets(resolved.draft.assets || {}) : assets;
    const nextDraft: Draft = {
      ...resolved.draft,
      assets: nextAssets,
      updatedAt: nowIso()
    } as Draft;
    await writeJson(resolved.file, nextDraft);
    return nextDraft;
  });
}

export async function deleteDrafts(draftIds: string[]) {
  await ensureLibrary();
  const uniqueIds = [...new Set(draftIds)].filter(Boolean).map(normalizeDraftId);
  const deleted: string[] = [];

  for (const draftId of uniqueIds) {
    const resolved = await resolveDraft(draftId).catch(() => null);
    if (!resolved) continue;
    const assetBase = getDraftAssetBase(resolved.draft);
    await Promise.all([
      fs.rm(resolved.file, { force: true }),
      fs.rm(assetBase, { recursive: true, force: true })
    ]);
    deleted.push(draftId);
  }

  return { deleted };
}

export async function ensureDraftAssetDir(draftId: string, kind = "") {
  const resolved = await resolveDraft(draftId);
  const base = getDraftAssetBase(resolved.draft);
  const target = kind ? path.join(base, safeSegment(kind)) : base;
  await fs.mkdir(target, { recursive: true });
  return {
    ...resolved,
    dir: target,
    baseDir: base
  };
}

export async function saveUploadedDraftCoverReferences(input: {
  draftId: string;
  files: Array<{ name: string; type: string; data: Buffer }>;
}) {
  const resolved = await ensureDraftAssetDir(input.draftId, "references");
  const now = nowIso();
  const references: DraftCoverReference[] = [];

  for (const file of input.files) {
    const extension = coverExtensionFromMime(file.type, file.name);
    const id = `${now.replace(/[:.]/g, "-")}-${shortHash(`${file.name}-${file.data.length}-${references.length}`)}`;
    const filename = `${id}.${extension}`;
    const target = path.join(resolved.dir, filename);
    await writeFileAtomic(target, file.data);
    references.push({
      id,
      source: "upload",
      label: file.name || `上传参考图 ${references.length + 1}`,
      path: path.relative(resolved.baseDir, target),
      createdAt: now
    });
  }

  const draft = await updateDraftAssets(input.draftId, (current) => ({
    ...current,
    cover: {
      references: mergeCoverReferences(current.cover?.references || [], references),
      images: current.cover?.images || [],
      updatedAt: nowIso()
    }
  }));

  return { draft, references };
}

export async function saveGeneratedCoverImage(input: {
  draftId: string;
  bytes: Buffer;
  prompt: string;
  referenceIds: string[];
  model: string;
  size: string;
  quality: string;
  format: DraftCoverImage["format"];
}) {
  const resolved = await ensureDraftAssetDir(input.draftId, "covers");
  const now = nowIso();
  const id = `${now.replace(/[:.]/g, "-")}-${shortHash(`${input.prompt}-${input.referenceIds.join(",")}`)}`;
  const filename = `${id}.${input.format === "jpeg" ? "jpg" : input.format}`;
  const target = path.join(resolved.dir, filename);
  await writeFileAtomic(target, input.bytes);

  const image: DraftCoverImage = {
    id,
    path: path.relative(resolved.baseDir, target),
    prompt: input.prompt,
    referenceIds: input.referenceIds,
    model: input.model,
    size: input.size,
    quality: input.quality,
    format: input.format,
    createdAt: now
  };

  const draft = await updateDraftAssets(input.draftId, (current) => ({
    ...current,
    cover: {
      references: current.cover?.references || [],
      images: [...(current.cover?.images || []), image],
      updatedAt: nowIso()
    }
  }));

  return { draft, image, file: target };
}

export async function getDraftAssetFile(draftId: string, assetPath: string) {
  const resolved = await ensureDraftAssetDir(draftId);
  const target = path.resolve(resolved.baseDir, assetPath);
  const relative = path.relative(resolved.baseDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("素材路径不在当前草稿目录内");
  }

  const bytes = await fs.readFile(target);
  return {
    bytes,
    file: target,
    contentType: contentTypeFromExtension(target)
  };
}

export async function getAccountSummary(account: Account): Promise<AccountSummary> {
  await ensureAccountDirs(account.platform, account.slug);

  const [videoFiles, draftFiles, style] = await Promise.all([
    fs.readdir(videosPath(account.platform, account.slug)).catch(() => []),
    fs.readdir(draftsPath(account.platform, account.slug)).catch(() => []),
    fs.readFile(stylePath(account.platform, account.slug), "utf8").catch(() => DEFAULT_STYLE)
  ]);

  const videos = (
    await Promise.all(
      videoFiles
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson<Video>(path.join(videosPath(account.platform, account.slug), file)))
    )
  )
    .filter(Boolean)
    .sort((a, b) => b!.hotScore - a!.hotScore) as Video[];

  const drafts = (
    await Promise.all(
      draftFiles
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson<Draft>(path.join(draftsPath(account.platform, account.slug), file)))
    )
  )
    .filter(Boolean)
    .sort((a, b) => +new Date(b!.createdAt) - +new Date(a!.createdAt)) as Draft[];

  return {
    ...account,
    style,
    videos,
    drafts,
    videoCount: videos.length,
    transcriptCount: videos.filter(videoHasTranscript).length,
    draftCount: drafts.length
  };
}

export async function getAccountDetail(
  platform: Platform,
  accountIdOrSlug: string,
  options: DetailReadOptions = {}
): Promise<AccountDetail> {
  const account = await resolveAccount(platform, accountIdOrSlug);
  await ensureAccountDirs(account.platform, account.slug);

  const [videoFiles, draftFiles, style] = await Promise.all([
    fs.readdir(videosPath(account.platform, account.slug)).catch(() => []),
    fs.readdir(draftsPath(account.platform, account.slug)).catch(() => []),
    options.includeStyle
      ? fs.readFile(stylePath(account.platform, account.slug), "utf8").catch(() => DEFAULT_STYLE)
      : Promise.resolve<string | undefined>(undefined)
  ]);

  const videos = (
    await Promise.all(
      videoFiles
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson<Video>(path.join(videosPath(account.platform, account.slug), file)))
    )
  )
    .filter(Boolean)
    .sort((a, b) => b!.hotScore - a!.hotScore) as Video[];

  const drafts = (
    await Promise.all(
      draftFiles
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson<Draft>(path.join(draftsPath(account.platform, account.slug), file)))
    )
  )
    .filter(Boolean)
    .sort((a, b) => +new Date(b!.createdAt) - +new Date(a!.createdAt)) as Draft[];

  return {
    ...account,
    ...(style !== undefined ? { style } : {}),
    videos: videos.map(stripVideoRaw),
    drafts,
    videoCount: videos.length,
    transcriptCount: videos.filter(videoHasTranscript).length,
    draftCount: drafts.length
  };
}

async function getAccountListItem(account: Account): Promise<AccountListItem> {
  await ensureAccountDirs(account.platform, account.slug);

  const [videoFiles, transcriptFiles, draftFiles, styleMeta, styleText, styleStat] = await Promise.all([
    fs.readdir(videosPath(account.platform, account.slug)).catch(() => []),
    fs.readdir(transcriptsPath(account.platform, account.slug)).catch(() => []),
    fs.readdir(draftsPath(account.platform, account.slug)).catch(() => []),
    readJson<AccountStyleMeta>(styleMetaPath(account.platform, account.slug)),
    fs.readFile(stylePath(account.platform, account.slug), "utf8").catch(() => DEFAULT_STYLE),
    fs.stat(stylePath(account.platform, account.slug)).catch(() => null)
  ]);
  const videoIds = new Set(videoFiles.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)));
  const transcriptIds = new Set(transcriptFiles.filter((file) => file.endsWith(".txt")).map((file) => file.slice(0, -4)));
  const transcriptCount = [...videoIds].filter((videoId) => transcriptIds.has(videoId)).length;
  const styleStatus = styleMeta
    ? styleMeta.fallback
      ? "fallback"
      : "ready"
    : styleText.trim() !== DEFAULT_STYLE.trim()
      ? "manual"
      : "not_generated";

  return {
    ...account,
    videoCount: videoIds.size,
    transcriptCount,
    missingTranscriptCount: Math.max(0, videoIds.size - transcriptCount),
    draftCount: draftFiles.filter((file) => file.endsWith(".json")).length,
    styleStatus,
    styleUpdatedAt: styleMeta?.updatedAt || (styleStatus === "manual" ? styleStat?.mtime.toISOString() : undefined)
  };
}

export async function resolveProject(projectIdOrSlug: string) {
  await ensureLibrary();
  const slug = normalizeProjectSlug(projectIdOrSlug);
  const project = await readJson<Project>(projectJsonPath(slug));
  if (!project) {
    throw new Error(`找不到项目：${slug}`);
  }
  return project;
}

export async function getProjectSummary(project: Project): Promise<ProjectSummary> {
  await ensureProjectDirs(project.slug);
  const [style, libraryAccounts, sourceMaterials] = await Promise.all([
    fs.readFile(projectStylePath(project.slug), "utf8").catch(() => DEFAULT_STYLE),
    getAllAccountListItems(),
    getProjectCopySources(project.sourceMaterialIds || [])
  ]);
  const sourceAccounts = libraryAccounts
    .filter((account) => project.sourceAccountIds.includes(account.id))
    .map((account) => ({
      id: account.id,
      name: account.name,
      platform: account.platform,
      videoCount: account.videoCount,
      transcriptCount: account.transcriptCount
    }));

  return {
    ...project,
    sourceMaterialIds: project.sourceMaterialIds || [],
    style,
    sourceAccounts,
    sourceMaterials,
    sourceMaterialCount: sourceMaterials.length
  };
}

export async function getProjectDetail(
  projectIdOrSlug: string,
  options: DetailReadOptions = {}
): Promise<ProjectDetail> {
  const project = await resolveProject(projectIdOrSlug);
  await ensureProjectDirs(project.slug);
  const [style, libraryAccounts, sourceMaterials] = await Promise.all([
    options.includeStyle
      ? fs.readFile(projectStylePath(project.slug), "utf8").catch(() => DEFAULT_STYLE)
      : Promise.resolve<string | undefined>(undefined),
    getAllAccountListItems(),
    getProjectCopySources(project.sourceMaterialIds || [])
  ]);
  const sourceAccounts = libraryAccounts
    .filter((account) => project.sourceAccountIds.includes(account.id))
    .map((account) => ({
      id: account.id,
      name: account.name,
      platform: account.platform,
      videoCount: account.videoCount,
      transcriptCount: account.transcriptCount
    }));

  return {
    ...project,
    sourceMaterialIds: project.sourceMaterialIds || [],
    ...(style !== undefined ? { style } : {}),
    sourceAccounts,
    sourceMaterials,
    sourceMaterialCount: sourceMaterials.length
  };
}

async function getAllAccountSummaries() {
  const accounts: AccountSummary[] = [];

  for (const platform of platforms) {
    const entries = await fs.readdir(platformPath(platform), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const account = await readJson<Account>(accountJsonPath(platform, entry.name));
      if (!account) continue;
      accounts.push(await getAccountSummary(account));
    }
  }

  return accounts.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

async function getAllAccountListItems() {
  const accountRecords = (
    await Promise.all(
      platforms.map(async (platform) => {
        const entries = await fs.readdir(platformPath(platform), { withFileTypes: true }).catch(() => []);
        return Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => readJson<Account>(accountJsonPath(platform, entry.name)))
        );
      })
    )
  ).flat().filter(Boolean) as Account[];
  const accounts = await mapWithConcurrency(accountRecords, 6, getAccountListItem);
  return accounts.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function getAllProjectSummaries() {
  const entries = await fs.readdir(projectsPath(), { withFileTypes: true }).catch(() => []);
  const projects = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readJson<Project>(projectJsonPath(entry.name)))
    )
  ).filter(Boolean) as Project[];

  return (
    await Promise.all(projects.map((project) => getProjectSummary(project)))
  ).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

async function getAllProjectListItems(accounts?: AccountListItem[]): Promise<ProjectListItem[]> {
  const entries = await fs.readdir(projectsPath(), { withFileTypes: true }).catch(() => []);
  const projects = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readJson<Project>(projectJsonPath(entry.name)))
    )
  ).filter(Boolean) as Project[];
  const libraryAccounts = accounts || await getAllAccountListItems();

  return projects
    .map((project) => {
      const sourceAccounts = libraryAccounts
        .filter((account) => project.sourceAccountIds.includes(account.id))
        .map((account) => ({
          id: account.id,
          name: account.name,
          platform: account.platform,
          videoCount: account.videoCount,
          transcriptCount: account.transcriptCount
        }));

      return {
        ...project,
        sourceMaterialIds: project.sourceMaterialIds || [],
        sourceAccounts,
        sourceMaterialCount: project.sourceMaterialIds?.length || 0
      };
    })
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

async function getAllAccountDrafts() {
  const draftGroups = await Promise.all(
    platforms.map(async (platform) => {
      const entries = await fs.readdir(platformPath(platform), { withFileTypes: true }).catch(() => []);
      return Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .flatMap(async (entry) => {
            const files = await fs.readdir(draftsPath(platform, entry.name)).catch(() => []);
            return Promise.all(
              files
                .filter((file) => file.endsWith(".json"))
                .map((file) => readJson<AccountDraft>(path.join(draftsPath(platform, entry.name), file)))
            );
          })
      );
    })
  );

  return draftGroups.flat(2).filter(Boolean) as AccountDraft[];
}

async function getAllProjectDrafts() {
  const entries = await fs.readdir(projectsPath(), { withFileTypes: true }).catch(() => []);
  const drafts = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .flatMap(async (entry) => {
          const files = await fs.readdir(projectDraftsPath(entry.name)).catch(() => []);
          return Promise.all(
            files
              .filter((file) => file.endsWith(".json"))
              .map((file) => readJson<ProjectDraft>(path.join(projectDraftsPath(entry.name), file)))
          );
        })
    )
  )
    .flat()
    .filter(Boolean) as ProjectDraft[];

  return drafts.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function getDrafts() {
  await ensureLibrary();
  const [accountDrafts, projectDrafts] = await Promise.all([
    getAllAccountDrafts(),
    getAllProjectDrafts()
  ]);
  return [...accountDrafts, ...projectDrafts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function getLibraryOverview(options: { includeAuxiliary?: boolean } = {}): Promise<LibraryOverviewResponse> {
  await ensureLibrary();
  const accounts = await getAllAccountListItems();
  const projects = await getAllProjectListItems(accounts);

  if (!options.includeAuxiliary) {
    return {
      root: libraryRoot(),
      accounts,
      projects,
      copySources: [],
      engagementRecords: [],
      drafts: []
    };
  }

  const [copySources, engagementRecords, accountDrafts, projectDrafts] = await Promise.all([
    getCopySources(),
    getEngagementRecords(),
    getAllAccountDrafts(),
    getAllProjectDrafts()
  ]);
  const drafts = [...accountDrafts, ...projectDrafts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return {
    root: libraryRoot(),
    accounts,
    projects,
    copySources: copySources.map(stripCopySourceForOverview),
    engagementRecords: engagementRecords.map(stripEngagementRecordForOverview),
    drafts: drafts.map(stripDraftForOverview)
  };
}

export async function getLibrary(): Promise<LibraryState> {
  await ensureLibrary();
  const [accounts, projects, copySources, engagementRecords] = await Promise.all([
    getAllAccountSummaries(),
    getAllProjectSummaries(),
    getCopySources(),
    getEngagementRecords()
  ]);

  const projectDrafts = await getAllProjectDrafts();
  const drafts = [...accounts.flatMap((account) => account.drafts), ...projectDrafts];
  const recentAccounts = [...accounts].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4);
  const recentProjects = [...projects].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4);
  const recentCopySources = [...copySources].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 8);
  const recentEngagementRecords = [...engagementRecords].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 8);
  const recentDrafts = [...drafts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 8);

  return {
    root: libraryRoot(),
    accounts,
    projects,
    copySources,
    engagementRecords,
    drafts,
    recentAccounts,
    recentProjects,
    recentCopySources,
    recentEngagementRecords,
    recentDrafts
  };
}

export async function getVideo(platform: Platform, accountId: string, videoId: string) {
  const account = await resolveAccount(platform, accountId);
  const normalizedVideoId = normalizeVideoId(videoId);
  const video = await readJson<Video>(path.join(videosPath(account.platform, account.slug), `${normalizedVideoId}.json`));
  if (!video) throw new Error("找不到视频");
  return { account, video };
}

async function findAccountDraft(draftId: string) {
  for (const platform of platforms) {
    const entries = await fs.readdir(platformPath(platform), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(draftsPath(platform, entry.name), `${draftId}.json`);
      const draft = await readJson<AccountDraft>(file);
      if (draft) return { draft: draft as Draft, file };
    }
  }
  return null;
}

async function findProjectDraft(draftId: string) {
  const entries = await fs.readdir(projectsPath(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(projectDraftsPath(entry.name), `${draftId}.json`);
    const draft = await readJson<ProjectDraft>(file);
    if (draft) return { draft: draft as Draft, file };
  }
  return null;
}

function getDraftAssetBase(draft: Draft) {
  if (draft.targetType === "project") {
    return projectDraftAssetsPath(normalizeProjectSlug(draft.projectId), draft.id);
  }

  return draftAssetsPath(draft.platform, normalizeAccountSlug(draft.accountId), draft.id);
}

async function assertCopySourcesExist(sourceIds: string[]) {
  const uniqueIds = [...new Set(sourceIds)].filter(Boolean).map(normalizeCopySourceId);
  const sources: CopySource[] = [];

  for (const sourceId of uniqueIds) {
    sources.push(await resolveCopySource(sourceId));
  }

  return sources;
}

async function assertAccountsExist(accountIds: string[]) {
  const uniqueIds = normalizeProjectAccountRefs(accountIds);
  const accounts: Account[] = [];

  for (const accountId of uniqueIds) {
    const [platform, slug] = accountId.split(":") as [Platform, string];
    if (!platforms.includes(platform) || !slug?.trim()) {
      throw new Error(`账号引用不合法：${accountId}`);
    }
    accounts.push(await resolveAccount(platform, slug));
  }

  return accounts;
}

function normalizeProjectAccountRefs(accountIds: string[]) {
  return uniqueTrimmedStrings(accountIds).map((accountId) => {
    const [platform, slug] = accountId.split(":") as [Platform, string];
    if (!platforms.includes(platform) || !slug?.trim()) {
      throw new Error(`账号引用不合法：${accountId}`);
    }
    return `${platform}:${normalizeAccountSlug(slug)}`;
  });
}

async function getProjectCopySources(sourceIds: string[]) {
  const uniqueIds = [...new Set(sourceIds)].filter(Boolean);
  const sources = await Promise.all(uniqueIds.map((sourceId) => resolveCopySource(sourceId).catch(() => null)));
  return sources.filter(Boolean) as CopySource[];
}

async function syncCopySourceProjectRefs(projectId: string, nextSourceIds: string[]) {
  const sources = await getCopySources();
  const nextSet = new Set(nextSourceIds.map(normalizeCopySourceId));

  await Promise.all(
    sources.map(async (source) => {
      const projectIds = new Set(source.projectIds || []);
      const shouldHaveProject = nextSet.has(source.id);
      const hadProject = projectIds.has(projectId);
      if (shouldHaveProject) projectIds.add(projectId);
      if (!shouldHaveProject) projectIds.delete(projectId);
      if (projectIds.has(projectId) === hadProject && shouldHaveProject === hadProject) return;
      await writeJson(copySourceJsonPath(source.id), {
        ...source,
        projectIds: [...projectIds],
        updatedAt: nowIso()
      });
    })
  );
}

async function removeCopySourceProjectRefs(projectIds: string[]) {
  const deleted = new Set(projectIds);
  const sources = await getCopySources();

  await Promise.all(
    sources.map(async (source) => {
      const projectRefs = source.projectIds || [];
      const nextProjectIds = projectRefs.filter((projectId) => !deleted.has(projectId));
      if (nextProjectIds.length === projectRefs.length) return;
      await writeJson(copySourceJsonPath(source.id), {
        ...source,
        projectIds: nextProjectIds,
        updatedAt: nowIso()
      });
    })
  );
}

async function removeDeletedAccountsFromProjects(accountIds: string[]) {
  const deleted = new Set(accountIds);
  const entries = await fs.readdir(projectsPath(), { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const project = await readJson<Project>(projectJsonPath(entry.name));
        const updateProject = async () => {
          if (!project) return;
          const sourceAccountIds = project.sourceAccountIds.filter((id) => !deleted.has(id));
          if (sourceAccountIds.length === project.sourceAccountIds.length) return;
          await writeJson(projectJsonPath(entry.name), {
            ...project,
            sourceAccountIds,
            updatedAt: nowIso()
          });
        };

        await Promise.all([
          updateProject(),
          updateProjectDraftRefs(entry.name, (draft) => {
            const sourceAccountIds = filterRemovedIds(draft.styleRef.sourceAccountIds, deleted);
            if (!sourceAccountIds) return null;
            return {
              ...draft.styleRef,
              sourceAccountIds: sourceAccountIds.length ? sourceAccountIds : undefined
            };
          })
        ]);
      })
  );
}

async function removeCopySourcesFromProjects(sourceIds: string[]) {
  const deleted = new Set(sourceIds);
  const entries = await fs.readdir(projectsPath(), { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const project = await readJson<Project>(projectJsonPath(entry.name));
        const updateProject = async () => {
          const sourceMaterialIds = filterRemovedIds(project?.sourceMaterialIds, deleted);
          if (!project || !sourceMaterialIds) return;
          await writeJson(projectJsonPath(entry.name), {
            ...project,
            sourceMaterialIds: sourceMaterialIds.length ? sourceMaterialIds : undefined,
            updatedAt: nowIso()
          });
        };

        await Promise.all([
          updateProject(),
          updateProjectDraftRefs(entry.name, (draft) => {
            const sourceMaterialIds = filterRemovedIds(draft.styleRef.sourceMaterialIds, deleted);
            if (!sourceMaterialIds) return null;
            return {
              ...draft.styleRef,
              sourceMaterialIds: sourceMaterialIds.length ? sourceMaterialIds : undefined
            };
          })
        ]);
      })
  );
}

function filterRemovedIds(ids: string[] | undefined, deleted: Set<string>) {
  if (!ids?.length) return null;
  const nextIds = ids.filter((id) => !deleted.has(id));
  return nextIds.length === ids.length ? null : nextIds;
}

async function updateProjectDraftRefs(
  projectSlug: string,
  updateStyleRef: (draft: ProjectDraft) => ProjectDraft["styleRef"] | null
) {
  const files = await fs.readdir(projectDraftsPath(projectSlug)).catch(() => []);

  await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const target = path.join(projectDraftsPath(projectSlug), file);
        const draft = await readJson<ProjectDraft>(target);
        if (!draft?.styleRef) return;
        const styleRef = updateStyleRef(draft);
        if (!styleRef) return;
        await writeJson(target, {
          ...draft,
          styleRef,
          updatedAt: nowIso()
        });
      })
  );
}

function normalizeCopySource(source: CopySource): CopySource {
  return {
    ...source,
    transcript: source.transcript || "",
    transcriptPath: source.transcriptPath || copySourceTranscriptPath(source.id),
    status: source.status || "completed",
    source: source.source || "manual",
    materialAnalysis: source.materialAnalysis,
    projectIds: source.projectIds || []
  };
}

function stripCopySourceForOverview(source: CopySource): CopySource {
  return {
    ...source,
    transcript: ""
  };
}

function stripEngagementRecordForOverview(record: EngagementRecord): EngagementRecord {
  return {
    ...record,
    sourceText: ""
  };
}

function stripDraftForOverview(draft: Draft): Draft {
  const strippedAssets = draft.assets
    ? {
        comments: draft.assets.comments ? { ...draft.assets.comments, items: [] } : undefined,
        danmaku: draft.assets.danmaku ? { ...draft.assets.danmaku, items: [] } : undefined,
        cover: draft.assets.cover ? { ...draft.assets.cover, references: [], images: [] } : undefined
      }
    : undefined;

  return {
    ...draft,
    input: undefined,
    research: undefined,
    content: "",
    assets: strippedAssets
  } as Draft;
}

function formatPlatformName(platform: CopySource["platform"]) {
  if (platform === "bilibili") return "B站";
  if (platform === "douyin") return "抖音";
  return "链接";
}

function mergeCoverReferences(existing: DraftCoverReference[], incoming: DraftCoverReference[]) {
  const byId = new Map(existing.map((reference) => [reference.id, reference]));
  for (const reference of incoming) byId.set(reference.id, reference);
  return [...byId.values()];
}

function coverExtensionFromMime(mimeType: string, name: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  const extension = path.extname(name).replace(/^\./, "").toLowerCase();
  return ["jpg", "jpeg", "png", "webp"].includes(extension) ? (extension === "jpeg" ? "jpg" : extension) : "jpg";
}

function contentTypeFromExtension(file: string) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "image/jpeg";
}

export async function getTopTranscriptSamples(platform: Platform, accountId: string, maxSamples: number | "all" = 8) {
  const account = await resolveAccount(platform, accountId);
  const summary = await getAccountSummary(account);
  const completed = summary.videos.filter(videoHasTranscript);
  const selected = maxSamples === "all" ? completed : completed.slice(0, maxSamples);

  const samples = await Promise.all(
    selected.map(async (video) => ({
      video,
      transcript: await readTranscript(platform, accountId, video.id)
    }))
  );

  return samples.filter((sample) => sample.transcript.trim());
}

function calculateHotScore(video: Video) {
  return (
    video.stats.views +
    video.stats.likes * 20 +
    video.stats.comments * 60 +
    video.stats.favorites * 80 +
    (video.stats.shares ?? 0) * 50
  );
}
