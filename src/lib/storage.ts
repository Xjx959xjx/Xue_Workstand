import { promises as fs } from "fs";
import path from "path";
import {
  Account,
  AccountDraft,
  AccountSummary,
  CopySource,
  Draft,
  DraftAssets,
  DraftCoverImage,
  DraftCoverReference,
  DraftInput,
  LibraryState,
  Platform,
  Project,
  ProjectDraft,
  ProjectSummary,
  Video,
  platforms
} from "./types";
import { makeDraftTitleFromContent, nowIso, safeSegment, shortHash } from "./utils";

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

function videoHasTranscript(video: Pick<Video, "transcriptStatus" | "transcriptPath">) {
  return video.transcriptStatus === "completed" || Boolean(video.transcriptPath);
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

function normalizeCopySourceId(sourceId: string) {
  return normalizeStorageSegment(sourceId, "文案素材 ID");
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
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(target: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`[storage] JSON 解析失败：${target}`, error);
    }
    return null;
  }
}

async function writeJson(target: string, value: unknown) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, target);
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
    fs.mkdir(copySourcesPath(), { recursive: true })
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
    projectIds: [],
    createdAt: now,
    updatedAt: now
  };

  await writeJson(copySourceJsonPath(id), source);
  return source;
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
    getAllAccountSummaries(),
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

export async function getLibrary(): Promise<LibraryState> {
  await ensureLibrary();
  const [accounts, projects, copySources] = await Promise.all([
    getAllAccountSummaries(),
    getAllProjectSummaries(),
    getCopySources()
  ]);

  const projectDrafts = await getAllProjectDrafts();
  const drafts = [...accounts.flatMap((account) => account.drafts), ...projectDrafts];
  const recentAccounts = [...accounts].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4);
  const recentProjects = [...projects].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4);
  const recentCopySources = [...copySources].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 8);
  const recentDrafts = [...drafts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 8);

  return {
    root: libraryRoot(),
    accounts,
    projects,
    copySources,
    drafts,
    recentAccounts,
    recentProjects,
    recentCopySources,
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

function normalizeCopySource(source: CopySource): CopySource {
  return {
    ...source,
    transcript: source.transcript || "",
    transcriptPath: source.transcriptPath || copySourceTranscriptPath(source.id),
    status: source.status || "completed",
    source: source.source || "manual",
    projectIds: source.projectIds || []
  };
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
