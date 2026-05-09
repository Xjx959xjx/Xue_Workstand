import { promises as fs } from "fs";
import path from "path";
import {
  Account,
  AccountDraft,
  AccountSummary,
  Draft,
  DraftInput,
  LibraryState,
  Platform,
  Project,
  ProjectDraft,
  ProjectSummary,
  Video,
  platforms
} from "./types";
import { nowIso, safeSegment, shortHash } from "./utils";

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

function stylePath(platform: Platform, slug: string) {
  return path.join(accountPath(platform, slug), "style.md");
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
    fs.mkdir(projectsPath(), { recursive: true })
  ]);
}

export async function resolveAccount(platform: Platform, accountIdOrSlug: string) {
  await ensureLibrary();
  const slug = accountIdOrSlug.includes(":") ? accountIdOrSlug.split(":").at(-1)! : accountIdOrSlug;
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
    const target = accountPath(platform, safeSegment(slug));
    if (!(await exists(target))) continue;
    await fs.rm(target, { recursive: true, force: true });
    deleted.push(`${platform}:${slug}`);
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
  projectId?: string;
}) {
  await ensureLibrary();

  const existing = input.projectId ? await resolveProject(input.projectId).catch(() => null) : null;
  const now = nowIso();
  const slug = existing?.slug ?? safeSegment(input.name, shortHash(input.name));
  await ensureProjectDirs(slug);

  const project: Project = {
    id: `project:${slug}`,
    slug,
    name: input.name || existing?.name || "未命名项目",
    description: input.description ?? existing?.description,
    sourceAccountIds: input.sourceAccountIds ?? existing?.sourceAccountIds ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await writeJson(projectJsonPath(slug), project);
  return project;
}

export async function deleteProjects(projectIds: string[]) {
  await ensureLibrary();
  const uniqueIds = [...new Set(projectIds)].filter(Boolean);
  const deleted: string[] = [];

  for (const projectId of uniqueIds) {
    const slug = projectId.includes(":") ? projectId.split(":").at(-1)! : projectId;
    if (!slug) continue;
    const target = projectPath(safeSegment(slug));
    if (!(await exists(target))) continue;
    await fs.rm(target, { recursive: true, force: true });
    deleted.push(`project:${slug}`);
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

    const next: Video = {
      ...existing,
      ...video,
      id,
      accountId: account.id,
      platform: account.platform,
      hotScore: calculateHotScore(video),
      relativeViewRate:
        video.stats.views > 0 && averageViews > 0 ? Number((video.stats.views / averageViews).toFixed(2)) : 0,
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

export async function saveVideo(account: Account, video: Video) {
  await ensureAccountDirs(account.platform, account.slug);
  const target = path.join(videosPath(account.platform, account.slug), `${video.id}.json`);
  const next = {
    ...video,
    hotScore: calculateHotScore(video),
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

  const videoFile = path.join(videosPath(account.platform, account.slug), `${input.videoId}.json`);
  const video = await readJson<Video>(videoFile);
  if (!video) throw new Error("找不到视频元数据");

  const transcriptFile = path.join(transcriptsPath(account.platform, account.slug), `${input.videoId}.txt`);
  await fs.writeFile(transcriptFile, input.text.trim(), "utf8");

  const next: Video = {
    ...video,
    transcriptStatus: "completed",
    transcriptPath: transcriptFile,
    transcriptSource: input.source,
    updatedAt: nowIso()
  };
  await writeJson(videoFile, next);

  return { account, video: next, transcript: input.text.trim() };
}

export async function markTranscriptFailed(platform: Platform, accountId: string, videoId: string, reason: string) {
  const account = await resolveAccount(platform, accountId);
  const videoFile = path.join(videosPath(account.platform, account.slug), `${videoId}.json`);
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
  const target = path.join(transcriptsPath(account.platform, account.slug), `${videoId}.txt`);
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return "";
  }
}

export async function deleteTranscript(platform: Platform, accountId: string, videoId: string) {
  const account = await resolveAccount(platform, accountId);
  const transcriptFile = path.join(transcriptsPath(account.platform, account.slug), `${videoId}.txt`);
  const videoFile = path.join(videosPath(account.platform, account.slug), `${videoId}.json`);
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
    const videoFile = path.join(videosPath(account.platform, account.slug), `${videoId}.json`);
    if (!(await exists(videoFile))) continue;

    await Promise.all([
      fs.rm(videoFile, { force: true }),
      fs.rm(path.join(transcriptsPath(account.platform, account.slug), `${videoId}.txt`), { force: true })
    ]);
    deleted.push(videoId);
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

  if (input.targetType === "project") {
    const project = await resolveProject(input.projectId);
    await ensureProjectDirs(project.slug);

    const draft: ProjectDraft = {
      ...input,
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
    id,
    createdAt: now,
    updatedAt: now
  };

  await writeJson(path.join(draftsPath(account.platform, account.slug), `${draft.id}.json`), draft);
  return draft;
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
  const slug = projectIdOrSlug.includes(":") ? projectIdOrSlug.split(":").at(-1)! : projectIdOrSlug;
  const project = await readJson<Project>(projectJsonPath(slug));
  if (!project) {
    throw new Error(`找不到项目：${slug}`);
  }
  return project;
}

export async function getProjectSummary(project: Project): Promise<ProjectSummary> {
  await ensureProjectDirs(project.slug);
  const [style, libraryAccounts] = await Promise.all([
    fs.readFile(projectStylePath(project.slug), "utf8").catch(() => DEFAULT_STYLE),
    getAllAccountSummaries()
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
    style,
    sourceAccounts
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
  const [accounts, projects] = await Promise.all([getAllAccountSummaries(), getAllProjectSummaries()]);

  const projectDrafts = await getAllProjectDrafts();
  const drafts = [...accounts.flatMap((account) => account.drafts), ...projectDrafts];
  const recentAccounts = [...accounts].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4);
  const recentProjects = [...projects].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4);
  const recentDrafts = [...drafts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 8);

  return {
    root: libraryRoot(),
    accounts,
    projects,
    drafts,
    recentAccounts,
    recentProjects,
    recentDrafts
  };
}

export async function getVideo(platform: Platform, accountId: string, videoId: string) {
  const account = await resolveAccount(platform, accountId);
  const video = await readJson<Video>(path.join(videosPath(account.platform, account.slug), `${videoId}.json`));
  if (!video) throw new Error("找不到视频");
  return { account, video };
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
