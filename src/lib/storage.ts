import { promises as fs } from "fs";
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
  GrossMarginCategory,
  GrossMarginAccountPrice,
  GrossMarginLibrary,
  GrossMarginMonitorMetric,
  GrossMarginMonitorPlaySample,
  GrossMarginMonitorRecord,
  GrossMarginPriceOption,
  GrossMarginPriceTable,
  GrossMarginServiceKind,
  GrossMarginMonitorStatus,
  GrossMarginTier,
  LibraryOverviewResponse,
  LibraryState,
  Platform,
  Project,
  ProjectDetail,
  ProjectDraft,
  ProjectListItem,
  ProjectSummary,
  Video,
  VideoListItem,
  platforms
} from "./types";
import { makeDraftTitleFromContent, nowIso, safeSegment, shortHash } from "./utils";
import { fileExists, readJsonFile, writeJsonFile } from "./storage/fs";

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
const grossMarginTablePlatforms = ["douyin", "bilibili"] as const;
const grossMarginServices = ["play", "like", "douPlus", "coin", "comment", "share", "favorite", "danmaku", "blueLink"] as const;
const maxGrossMarginPlaySamples = 180;

type DetailReadOptions = {
  includeStyle?: boolean;
};

function videoHasTranscript(video: Pick<Video, "transcriptStatus" | "transcriptPath">) {
  return video.transcriptStatus === "completed" || Boolean(video.transcriptPath);
}

function stripVideoRaw(video: Video): VideoListItem {
  const copy = { ...video };
  delete copy.raw;
  return copy;
}

export function libraryRoot() {
  return path.resolve(process.cwd(), process.env.STYLE_LIBRARY_DIR || "style-library");
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

function grossMarginPath() {
  return path.join(libraryRoot(), "gross-margin");
}

function grossMarginCategoriesPath() {
  return path.join(grossMarginPath(), "categories");
}

function grossMarginMonitorRecordsPath() {
  return path.join(grossMarginPath(), "monitor-records");
}

function grossMarginMonitorRecordJsonPath(id: string) {
  return path.join(grossMarginMonitorRecordsPath(), `${id}.json`);
}

function grossMarginCategoryJsonPath(id: string) {
  return path.join(grossMarginCategoriesPath(), `${id}.json`);
}

function grossMarginPriceTablePath(platform: GrossMarginPriceTable["platform"]) {
  return path.join(grossMarginPath(), `${platform}.json`);
}

function grossMarginAccountsPath() {
  return path.join(grossMarginPath(), "accounts.json");
}

function engagementRecordJsonPath(id: string) {
  return path.join(engagementPath(), `${id}.json`);
}

function copySourceJsonPath(id: string) {
  return path.join(copySourcesPath(), `${id}.json`);
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

function draftsPath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "drafts");
}

function draftAssetsPath(platform: Platform, slug: string, draftId: string) {
  return path.join(draftsPath(platform, slug), `${safeSegment(draftId)}.assets`);
}

function stylePath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "style.md");
}

function normalizeStorageSegment(value: string, label: string) {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized === "." ||
    normalized.includes("..") ||
    normalized !== safeSegment(normalized)
  ) {
    throw new Error(`${label} 不合法`);
  }
  return normalized;
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

function normalizeEngagementRecordId(recordId: string) {
  return normalizeStorageSegment(recordId, "互动素材 ID");
}

function normalizeGrossMarginCategoryId(categoryId: string) {
  return normalizeStorageSegment(categoryId, "毛利类目 ID");
}

function normalizeGrossMarginTierId(tierId: string) {
  return normalizeStorageSegment(tierId, "毛利档位 ID");
}

function normalizeGrossMarginMonitorRecordId(recordId: string) {
  return normalizeStorageSegment(recordId, "维护监控记录 ID");
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
    await fs.writeFile(style, DEFAULT_STYLE, "utf8");
  }
}

async function ensureProjectDirs(slug: string) {
  await fs.mkdir(projectDraftsPath(slug), { recursive: true });

  const style = projectStylePath(slug);
  if (!(await exists(style))) {
    await fs.writeFile(style, DEFAULT_STYLE, "utf8");
  }
}

export async function ensureLibrary() {
  await fs.mkdir(libraryRoot(), { recursive: true });
  await Promise.all([
    ...platforms.map((platform) => fs.mkdir(platformPath(platform), { recursive: true })),
    fs.mkdir(projectsPath(), { recursive: true }),
    fs.mkdir(copySourcesPath(), { recursive: true }),
    fs.mkdir(engagementPath(), { recursive: true }),
    fs.mkdir(grossMarginPath(), { recursive: true }),
    fs.mkdir(grossMarginCategoriesPath(), { recursive: true }),
    fs.mkdir(grossMarginMonitorRecordsPath(), { recursive: true })
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
  lastCollectedAt?: string;
}) {
  await ensureLibrary();

  const existing = await findExistingAccount(input.platform, input.uid);
  const now = nowIso();
  const slug = existing?.slug ?? safeSegment(input.name || input.uid, shortHash(input.uid));
  await ensureAccountDirs(input.platform, slug);

  const account: Account = {
    id: `${input.platform}:${slug}`,
    slug,
    platform: input.platform,
    name: input.name || existing?.name || input.uid,
    uid: input.uid,
    sourceUrl: input.sourceUrl || existing?.sourceUrl,
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
    const entries = await fs.readdir(projectsPath(), { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const project = await readJson<Project>(projectJsonPath(entry.name));
          if (!project) return;
          const sourceAccountIds = project.sourceAccountIds.filter((id) => !deleted.includes(id));
          if (sourceAccountIds.length === project.sourceAccountIds.length) return;
          await writeJson(projectJsonPath(entry.name), {
            ...project,
            sourceAccountIds,
            updatedAt: nowIso()
          });
        })
    );
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
  const slug = existing?.slug ?? safeSegment(input.name, shortHash(input.name));
  await ensureProjectDirs(slug);
  if (input.sourceMaterialIds) {
    await assertCopySourcesExist(input.sourceMaterialIds);
  }

  const project: Project = {
    id: `project:${slug}`,
    slug,
    name: input.name || existing?.name || "未命名项目",
    description: input.description ?? existing?.description,
    sourceAccountIds: input.sourceAccountIds ?? existing?.sourceAccountIds ?? [],
    sourceMaterialIds: input.sourceMaterialIds ?? existing?.sourceMaterialIds ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await writeJson(projectJsonPath(slug), project);
  if (input.sourceMaterialIds) {
    await syncCopySourceProjectRefs(project.id, input.sourceMaterialIds);
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

  await fs.writeFile(transcriptFile, transcript, "utf8");

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

  await writeJson(copySourceJsonPath(id), source);
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
        .filter((file) => file.endsWith(".json"))
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
    if (!(await exists(jsonFile))) continue;
    await Promise.all([
      fs.rm(jsonFile, { force: true }),
      fs.rm(copySourceTranscriptPath(sourceId), { force: true })
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

export async function getGrossMarginLibrary(): Promise<GrossMarginLibrary> {
  await ensureLibrary();
  const tables = await Promise.all(
    grossMarginTablePlatforms.map(async (platform) => {
      const table = await readJson<GrossMarginPriceTable>(grossMarginPriceTablePath(platform));
      return normalizeGrossMarginPriceTable(platform, table);
    })
  );
  const monitorRecords = await getGrossMarginMonitorRecords();

  return {
    root: grossMarginPath(),
    tables,
    accounts: normalizeGrossMarginAccounts(await readJson<GrossMarginAccountPrice[]>(grossMarginAccountsPath())),
    monitorRecords,
    monitorProjects: buildGrossMarginMonitorProjects(monitorRecords)
  };
}

export async function getGrossMarginMonitorRecords() {
  await ensureLibrary();
  const files = await fs.readdir(grossMarginMonitorRecordsPath()).catch(() => []);
  const records = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson<GrossMarginMonitorRecord>(path.join(grossMarginMonitorRecordsPath(), file)))
    )
  ).filter(Boolean) as GrossMarginMonitorRecord[];

  return records
    .map(normalizeGrossMarginMonitorRecord)
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

export async function upsertGrossMarginMonitorRecord(input: {
  platform: GrossMarginPriceTable["platform"];
  accountName: string;
  projectId?: string;
  projectName?: string;
  videoUrl: string;
  videoKey: string;
  sourceText: string;
  targetStats: Partial<Record<GrossMarginServiceKind, number>>;
}) {
  await ensureLibrary();
  const now = nowIso();
  const platform = normalizeGrossMarginPlatform(input.platform);
  const videoKey = input.videoKey.trim();
  if (!videoKey) throw new Error("监控记录缺少视频标识");
  const id = normalizeGrossMarginMonitorRecordId(`${platform}-${safeSegment(videoKey, shortHash(videoKey))}`);
  const existing = await readJson<GrossMarginMonitorRecord>(grossMarginMonitorRecordJsonPath(id));
  const record = normalizeGrossMarginMonitorRecord({
    id,
    platform,
    accountName: input.accountName.trim() || existing?.accountName || "",
    projectId: input.projectId?.trim() || existing?.projectId,
    projectName: input.projectName?.trim() || existing?.projectName,
    videoUrl: input.videoUrl.trim(),
    videoKey,
    title: existing?.title,
    publishedAt: existing?.publishedAt,
    sourceText: input.sourceText,
    targetStats: normalizeGrossMarginTargetStats(input.targetStats, platform),
    currentStats: existing?.currentStats,
    previousStats: existing?.previousStats,
    playSamples: existing?.playSamples,
    metrics: [],
    maxDifferencePercent: 0,
    highRisk: false,
    status: existing?.status || "pending",
    warnings: existing?.warnings || [],
    lastRefreshedAt: existing?.lastRefreshedAt,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });
  await writeJson(grossMarginMonitorRecordJsonPath(id), record);
  return record;
}

export async function saveGrossMarginMonitorRecord(record: GrossMarginMonitorRecord) {
  await ensureLibrary();
  const normalized = normalizeGrossMarginMonitorRecord(record);
  await writeJson(grossMarginMonitorRecordJsonPath(normalized.id), normalized);
  return normalized;
}

export async function resolveGrossMarginMonitorRecord(recordId: string) {
  await ensureLibrary();
  const id = normalizeGrossMarginMonitorRecordId(recordId);
  const record = await readJson<GrossMarginMonitorRecord>(grossMarginMonitorRecordJsonPath(id));
  if (!record) {
    throw new Error(`找不到维护监控记录：${id}`);
  }
  return normalizeGrossMarginMonitorRecord(record);
}

export async function deleteGrossMarginMonitorRecord(recordId: string) {
  await ensureLibrary();
  const id = normalizeGrossMarginMonitorRecordId(recordId);
  const target = grossMarginMonitorRecordJsonPath(id);
  if (await exists(target)) {
    await fs.rm(target, { force: true });
  }
  return { deleted: id };
}

export async function saveGrossMarginPriceTable(input: {
  platform: GrossMarginPriceTable["platform"];
  items: Array<Pick<GrossMarginPriceOption, "id" | "service" | "name" | "unitPrice" | "quantityUnit" | "minimumQuantity" | "note">>;
}) {
  await ensureLibrary();
  const platform = normalizeGrossMarginPlatform(input.platform);
  const now = nowIso();
  const current = normalizeGrossMarginPriceTable(platform, await readJson<GrossMarginPriceTable>(grossMarginPriceTablePath(platform)));
  const byId = new Map(current.items.map((item) => [item.id, item]));

  for (const incoming of input.items) {
    const service = normalizeGrossMarginService(incoming.service);
    const id = normalizeStorageSegment(incoming.id, "单价项 ID");
    const currentItem = byId.get(id);
    byId.set(id, {
      id,
      service,
      name: incoming.name.trim() || formatGrossMarginServiceName(service),
      unitPrice: normalizeGrossMarginUnitPrice(incoming.unitPrice),
      quantityUnit: normalizeGrossMarginQuantityUnit(incoming.quantityUnit),
      minimumQuantity: normalizeGrossMarginMinimumQuantity(incoming.minimumQuantity) ?? currentItem?.minimumQuantity,
      note: incoming.note?.trim() || undefined,
      updatedAt: now
    });
  }

  const table = normalizeGrossMarginPriceTable(platform, {
    platform,
    items: [...byId.values()],
    updatedAt: now
  });

  await writeJson(grossMarginPriceTablePath(platform), table);
  return table;
}

export async function upsertGrossMarginCategory(input: {
  categoryId?: string;
  name: string;
  description?: string;
}) {
  await ensureLibrary();
  const now = nowIso();
  const fallbackId = safeSegment(input.name, shortHash(input.name));
  const existing = input.categoryId
    ? await resolveGrossMarginCategory(input.categoryId)
    : await readJson<GrossMarginCategory>(grossMarginCategoryJsonPath(fallbackId));
  const id = existing?.id ?? normalizeGrossMarginCategoryId(fallbackId);
  const category: GrossMarginCategory = {
    id,
    name: input.name.trim() || existing?.name || "未命名类目",
    description: input.description?.trim() || undefined,
    tiers: existing?.tiers || [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await writeJson(grossMarginCategoryJsonPath(id), normalizeGrossMarginCategory(category));
  return normalizeGrossMarginCategory(category);
}

export async function deleteGrossMarginCategories(categoryIds: string[]) {
  await ensureLibrary();
  const uniqueIds = [...new Set(categoryIds)].filter(Boolean).map(normalizeGrossMarginCategoryId);
  const deleted: string[] = [];

  for (const categoryId of uniqueIds) {
    const target = grossMarginCategoryJsonPath(categoryId);
    if (!(await exists(target))) continue;
    await fs.rm(target, { force: true });
    deleted.push(categoryId);
  }

  return { deleted };
}

export async function upsertGrossMarginTier(input: {
  categoryId: string;
  tierId?: string;
  name: string;
  originalPrice: number;
  maintenanceCost: number;
  note?: string;
}) {
  await ensureLibrary();
  const now = nowIso();
  const category = await resolveGrossMarginCategory(input.categoryId);
  const existingTier = input.tierId
    ? category.tiers.find((tier) => tier.id === normalizeGrossMarginTierId(input.tierId!))
    : undefined;
  if (input.tierId && !existingTier) {
    throw new Error(`找不到毛利档位：${input.tierId}`);
  }
  const id = existingTier?.id ?? safeSegment(`${input.name}-${shortHash(`${input.name}-${now}`)}`);
  const tier: GrossMarginTier = {
    id,
    name: input.name.trim() || existingTier?.name || "未命名档位",
    originalPrice: normalizeMoney(input.originalPrice),
    maintenanceCost: normalizeMoney(input.maintenanceCost),
    note: input.note?.trim() || undefined,
    createdAt: existingTier?.createdAt ?? now,
    updatedAt: now
  };
  const tiers = category.tiers.filter((item) => item.id !== id);
  const updated = normalizeGrossMarginCategory({
    ...category,
    tiers: [...tiers, tier],
    updatedAt: now
  });

  await writeJson(grossMarginCategoryJsonPath(category.id), updated);
  return { category: updated, tier };
}

export async function deleteGrossMarginTier(categoryId: string, tierId: string) {
  await ensureLibrary();
  const category = await resolveGrossMarginCategory(categoryId);
  const normalizedTierId = normalizeGrossMarginTierId(tierId);
  const tiers = category.tiers.filter((tier) => tier.id !== normalizedTierId);
  if (tiers.length === category.tiers.length) {
    throw new Error(`找不到毛利档位：${normalizedTierId}`);
  }

  const updated = normalizeGrossMarginCategory({
    ...category,
    tiers,
    updatedAt: nowIso()
  });
  await writeJson(grossMarginCategoryJsonPath(category.id), updated);
  return { category: updated, deleted: normalizedTierId };
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
}) {
  const account = await resolveAccount(input.platform, input.accountId);
  await ensureAccountDirs(account.platform, account.slug);
  const videoId = normalizeVideoId(input.videoId);

  const videoFile = path.join(videosPath(account.platform, account.slug), `${videoId}.json`);
  const video = await readJson<Video>(videoFile);
  if (!video) throw new Error("找不到视频元数据");

  const transcriptFile = path.join(transcriptsPath(account.platform, account.slug), `${videoId}.txt`);
  await fs.writeFile(transcriptFile, input.text.trim(), "utf8");

  const next: Video = {
    ...video,
    transcriptStatus: "completed",
    transcriptPath: transcriptFile,
    transcriptSource: input.source,
    raw: clearTranscriptError(video.raw),
    updatedAt: nowIso()
  };
  await writeJson(videoFile, next);

  return { account, video: next, transcript: input.text.trim() };
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
    transcriptStatus: "failed",
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
  } catch {
    return "";
  }
}

export async function deleteTranscript(platform: Platform, accountId: string, videoId: string) {
  const account = await resolveAccount(platform, accountId);
  const normalizedVideoId = normalizeVideoId(videoId);
  const transcriptFile = path.join(transcriptsPath(account.platform, account.slug), `${normalizedVideoId}.txt`);
  const videoFile = path.join(videosPath(account.platform, account.slug), `${normalizedVideoId}.json`);
  const video = await readJson<Video>(videoFile);
  if (!video) throw new Error("找不到视频元数据");

  await fs.rm(transcriptFile, { force: true });
  const next: Video = {
    ...video,
    transcriptStatus: "not_started",
    transcriptPath: undefined,
    transcriptSource: undefined,
    updatedAt: nowIso()
  };
  await writeJson(videoFile, next);

  return { account, video: next };
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
      fs.rm(path.join(transcriptsPath(account.platform, account.slug), `${normalizedVideoId}.txt`), { force: true })
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
  await fs.writeFile(stylePath(account.platform, account.slug), content.trimEnd() + "\n", "utf8");
  return content.trimEnd();
}

export async function saveProjectStyle(projectId: string, content: string) {
  const project = await resolveProject(projectId);
  await ensureProjectDirs(project.slug);
  await fs.writeFile(projectStylePath(project.slug), content.trimEnd() + "\n", "utf8");
  return content.trimEnd();
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
    await fs.writeFile(target, file.data);
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
  await fs.writeFile(target, input.bytes);

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

  const [videoFiles, draftFiles] = await Promise.all([
    fs.readdir(videosPath(account.platform, account.slug)).catch(() => []),
    fs.readdir(draftsPath(account.platform, account.slug)).catch(() => [])
  ]);

  const videos = (
    await Promise.all(
      videoFiles
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson<Video>(path.join(videosPath(account.platform, account.slug), file)))
    )
  ).filter(Boolean) as Video[];

  return {
    ...account,
    videoCount: videos.length,
    transcriptCount: videos.filter(videoHasTranscript).length,
    draftCount: draftFiles.filter((file) => file.endsWith(".json")).length
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
  const accounts: AccountListItem[] = [];

  for (const platform of platforms) {
    const entries = await fs.readdir(platformPath(platform), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const account = await readJson<Account>(accountJsonPath(platform, entry.name));
      if (!account) continue;
      accounts.push(await getAccountListItem(account));
    }
  }

  return accounts.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
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

export async function getLibraryOverview(): Promise<LibraryOverviewResponse> {
  await ensureLibrary();
  const [accounts, copySources, engagementRecords, accountDrafts, projectDrafts] = await Promise.all([
    getAllAccountListItems(),
    getCopySources(),
    getEngagementRecords(),
    getAllAccountDrafts(),
    getAllProjectDrafts()
  ]);
  const projects = await getAllProjectListItems(accounts);
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

async function removeCopySourcesFromProjects(sourceIds: string[]) {
  const deleted = new Set(sourceIds);
  const entries = await fs.readdir(projectsPath(), { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const project = await readJson<Project>(projectJsonPath(entry.name));
        if (!project?.sourceMaterialIds?.length) return;
        const sourceMaterialIds = project.sourceMaterialIds.filter((sourceId) => !deleted.has(sourceId));
        if (sourceMaterialIds.length === project.sourceMaterialIds.length) return;
        await writeJson(projectJsonPath(entry.name), {
          ...project,
          sourceMaterialIds,
          updatedAt: nowIso()
        });
      })
  );
}

async function resolveGrossMarginCategory(categoryId: string) {
  const id = normalizeGrossMarginCategoryId(categoryId);
  const category = await readJson<GrossMarginCategory>(grossMarginCategoryJsonPath(id));
  if (!category) {
    throw new Error(`找不到毛利类目：${id}`);
  }
  return normalizeGrossMarginCategory(category);
}

function normalizeGrossMarginCategory(category: GrossMarginCategory): GrossMarginCategory {
  return {
    ...category,
    description: category.description?.trim() || undefined,
    tiers: (category.tiers || [])
      .map((tier) => ({
        ...tier,
        originalPrice: normalizeMoney(tier.originalPrice),
        maintenanceCost: normalizeMoney(tier.maintenanceCost),
        note: tier.note?.trim() || undefined
      }))
      .sort((a, b) => {
        if (a.originalPrice !== b.originalPrice) return a.originalPrice - b.originalPrice;
        return +new Date(a.createdAt) - +new Date(b.createdAt);
      })
  };
}

function normalizeGrossMarginPriceTable(
  platform: GrossMarginPriceTable["platform"],
  table?: GrossMarginPriceTable | null
): GrossMarginPriceTable {
  const now = table?.updatedAt || nowIso();
  const defaults = getDefaultGrossMarginPriceOptions(platform, now);
  const byId = new Map(defaults.map((item) => [item.id, item]));

  for (const item of table?.items || []) {
    const service = grossMarginServices.includes(item.service) ? item.service : undefined;
    if (!service) continue;
    const id = safeSegment(item.id, shortHash(`${platform}-${service}-${item.name}`));
    if (isRetiredGrossMarginOption(platform, id)) continue;
    const defaultItem = byId.get(id);
    const legacyName = normalizeLegacyGrossMarginOptionName(platform, id, item.name);
    byId.set(id, {
      id,
      service,
      name: legacyName || formatGrossMarginServiceName(service),
      unitPrice: normalizeGrossMarginUnitPrice(item.unitPrice),
      quantityUnit: normalizeGrossMarginQuantityUnit(item.quantityUnit),
      minimumQuantity: normalizeGrossMarginMinimumQuantity(item.minimumQuantity) ?? defaultItem?.minimumQuantity,
      note: normalizeLegacyGrossMarginOptionNote(platform, id, item.note) || undefined,
      updatedAt: item.updatedAt || now
    });
  }

  return {
    platform,
    items: [...byId.values()].sort(compareGrossMarginPriceOptions),
    updatedAt: now
  };
}

function normalizeLegacyGrossMarginOptionName(
  platform: GrossMarginPriceTable["platform"],
  id: string,
  name?: string
) {
  const trimmed = name?.trim() || "";
  if (platform !== "douyin") return trimmed;
  if (id === "douyin-play-tech" && trimmed === "科技（5w起）") return "千川无视版（5w起）";
  if (id === "douyin-play-qianchuan-10w" && trimmed === "低质千川（10w起）") return "普通千川（10w起）";
  return trimmed;
}

function normalizeLegacyGrossMarginOptionNote(
  platform: GrossMarginPriceTable["platform"],
  id: string,
  note?: string
) {
  const trimmed = note?.trim() || "";
  if (platform !== "douyin") return trimmed;
  if (id === "douyin-play-tech" && trimmed === "5w 起播放，55 元 / 万") return "千川无视版，5w 起播放，55 元 / 万";
  if (id === "douyin-play-qianchuan-10w" && trimmed === "低质千川，10w 起播放，23 元 / 万") {
    return "普通千川，10w 起播放，23 元 / 万";
  }
  return trimmed;
}

function normalizeGrossMarginAccounts(accounts?: GrossMarginAccountPrice[] | null): GrossMarginAccountPrice[] {
  const normalized: GrossMarginAccountPrice[] = [];

  for (const account of accounts || []) {
      const platform = account.platform === "bilibili" ? "bilibili" : account.platform === "douyin" ? "douyin" : undefined;
      const name = account.name?.trim();
      if (!platform || !name) continue;
      normalized.push({
        platform,
        name,
        defaultPrice: normalizeMoney(account.defaultPrice),
        priceLabel: account.priceLabel?.trim() || (platform === "douyin" ? "20-60秒报价" : "定制报价"),
        secondaryPrice: account.secondaryPrice ? normalizeMoney(account.secondaryPrice) : undefined,
        secondaryPriceLabel: account.secondaryPriceLabel?.trim() || undefined,
        douyinId: account.douyinId?.trim() || undefined,
        cooperationCode: account.cooperationCode?.trim() || undefined,
        bilibiliUid: account.bilibiliUid?.trim() || undefined,
        homepage: account.homepage?.trim() || undefined
      });
  }

  return normalized.sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function normalizeGrossMarginMonitorRecord(record: GrossMarginMonitorRecord): GrossMarginMonitorRecord {
  const platform = record.platform === "bilibili" ? "bilibili" : "douyin";
  const targetStats = normalizeGrossMarginTargetStats(record.targetStats, platform);
  const currentStats = normalizeGrossMarginCurrentStats(record.currentStats);
  const previousStats = normalizeGrossMarginCurrentStats(record.previousStats);
  const playSamples = normalizeGrossMarginPlaySamples(record, currentStats);
  const metrics = buildGrossMarginMonitorMetrics(platform, targetStats, currentStats);
  const maxDifferencePercent = metrics.reduce((max, metric) => Math.max(max, metric.differencePercent), 0);
  const status = normalizeGrossMarginMonitorStatus(record.status);

  return {
    id: normalizeGrossMarginMonitorRecordId(record.id || `${platform}-${shortHash(record.videoUrl || record.videoKey || nowIso())}`),
    platform,
    accountName: record.accountName?.trim() || "",
    projectId: record.projectId?.trim() || undefined,
    projectName: record.projectName?.trim() || undefined,
    videoUrl: record.videoUrl?.trim() || "",
    videoKey: record.videoKey?.trim() || record.videoUrl?.trim() || "",
    title: record.title?.trim() || undefined,
    publishedAt: record.publishedAt?.trim() || undefined,
    sourceText: record.sourceText || "",
    targetStats,
    currentStats: Object.keys(currentStats).length ? currentStats : undefined,
    previousStats: Object.keys(previousStats).length ? previousStats : undefined,
    playSamples: playSamples.length ? playSamples : undefined,
    metrics,
    maxDifferencePercent,
    highRisk: metrics.some((metric) => metric.highRisk),
    status,
    warnings: uniqueStrings(record.warnings || []),
    lastRefreshedAt: record.lastRefreshedAt || undefined,
    createdAt: record.createdAt || nowIso(),
    updatedAt: record.updatedAt || record.createdAt || nowIso()
  };
}

function normalizeGrossMarginPlaySamples(
  record: GrossMarginMonitorRecord,
  currentStats: Partial<Record<GrossMarginServiceKind, number>>
) {
  const samples = normalizeGrossMarginPlaySampleList(record.playSamples);
  if (
    record.platform !== "bilibili" ||
    samples.length ||
    typeof currentStats.play !== "number" ||
    !record.lastRefreshedAt
  ) {
    return samples;
  }

  return normalizeGrossMarginPlaySampleList([
    {
      value: currentStats.play,
      capturedAt: record.lastRefreshedAt,
      source: "refresh"
    }
  ]);
}

function normalizeGrossMarginPlaySampleList(samples: GrossMarginMonitorPlaySample[] | undefined) {
  const byTimestamp = new Map<string, GrossMarginMonitorPlaySample>();

  for (const sample of samples || []) {
    const capturedAt = normalizeIsoTime(sample.capturedAt);
    if (!capturedAt) continue;
    byTimestamp.set(capturedAt, {
      value: normalizeGrossMarginMetricValue(sample.value),
      capturedAt,
      source: sample.source === "manual" ? "manual" : "refresh"
    });
  }

  return [...byTimestamp.values()]
    .sort((left, right) => +new Date(left.capturedAt) - +new Date(right.capturedAt))
    .slice(-maxGrossMarginPlaySamples);
}

export function appendGrossMarginPlaySample(
  samples: GrossMarginMonitorPlaySample[] | undefined,
  value: number | undefined,
  capturedAt: string,
  source: GrossMarginMonitorPlaySample["source"]
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return normalizeGrossMarginPlaySampleList(samples);
  }

  return normalizeGrossMarginPlaySampleList([
    ...(samples || []),
    {
      value,
      capturedAt,
      source
    }
  ]);
}

function normalizeIsoTime(value?: string) {
  if (!value) return "";
  const time = +new Date(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toISOString();
}

function buildGrossMarginMonitorProjects(records: GrossMarginMonitorRecord[]) {
  const projects = new Map<string, { id: string; name: string; count: number; updatedAt: string }>();

  for (const record of records) {
    const id = record.projectId?.trim();
    if (!id) continue;
    const current = projects.get(id);
    const updatedAt = record.updatedAt || record.createdAt || nowIso();
    if (!current) {
      projects.set(id, {
        id,
        name: record.projectName?.trim() || "未命名项目",
        count: 1,
        updatedAt
      });
      continue;
    }
    current.count += 1;
    if (+new Date(updatedAt) > +new Date(current.updatedAt)) current.updatedAt = updatedAt;
    if (record.projectName?.trim()) current.name = record.projectName.trim();
  }

  return [...projects.values()].sort((left, right) => +new Date(right.updatedAt) - +new Date(left.updatedAt));
}

function normalizeGrossMarginMonitorStatus(status?: GrossMarginMonitorStatus) {
  if (status === "completed" || status === "partial" || status === "failed" || status === "pending") return status;
  return "pending";
}

function normalizeGrossMarginTargetStats(
  stats: Partial<Record<GrossMarginServiceKind, number>> | undefined,
  platform: GrossMarginPriceTable["platform"]
) {
  const allowedServices =
    platform === "bilibili"
      ? (["play", "like", "coin", "favorite", "comment", "share", "danmaku", "blueLink"] as const)
      : (["play", "like", "comment", "favorite", "share"] as const);
  const normalized: Partial<Record<GrossMarginServiceKind, number>> = {};

  for (const service of allowedServices) {
    const value = normalizeGrossMarginMetricValue(stats?.[service]);
    if (value <= 0) continue;
    if (service === "blueLink" && value <= 0) continue;
    normalized[service] = value;
  }

  return normalized;
}

function normalizeGrossMarginCurrentStats(stats: Partial<Record<GrossMarginServiceKind, number>> | undefined) {
  const normalized: Partial<Record<GrossMarginServiceKind, number>> = {};
  for (const service of grossMarginServices) {
    if (!(service in (stats || {}))) continue;
    normalized[service] = normalizeGrossMarginMetricValue(stats?.[service]);
  }
  return normalized;
}

function normalizeGrossMarginMetricValue(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(Number(value)));
}

function buildGrossMarginMonitorMetrics(
  platform: GrossMarginPriceTable["platform"],
  targetStats: Partial<Record<GrossMarginServiceKind, number>>,
  currentStats?: Partial<Record<GrossMarginServiceKind, number>>
): GrossMarginMonitorMetric[] {
  const services =
    platform === "bilibili"
      ? (["play", "like", "coin", "favorite", "comment", "share", "danmaku", "blueLink"] as const)
      : (["play", "like", "comment", "favorite", "share"] as const);

  return services
    .map((service) => {
      const target = targetStats[service] || 0;
      if (target <= 0) return null;
      const hasCurrent = Boolean(currentStats && service in currentStats);
      const current = hasCurrent ? currentStats?.[service] || 0 : undefined;
      const difference = hasCurrent ? Math.max(0, target - (current ?? 0)) : 0;
      const differencePercent = hasCurrent && target > 0 ? difference / target : 0;
      return {
        service,
        label: formatGrossMarginMonitorServiceLabel(service, platform),
        target,
        current,
        difference,
        differencePercent,
        highRisk: hasCurrent && differencePercent >= 0.7,
        manualOnly: service === "blueLink" || (platform === "douyin" && service === "play")
      } satisfies GrossMarginMonitorMetric;
    })
    .filter(Boolean) as GrossMarginMonitorMetric[];
}

function formatGrossMarginMonitorServiceLabel(service: GrossMarginServiceKind, platform: GrossMarginPriceTable["platform"]) {
  if (service === "play") return "播放量";
  if (service === "like") return "点赞";
  if (service === "coin") return "投币";
  if (service === "favorite") return "收藏";
  if (service === "comment") return "评论";
  if (service === "share") return platform === "douyin" ? "转发" : "分享";
  if (service === "danmaku") return "弹幕";
  if (service === "blueLink") return "蓝链点击";
  return "抖加";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getDefaultGrossMarginPriceOptions(
  platform: GrossMarginPriceTable["platform"],
  now: string
): GrossMarginPriceOption[] {
  if (platform === "douyin") {
    return [
      {
        id: "douyin-play-tech",
        service: "play",
        name: "千川无视版（5w起）",
        unitPrice: 55,
        quantityUnit: "万",
        minimumQuantity: 5,
        note: "千川无视版，5w 起播放，55 元 / 万",
        updatedAt: now
      },
      {
        id: "douyin-play-qianchuan-10w",
        service: "play",
        name: "普通千川（10w起）",
        unitPrice: 23,
        quantityUnit: "万",
        minimumQuantity: 10,
        note: "普通千川，10w 起播放，23 元 / 万",
        updatedAt: now
      },
      {
        id: "douyin-play-qianchuan-high-10w",
        service: "play",
        name: "高质千川（10w起）",
        unitPrice: 55,
        quantityUnit: "万",
        minimumQuantity: 10,
        note: "高质千川，10w 起播放，55 元 / 万",
        updatedAt: now
      },
      {
        id: "douyin-like-tech",
        service: "like",
        name: "科技",
        unitPrice: 20,
        quantityUnit: "千",
        note: "20 / 千",
        updatedAt: now
      },
      {
        id: "douyin-like-qianchuan-1000",
        service: "like",
        name: "千川（1000起）",
        unitPrice: 110,
        quantityUnit: "千",
        minimumQuantity: 1,
        note: "110 / 千，1000 起安排",
        updatedAt: now
      },
      {
        id: "douyin-douplus-default",
        service: "douPlus",
        name: "默认",
        unitPrice: 1,
        quantityUnit: "元",
        note: "按实际投放金额计入成本",
        updatedAt: now
      },
      {
        id: "douyin-comment-custom",
        service: "comment",
        name: "自定义",
        unitPrice: 1,
        quantityUnit: "个",
        note: "1 / 个",
        updatedAt: now
      },
      {
        id: "douyin-share-standard",
        service: "share",
        name: "默认",
        unitPrice: 0.2,
        quantityUnit: "个",
        note: "0.2 / 个",
        updatedAt: now
      },
      {
        id: "douyin-favorite-standard",
        service: "favorite",
        name: "默认",
        unitPrice: 0.1,
        quantityUnit: "个",
        note: "0.1 / 个",
        updatedAt: now
      }
    ];
  }

  return [
    {
      id: "bilibili-play-default",
      service: "play",
      name: "正常通道（日速几千）",
      unitPrice: 60,
      quantityUnit: "万",
      note: "正常通道，日速几千，60 元 / 万",
      updatedAt: now
    },
    {
      id: "bilibili-play-fast",
      service: "play",
      name: "高速通道（日速2w）",
      unitPrice: 180,
      quantityUnit: "万",
      note: "高速通道，日速 2w，180 元 / 万",
      updatedAt: now
    },
    {
      id: "bilibili-like-default",
      service: "like",
      name: "默认",
      unitPrice: 30,
      quantityUnit: "千",
      note: "30 / 千",
      updatedAt: now
    },
    {
      id: "bilibili-coin-default",
      service: "coin",
      name: "默认",
      unitPrice: 0.2,
      quantityUnit: "个",
      note: "0.2 / 个",
      updatedAt: now
    },
    {
      id: "bilibili-comment-custom",
      service: "comment",
      name: "自定义",
      unitPrice: 0.7,
      quantityUnit: "个",
      note: "0.7 / 个",
      updatedAt: now
    },
    {
      id: "bilibili-share-standard",
      service: "share",
      name: "默认",
      unitPrice: 20,
      quantityUnit: "千",
      note: "20 / 千",
      updatedAt: now
    },
    {
      id: "bilibili-favorite-standard",
      service: "favorite",
      name: "默认",
      unitPrice: 20,
      quantityUnit: "千",
      note: "20 / 千",
      updatedAt: now
    },
    {
      id: "bilibili-danmaku-custom",
      service: "danmaku",
      name: "自定义",
      unitPrice: 0.15,
      quantityUnit: "个",
      note: "0.15 / 个",
      updatedAt: now
    },
    {
      id: "bilibili-blue-link-default",
      service: "blueLink",
      name: "默认",
      unitPrice: 0.8,
      quantityUnit: "个",
      note: "0.8 / 个",
      updatedAt: now
    }
  ];
}

function compareGrossMarginPriceOptions(a: GrossMarginPriceOption, b: GrossMarginPriceOption) {
  const serviceOrder = grossMarginServices.indexOf(a.service) - grossMarginServices.indexOf(b.service);
  if (serviceOrder !== 0) return serviceOrder;
  const optionOrder = grossMarginOptionRank(a.id) - grossMarginOptionRank(b.id);
  if (optionOrder !== 0) return optionOrder;
  return a.name.localeCompare(b.name, "zh-CN");
}

function grossMarginOptionRank(id: string) {
  if (id.includes("-play-tech")) return 10;
  if (id.includes("-play-qianchuan-10w")) return 20;
  if (id.includes("-play-qianchuan-high-10w")) return 30;
  if (id.includes("-play-qianchuan")) return 30;
  if (id.includes("-play-default")) return 40;
  if (id.includes("-play-fast")) return 50;
  if (id.includes("-like-tech")) return 10;
  if (id.includes("-like-qianchuan-1000")) return 20;
  if (id.includes("-like-default")) return 30;
  if (id.includes("-coin-default")) return 10;
  if (id.includes("-comment-custom")) return 10;
  if (id.includes("-danmaku-custom")) return 10;
  if (id.includes("-blue-link-default")) return 10;
  if (id.includes("-share-standard")) return 10;
  if (id.includes("-favorite-standard")) return 10;
  return 100;
}

function isRetiredGrossMarginOption(
  platform: GrossMarginPriceTable["platform"],
  id: string
) {
  if (platform !== "douyin") return false;
  return [
    "douyin-play-qianchuan-1-9w",
    "douyin-play-qianchuan-100w",
    "douyin-like-qianchuan-500",
    "douyin-comment-standard-boost",
    "douyin-comment-standard-quality"
  ].includes(id);
}

function normalizeGrossMarginPlatform(platform: string): GrossMarginPriceTable["platform"] {
  if (platform === "douyin" || platform === "bilibili") return platform;
  throw new Error("平台不支持");
}

function normalizeGrossMarginService(service: string): GrossMarginServiceKind {
  if (grossMarginServices.includes(service as GrossMarginServiceKind)) return service as GrossMarginServiceKind;
  throw new Error("维护项目不支持");
}

function formatGrossMarginServiceName(service: GrossMarginServiceKind) {
  if (service === "play") return "播放";
  if (service === "like") return "点赞";
  if (service === "douPlus") return "dou+";
  if (service === "coin") return "投币";
  if (service === "comment") return "评论";
  if (service === "share") return "转发量";
  if (service === "favorite") return "收藏量";
  if (service === "danmaku") return "自定义弹幕";
  return "蓝链点击";
}

function normalizeMoney(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function normalizeGrossMarginUnitPrice(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function normalizeGrossMarginQuantityUnit(value: string | undefined) {
  return value?.trim() || "个";
}

function normalizeGrossMarginMinimumQuantity(value: number | undefined) {
  if (!Number.isFinite(value)) return undefined;
  const safeValue = Number(value);
  if (safeValue <= 0) return undefined;
  return Number(safeValue.toFixed(6));
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

export async function getTopTranscriptSamples(platform: Platform, accountId: string, maxSamples = 8) {
  const account = await resolveAccount(platform, accountId);
  const summary = await getAccountSummary(account);
  const completed = summary.videos.filter(videoHasTranscript).slice(0, maxSamples);

  const samples = await Promise.all(
    completed.map(async (video) => ({
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
