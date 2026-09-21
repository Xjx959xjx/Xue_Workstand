import { assistImagePrompt } from "./image-prompt-assist";
import { generateImages } from "./image-generation";
import { randomUUID } from "crypto";
import path from "path";
import {
  buildSavedProjectStyleResult,
  completeCachedAccountStyle,
  completeCachedProjectStyle,
  completePreparedAccountStyle,
  completePreparedProjectStyle,
  completePreparedWriteCopy,
  completePreparedWriteVariant,
  prepareAccountStyleContext,
  prepareSavedProjectStyleContext,
  prepareWriteCopyBatchContext,
  prepareWriteCopyContext,
  resolveWriteBatchOutcome,
  streamStyleResponseTextWithFallback,
  streamResponseTextWithFallback,
  writeVariantFailure,
  WRITE_COPY_REASONING_EFFORT
} from "./ai";
import { runBatchTranscribe } from "./batch-transcribe";
import { collectAccountContent } from "./account-collection";
import { assertJobKindAllowedForAppMode, isJobKindAllowedForAppMode } from "./app-mode";
import { buildWriterDraftHref } from "./draft-links";
import { generateEngagement } from "./engagement";
import { refreshDouyinHotlist } from "./douyin-hotlist";
import { refreshGrossMarginMonitorRecords } from "./gross-margin-refresh";
import { getHotspotRadar } from "./hotspots";
import { hasSupportDocumentReference } from "./support-documents";
import { extractRewriteSourceMaterial, splitWriterSourceInput } from "./source-extraction";
import { engagementSourceKey, writeCopySourceKey } from "./job-scope";
import { buildEngagementRecordHref } from "./job-links";
import { compactJobForPersistence, DEFAULT_JOB_RESULT_PERSIST_BYTES, isResumableJobKind } from "./job-persistence";
import { libraryRoot } from "./storage";
import { generatePublishCopy } from "./publish-copy";
import { isCloudStorageMode, readJsonFile, storageFs as fs, writeJsonFile } from "./storage/fs";
import {
  claimCloudJob,
  deleteCloudJob,
  getCloudJobEventBounds,
  listCloudJobEvents,
  listCloudJobs,
  readCloudJob,
  writeCloudJob
} from "./jobs-cloud";
import { transcribeLinkSource, transcribeVideo } from "./transcription";
import {
  BatchTranscribeResult,
  EngagementRecord,
  JobEvent,
  JobKind,
  JobListItem,
  JobRecord,
  JobScope,
  JobStartInput,
  WriteBatchResult,
  WriteGenerationResult,
  jobKinds
} from "./types";
import { nowIso, safeSegment, shortHash } from "./utils";
import { logJobTransition } from "./observability";

type JobRuntime = {
  initialized: boolean;
  initializing?: Promise<void>;
  active: Map<string, Promise<void>>;
  abortControllers: Map<string, AbortController>;
  cancelRequests: Set<string>;
  pending: Map<string, JobStartInput>;
  records: Map<string, JobRecord>;
  changeEpoch: string;
  changeRevision: number;
  changeLog: Array<{ revision: number; jobId: string; removed?: boolean }>;
};

type PatchJobOptions = {
  persist?: boolean;
  beforePatch?: (current: JobRecord) => void;
};

type JobSummaryRead = JobListItem & {
  filePath: string;
};

type JobSummaryCache = {
  fileCount: number;
  mtimeMs: number;
  jobs: JobSummaryRead[];
};

const globalJobs = globalThis as typeof globalThis & {
  __styleWorkbenchJobs?: JobRuntime;
};

const runtime = (() => {
  const existing = globalJobs.__styleWorkbenchJobs;
  if (existing) {
    existing.active ||= new Map();
    existing.abortControllers ||= new Map();
    existing.cancelRequests ||= new Set();
    existing.pending ||= new Map();
    existing.records ||= new Map();
    existing.changeEpoch ||= "";
    existing.changeRevision ||= 0;
    existing.changeLog ||= [];
    return existing;
  }

  const created: JobRuntime = {
    initialized: false,
    active: new Map(),
    abortControllers: new Map(),
    cancelRequests: new Set(),
    pending: new Map(),
    records: new Map(),
    changeEpoch: "",
    changeRevision: 0,
    changeLog: []
  };
  globalJobs.__styleWorkbenchJobs = created;
  return created;
})();

const jobWriteQueues = new Map<string, Promise<unknown>>();
let jobSummaryCache: JobSummaryCache | null = null;
const PARTIAL_TEXT_PATCH_INTERVAL_MS = 250;
const PARTIAL_TEXT_PATCH_CHARS = 160;
const JOB_SUMMARY_EVENT_LIMIT = 3;
const JOB_SUMMARY_LIMIT = 80;
const JOB_CHANGE_LOG_LIMIT = 1200;
const DEFAULT_MAX_ACTIVE_JOBS = 2;
const DEFAULT_JOB_HISTORY_LIMIT = 200;
const DEFAULT_JOB_HISTORY_MAX_BYTES = 20 * 1024 * 1024;
const jobKindSet = new Set<JobKind>(jobKinds);
const jobStatusSet = new Set<JobRecord["status"]>([
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled"
]);

function jobsPath() {
  return path.join(libraryRoot(), "jobs");
}

function jobJsonPath(jobId: string) {
  return path.join(jobsPath(), `${normalizeJobId(jobId)}.json`);
}

function jobPayloadsPath() {
  return path.join(jobsPath(), ".payloads");
}

function jobPayloadPath(jobId: string) {
  return path.join(jobPayloadsPath(), `${normalizeJobId(jobId)}.json`);
}

function normalizeJobId(jobId: string) {
  return safeSegment(jobId.trim());
}

async function ensureJobs() {
  await Promise.all([
    fs.mkdir(jobsPath(), { recursive: true }),
    fs.mkdir(jobPayloadsPath(), { recursive: true })
  ]);
}

async function readJson<T>(target: string): Promise<T | null> {
  return readJsonFile<T>(target);
}

async function writeJson(target: string, value: unknown) {
  return writeJsonFile(target, value);
}

async function writeJob(job: JobRecord, options: PatchJobOptions = {}) {
  runtime.records.set(job.id, job);
  recordJobChange(job.id);
  if (options.persist === false) return;
  const persisted = compactJobForPersistence(job, jobResultPersistBytes());
  if (isCloudStorageMode()) await writeCloudJob(persisted);
  else await writeJson(jobJsonPath(job.id), persisted);
  invalidateJobSummaryCache();
}

async function patchJob(jobId: string, patch: Partial<JobRecord>, options: PatchJobOptions = {}) {
  return enqueueJobWrite(jobId, async () => {
    const current = runtime.records.get(jobId) || (await readJson<JobRecord>(jobJsonPath(jobId)));
    if (!current) throw new Error("找不到任务记录");
    if (isTerminalJob(current)) return current;
    options.beforePatch?.(current);
    const next: JobRecord = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    if (shouldRecordJobEvent(current, next, patch)) {
      next.events = appendJobEvent(current.events, {
        at: next.updatedAt,
        status: next.status,
        stage: next.stage,
        message: next.message,
        progress: next.progress
      });
    }
    await writeJob(next, options);
    if (shouldRecordJobEvent(current, next, patch)) {
      logJobTransition(current, next);
    }
    return next;
  });
}

function patchTransientJob(jobId: string, patch: Partial<JobRecord>) {
  return patchJob(jobId, patch, { persist: false });
}

function patchJobWithDataChange(
  jobId: string,
  patch: Partial<JobRecord>,
  dataChange: Omit<NonNullable<JobRecord["dataChange"]>, "at">
) {
  return patchJob(jobId, patch, {
    beforePatch(current) {
      patch.dataRevision = (current.dataRevision || 0) + 1;
      patch.dataChange = { ...dataChange, at: nowIso() };
    }
  });
}

async function enqueueJobWrite<T>(jobId: string, run: () => Promise<T>) {
  const previous = jobWriteQueues.get(jobId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => current, () => current);
  jobWriteQueues.set(jobId, next);

  try {
    await previous.catch(() => undefined);
    return await run();
  } finally {
    release();
    if (jobWriteQueues.get(jobId) === next) {
      jobWriteQueues.delete(jobId);
    }
  }
}

async function ensureInitialized() {
  if (runtime.initialized) return;
  if (runtime.initializing) return runtime.initializing;

  runtime.initializing = initializeRuntimeJobs().finally(() => {
    runtime.initializing = undefined;
  });
  return runtime.initializing;
}

async function initializeRuntimeJobs() {
  runtime.changeEpoch ||= randomUUID();
  await ensureJobs();
  const resumable = await recoverStaleDiskJobs(await listJobSummariesFromDisk());
  runtime.initialized = true;
  for (const item of resumable) queueBackgroundJob(item.jobId, item.input);
}

async function listJobsFromDisk() {
  if (isCloudStorageMode()) {
    return (await listCloudJobs())
      .filter((job) => isJobKindAllowedForAppMode(job.kind))
      .sort(compareJobsByUpdatedAtDesc);
  }
  await ensureJobs();
  const files = await fs.readdir(jobsPath()).catch(() => [] as string[]);
  const jobs = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJson<JobRecord>(path.join(jobsPath(), file)))
  );
  return jobs
    .filter((job): job is JobRecord => Boolean(job))
    .filter((job) => isJobKindAllowedForAppMode(job.kind))
    .sort(compareJobsByUpdatedAtDesc);
}

async function listJobSummariesFromDisk() {
  if (isCloudStorageMode()) {
    return (await listCloudJobs())
      .filter((job) => isJobKindAllowedForAppMode(job.kind))
      .sort(compareJobsByUpdatedAtDesc)
      .map((job) => ({ ...toJobListItem(job), filePath: "" }));
  }
  await ensureJobs();
  const files = await fs.readdir(jobsPath()).catch(() => [] as string[]);
  const stats = await fs.stat(jobsPath());
  const jsonFileCount = files.filter((file) => file.endsWith(".json")).length;

  if (
    jobSummaryCache &&
    jobSummaryCache.fileCount === jsonFileCount &&
    jobSummaryCache.mtimeMs === stats.mtimeMs
  ) {
    return jobSummaryCache.jobs;
  }

  const summaries = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJobSummary(path.join(jobsPath(), file)))
  );
  const jobs = summaries
    .filter((job): job is JobSummaryRead => Boolean(job))
    .filter((job) => isJobKindAllowedForAppMode(job.kind))
    .sort(compareJobsByUpdatedAtDesc);

  jobSummaryCache = {
    fileCount: jsonFileCount,
    mtimeMs: stats.mtimeMs,
    jobs
  };
  return jobs;
}

async function readJobSummary(target: string): Promise<JobSummaryRead | null> {
  let raw: string;
  try {
    raw = await fs.readFile(target, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw new Error(`读取 JSON 文件失败：${target}。${describeFsError(error)}`);
  }

  return parseJobSummaryJson(target, raw);
}

async function recoverStaleDiskJobs(jobs: JobSummaryRead[]) {
  const staleJobs = jobs.filter((job) => (job.status === "running" || job.status === "queued") && !runtime.active.has(job.id));
  if (!staleJobs.length) return [];

  const interruptedAt = nowIso();
  const resumable: Array<{ jobId: string; input: JobStartInput }> = [];
  await Promise.all(
    staleJobs.map(async (summary) => {
      const job = isCloudStorageMode()
        ? await readCloudJob(summary.id)
        : await readJson<JobRecord>(summary.filePath);
      if (!job || isTerminalJob(job) || runtime.active.has(job.id)) return;
      const input = await readJobPayload(job.id);
      if (input && input.kind === job.kind && isResumableJobKind(job.kind)) {
        await writeJob({
          ...job,
          status: "queued",
          stage: "queued",
          message: "服务重启后已恢复到队列",
          error: undefined,
          completedAt: undefined,
          resumedAt: interruptedAt,
          updatedAt: interruptedAt
        });
        resumable.push({ jobId: job.id, input });
        return;
      }
      await writeJob({
        ...job,
        status: "interrupted",
        progress: job.progress || 0,
        message: input ? "服务重启后任务已中断，可从任务中心重试。" : "服务重启后任务已中断，且缺少恢复参数。",
        error: input ? "任务已中断，可重试。" : "任务恢复参数缺失，请重新发起。",
        updatedAt: interruptedAt,
        completedAt: interruptedAt
      });
    })
  );
  return resumable;
}

function stripSummaryFilePath({ filePath, ...job }: JobSummaryRead): JobListItem {
  void filePath;
  return job;
}

export async function listJobs() {
  await ensureInitialized();
  const jobs = new Map((await listJobsFromDisk()).map((job) => [job.id, job]));
  for (const job of runtime.records.values()) {
    if (isJobKindAllowedForAppMode(job.kind)) jobs.set(job.id, job);
  }
  return [...jobs.values()].sort(compareJobsByUpdatedAtDesc);
}

export function isJobExecuting(jobId: string) {
  return runtime.abortControllers.has(jobId) || runtime.pending.has(jobId);
}

export async function listJobSummaries(options: { all?: boolean } = {}) {
  await ensureInitialized();
  const summaries = new Map(
    (await listJobSummariesFromDisk()).map((job) => [job.id, stripSummaryFilePath(job)])
  );
  for (const job of runtime.records.values()) {
    if (isJobKindAllowedForAppMode(job.kind)) summaries.set(job.id, toJobListItem(job));
  }
  const sorted = [...summaries.values()].sort(compareJobsByUpdatedAtDesc);
  return options.all ? sorted : sorted.slice(0, JOB_SUMMARY_LIMIT);
}

export async function listJobSummaryChanges(cursor?: string) {
  await ensureInitialized();
  if (isCloudStorageMode()) {
    const bounds = await getCloudJobEventBounds();
    const currentCursor = `d1.${bounds.lastId}`;
    const parsedId = cursor?.match(/^d1\.(\d+)$/)?.[1];
    const afterId = parsedId === undefined ? null : Number(parsedId);
    const invalidCursor = afterId === null || !Number.isSafeInteger(afterId) || afterId < 0 || afterId > bounds.lastId;
    const expiredCursor = afterId !== null && bounds.firstId !== null && afterId < bounds.firstId - 1;
    if (invalidCursor || expiredCursor) {
      return { jobs: await listJobSummaries(), removedJobIds: [], cursor: currentCursor, reset: true };
    }

    const events = await listCloudJobEvents(afterId);
    if (events.length > 1200) {
      return { jobs: await listJobSummaries(), removedJobIds: [], cursor: currentCursor, reset: true };
    }
    if (!events.length) return { jobs: [], removedJobIds: [], cursor: currentCursor, reset: false };

    const latestById = new Map<string, { kind: string; id: number }>();
    for (const event of events) latestById.set(event.job_id, { kind: event.kind, id: event.id });
    const jobs = await Promise.all(
      [...latestById.entries()].map(async ([jobId, event]) => {
        if (event.kind === "removed") return null;
        const job = await readCloudJob(jobId);
        return job && isJobKindAllowedForAppMode(job.kind) ? toJobListItem(job) : null;
      })
    );
    const removedJobIds = [...latestById.entries()]
      .filter(([, event]) => event.kind === "removed")
      .map(([jobId]) => jobId);
    return {
      jobs: jobs.filter((job): job is JobListItem => Boolean(job)),
      removedJobIds,
      cursor: currentCursor,
      reset: false
    };
  }
  const currentCursor = jobChangeCursor();
  const parsed = parseJobChangeCursor(cursor);
  const firstRevision = runtime.changeLog[0]?.revision ?? runtime.changeRevision + 1;
  const reset = !parsed
    || parsed.epoch !== runtime.changeEpoch
    || parsed.revision > runtime.changeRevision
    || parsed.revision < firstRevision - 1;

  if (reset) {
    return {
      jobs: await listJobSummaries(),
      removedJobIds: [],
      cursor: currentCursor,
      reset: true
    };
  }

  const changes = runtime.changeLog.filter((change) => change.revision > parsed.revision);
  if (!changes.length) {
    return { jobs: [], removedJobIds: [], cursor: currentCursor, reset: false };
  }
  const latestById = new Map<string, { revision: number; removed?: boolean }>();
  for (const change of changes) latestById.set(change.jobId, change);
  const current = new Map((await listJobSummaries()).map((job) => [job.id, job]));
  return {
    jobs: [...latestById.entries()]
      .filter(([, change]) => !change.removed)
      .map(([jobId]) => current.get(jobId))
      .filter((job): job is JobListItem => Boolean(job)),
    removedJobIds: [...latestById.entries()]
      .filter(([jobId, change]) => change.removed || !current.has(jobId))
      .map(([jobId]) => jobId),
    cursor: currentCursor,
    reset: false
  };
}

export async function getJob(jobId: string) {
  await ensureInitialized();
  const cached = runtime.records.get(jobId);
  if (cached) {
    assertJobKindAllowedForAppMode(cached.kind);
    return cached;
  }

  const job = isCloudStorageMode()
    ? await readCloudJob(jobId)
    : await readJson<JobRecord>(jobJsonPath(jobId));
  if (!job) throw new Error("找不到任务记录");
  assertJobKindAllowedForAppMode(job.kind);
  runtime.records.set(job.id, job);
  return job;
}

export async function createJob(input: JobStartInput) {
  assertJobKindAllowedForAppMode(input.kind);
  await ensureInitialized();
  const now = nowIso();
  const job: JobRecord = {
    id: makeJobId(input.kind),
    kind: input.kind,
    status: "queued",
    title: input.title || defaultJobTitle(input),
    inputSummary: input.inputSummary || defaultInputSummary(input),
    scope: defaultJobScope(input),
    stage: "queued",
    message: "任务已加入队列",
    progress: 0,
    href: input.href || defaultHref(input),
    events: [
      {
        at: now,
        status: "queued",
        stage: "queued",
        message: "任务已加入队列",
        progress: 0
      }
    ],
    createdAt: now,
    updatedAt: now
  };

  await writeJobPayload(job.id, input);
  try {
    await writeJob(job);
  } catch (error) {
    await removeJobPayload(job.id);
    throw error;
  }
  queueBackgroundJob(job.id, input);
  return job;
}

function queueBackgroundJob(jobId: string, input: JobStartInput) {
  if (runtime.active.has(jobId) || runtime.pending.has(jobId)) return;
  runtime.pending.set(jobId, input);
  if (isCloudStorageMode()) {
    void scheduleCloudJob(jobId, input);
    return;
  }
  pumpJobQueue();
}

async function scheduleCloudJob(jobId: string, input: JobStartInput) {
  try {
    const workersModule = "cloudflare:" + "workers";
    const { waitUntil } = await import(workersModule) as unknown as {
      waitUntil(promise: Promise<unknown>): void;
    };
    waitUntil(runCloudJobAndRelease(jobId, input));
  } catch (error) {
    runtime.pending.delete(jobId);
    await patchJob(jobId, {
      status: "failed",
      stage: "error",
      message: "云端任务调度失败",
      error: error instanceof Error ? error.message : "无法注册 Worker 后台任务"
    }).catch(() => undefined);
  }
}

async function runCloudJobAndRelease(jobId: string, input: JobStartInput) {
  runtime.pending.delete(jobId);
  const claimed = await claimCloudJob(jobId, `${jobId}:${Date.now()}`);
  if (!claimed) return;
  const promise = runJob(jobId, input);
  runtime.active.set(jobId, promise);
  try {
    await promise;
  } finally {
    runtime.active.delete(jobId);
  }
}

function pumpJobQueue() {
  while (runtime.active.size < maxActiveJobs()) {
    const next = runtime.pending.entries().next();
    if (next.done) return;

    const [jobId, input] = next.value;
    runtime.pending.delete(jobId);
    if (runtime.cancelRequests.has(jobId)) continue;

    const promise = runJob(jobId, input).finally(() => {
      runtime.active.delete(jobId);
      pumpJobQueue();
    });
    runtime.active.set(jobId, promise);
  }
}

async function runJob(jobId: string, input: JobStartInput) {
  const controller = new AbortController();
  runtime.abortControllers.set(jobId, controller);
  try {
    throwIfCancelled(jobId);
    const current = await getJob(jobId);
    await patchJob(jobId, {
      status: "running",
      stage: "start",
      message: "任务正在运行",
      progress: 3,
      attempt: (current.attempt || 0) + 1
    });

    if (input.kind === "image-prompt-assist") {
      await patchJob(jobId, { message: "正在优化图片提示词", progress: 20 });
      const result = await assistImagePrompt(input.input, getJobAbortSignal(jobId));
      throwIfCancelled(jobId);
      await completeJob(jobId, { message: "提示词建议已生成", result, resultRef: { id: jobId, href: `/images?assistId=${encodeURIComponent(jobId)}`, label: "查看建议" } });
    } else if (input.kind === "image-generation") {
      await runImageGenerationJob(jobId, input);
    } else if (input.kind === "write-copy") {
      await runWriteCopyJob(jobId, input);
    } else if (input.kind === "account-style") {
      await runAccountStyleJob(jobId, input);
    } else if (input.kind === "project-style") {
      await runProjectStyleJob(jobId, input);
    } else if (input.kind === "transcribe-video") {
      await runTranscribeVideoJob(jobId, input);
    } else if (input.kind === "batch-transcribe") {
      await runBatchTranscribeJob(jobId, input);
    } else if (input.kind === "hotlist-refresh") {
      await runHotlistRefreshJob(jobId, input);
    } else if (input.kind === "collect-account") {
      await runCollectAccountJob(jobId, input);
    } else if (input.kind === "single-video-transcribe") {
      await runSingleVideoTranscribeJob(jobId, input);
    } else if (input.kind === "publish-copy") {
      await runPublishCopyJob(jobId, input);
    } else if (input.kind === "hotspot-refresh") {
      await runHotspotRefreshJob(jobId, input);
    } else if (input.kind === "gross-margin-refresh") {
      await runGrossMarginRefreshJob(jobId, input);
    } else {
      await runEngagementJob(jobId, input);
    }
  } catch (error) {
    if (isCancelledJobError(error, controller.signal)) {
      const current = runtime.records.get(jobId) || (isCloudStorageMode()
        ? await readCloudJob(jobId)
        : await readJson<JobRecord>(jobJsonPath(jobId)));
      await patchJob(jobId, {
        status: "cancelled",
        stage: "cancelled",
        message: current?.message || "任务已停止",
        error: undefined,
        progress: current?.progress || 0,
        completedAt: nowIso()
      });
      return;
    }
    await patchJob(jobId, {
      status: "failed",
      progress: 100,
      stage: "failed",
      message: "任务失败",
      error: error instanceof Error ? error.message : "任务失败，请稍后重试。",
      completedAt: nowIso()
    });
    await pruneJobHistory();
  } finally {
    runtime.abortControllers.delete(jobId);
    runtime.cancelRequests.delete(jobId);
  }
}

async function runImageGenerationJob(jobId: string, start: Extract<JobStartInput, { kind: "image-generation" }>) {
  const href = `/images?recordId=${encodeURIComponent(jobId)}`;
  await patchJob(jobId, { href, resultRef: { id: jobId, href, label: "查看图片" } });
  const result = await generateImages(jobId, start.input, {
    signal: getJobAbortSignal(jobId),
    onProgress: async (message, progress, saved) => {
      const patch = { message, progress, stage: saved ? "save" : "generate" };
      if (saved) await patchJobWithDataChange(jobId, patch, { resource: "image-generation", recordId: jobId });
      else await patchJob(jobId, patch);
    }
  });
  throwIfCancelled(jobId);
  await completeJob(jobId, { message: `已生成 ${result.images.length} 张图片`, result: { recordId: result.id }, resultRef: { id: jobId, href, label: "查看图片" } });
}

async function runWriteCopyJob(jobId: string, start: Extract<JobStartInput, { kind: "write-copy" }>) {
  throwIfCancelled(jobId);
  const isRevision = start.input.action === "revise";
  const separatedSourceInput = splitWriterSourceInput(start.input.sourceText || "", start.input.supportDocLinks || "");
  const sourceExtraction = extractRewriteSourceMaterial(separatedSourceInput.sourceText);
  await patchJob(jobId, {
    stage: "prepare",
    message: isRevision ? "正在读取当前稿件和版本上下文" : "正在读取风格卡和共享资料",
    progress: 10
  });

  if (!isRevision && start.input.mode === "rewrite" && sourceExtraction.pendingLinkCount > 0) {
    await patchJob(jobId, {
      stage: "transcribe-links",
      message: "正在转写链接里的视频文稿",
      progress: 18
    });
  }

  if (!isRevision && hasSupportDocumentReference(separatedSourceInput.supportDocLinks)) {
    await patchJob(jobId, {
      stage: "fetch-support-docs",
      message: "正在准备商单支持文档（已读内容会自动复用）",
      progress: 24
    });
  }

  if (isRevision) {
    await runWriteRevisionJob(jobId, start);
    return;
  }

  const batch = await prepareWriteCopyBatchContext(start.input, {
    signal: getJobAbortSignal(jobId),
    onProgress(message) { void patchJob(jobId, { stage: "prepare-style", message, progress: 32 }); }
  });
  throwIfCancelled(jobId);

  if (start.input.useWebResearch) {
    await patchJob(jobId, {
      stage: "research",
      message: batch.research?.startsWith("联网资料：模型联网暂时不可用")
        ? "联网检索暂不可用，正在继续生成"
        : "联网检索已完成，正在整理资料",
      progress: 35,
      result: batch.research ? { research: batch.research } : undefined
    });
  }

  const variantCount = batch.variants.length;
  await patchJob(jobId, {
    stage: "generate",
    message: variantCount > 1 ? `正在并发生成 ${variantCount} 篇独立文案` : "正在生成文案",
    progress: 55
  });

  let partialText = "";
  const partialUpdater = createPartialTextUpdater(jobId, {
    stage: "generate", message: "正在生成正文", progress: text => Math.min(86, 55 + Math.floor(text.length / 120))
  });
  let completedCount = 0;
  const outcomes = await Promise.all(batch.variants.map(async (variant) => {
    try {
      const result = await streamResponseTextWithFallback({
        policy: "writer_generate",
        messages: variant.prepared.messages,
        reasoningEffort: WRITE_COPY_REASONING_EFFORT,
        signal: getJobAbortSignal(jobId),
        onDelta(delta) {
          if (variantCount === 1) {
            partialText += delta;
            partialUpdater.update(partialText);
          }
        }
      });
      if (variantCount === 1) await partialUpdater.flush(partialText);
      const completed = await completePreparedWriteVariant({
        variant,
        result,
        save: start.input.save,
        signal: getJobAbortSignal(jobId)
      });
      completedCount += 1;
      await patchTransientJob(jobId, {
        stage: "generate",
        message: variantCount > 1
          ? `已完成 ${completedCount}/${variantCount} 篇，其他风格仍在生成`
          : "正在整理生成结果",
        progress: Math.min(91, 55 + Math.floor((completedCount / variantCount) * 34))
      });
      return { result: completed };
    } catch (error) {
      if (isCancelledJobError(error, getJobAbortSignal(jobId))) throw error;
      completedCount += 1;
      await patchTransientJob(jobId, {
        stage: "generate",
        message: `已处理 ${completedCount}/${variantCount} 篇，正在等待其余结果`,
        progress: Math.min(91, 55 + Math.floor((completedCount / variantCount) * 34))
      });
      return { failure: writeVariantFailure(variant, error) };
    }
  }));
  throwIfCancelled(jobId);

  if (start.input.save) {
    await patchJob(jobId, {
      stage: "save-draft",
      message: "正在整理已保存的独立草稿",
      progress: 92
    });
  }

  const finalResult = resolveWriteBatchOutcome(batch, outcomes);
  const isBatchResult = "kind" in finalResult && finalResult.kind === "write-batch";
  const successfulCount = isBatchResult ? finalResult.results.length : 1;
  const failedCount = isBatchResult ? finalResult.failures.length : 0;
  await completeJob(jobId, {
    message: failedCount
      ? `已生成 ${successfulCount} 篇，${failedCount} 篇失败`
      : successfulCount > 1 ? `${successfulCount} 篇独立文案已生成` : "文案生成完成",
    result: finalResult,
    partialText: firstWriteResultContent(finalResult),
    resultRef: writeResultRef(finalResult)
  });
}

async function runWriteRevisionJob(jobId: string, start: Extract<JobStartInput, { kind: "write-copy" }>) {
  let partialText = "";
  const partialUpdater = createPartialTextUpdater(jobId, {
    stage: "generate",
    message: "正在生成新版本",
    progress(text) {
      return Math.min(86, 60 + Math.floor(text.length / 120));
    }
  });
  const prepared = await prepareWriteCopyContext(start.input, { signal: getJobAbortSignal(jobId) });
  throwIfCancelled(jobId);
  await patchJob(jobId, {
    stage: "generate",
    message: "正在按本轮要求生成新版本",
    progress: 55
  });
  const result = await streamResponseTextWithFallback({
    policy: "writer_revise",
    messages: prepared.messages,
    reasoningEffort: WRITE_COPY_REASONING_EFFORT,
    signal: getJobAbortSignal(jobId),
    onDelta(delta) {
      partialText += delta;
      partialUpdater.update(partialText);
    }
  });
  await partialUpdater.flush(partialText);
  throwIfCancelled(jobId);
  if (start.input.save) {
    await patchJob(jobId, {
      stage: "save-draft",
      message: "正在保存历史记录",
      progress: 88
    });
  }
  const finalResult = await completePreparedWriteCopy({
    prepared,
    result,
    save: start.input.save,
    signal: getJobAbortSignal(jobId)
  });
  throwIfCancelled(jobId);
  await completeJob(jobId, {
    message: "文案新版本已生成",
    result: finalResult,
    partialText: finalResult.content,
    resultRef: writeResultRef(finalResult)
  });
}

async function runAccountStyleJob(jobId: string, start: Extract<JobStartInput, { kind: "account-style" }>) {
  throwIfCancelled(jobId);
  const startedAt = Date.now();
  let partialText = "";
  let firstDeltaMs: number | undefined;
  const partialUpdater = createPartialTextUpdater(jobId, {
    stage: "generate",
    message: "正在生成账号风格卡",
    progress(text) {
      return Math.min(88, 45 + Math.floor(text.length / 90));
    }
  });
  await patchJob(jobId, {
    stage: "prepare",
    message: "正在读取账号转写样本",
    progress: 12
  });
  const context = await prepareAccountStyleContext(start.input.platform, start.input.accountId, {
    force: start.input.force,
    signal: getJobAbortSignal(jobId),
    onAnalysisProgress(progress) {
      const percent = progress.analysisCount
        ? Math.floor((progress.completedCount / progress.analysisCount) * 25)
        : 0;
      void patchJob(jobId, {
        stage: "analysis",
        message: progress.message || `正在分析完整样本 ${progress.completedCount}/${progress.analysisCount}`,
        progress: Math.min(34, 12 + percent)
      });
    }
  });
  throwIfCancelled(jobId);
  const cached = completeCachedAccountStyle(context);
  if (cached) {
    const cachedResult = { ...cached, totalMs: Date.now() - startedAt };
    await patchJob(jobId, {
      stage: "cache",
      message: "样本未变化，已复用现有风格卡",
      progress: 95,
      partialText: cachedResult.style
    });
    await completeJob(jobId, {
      message: "账号风格卡已复用",
      result: cachedResult,
      partialText: cachedResult.style,
      resultRef: {
        id: start.input.accountId,
        href: start.href || "/library",
        label: "查看账号库"
      }
    });
    return;
  }

  await patchJob(jobId, {
    stage: "generate",
    message: context.generationMode === "incremental" ? "正在增量更新账号风格卡" : "正在生成账号风格卡",
    progress: 35
  });
  const result = await streamStyleResponseTextWithFallback({
    messages: context.messages,
    signal: getJobAbortSignal(jobId),
    onDelta(delta) {
      if (firstDeltaMs === undefined) firstDeltaMs = Date.now() - startedAt;
      partialText += delta;
      partialUpdater.update(partialText);
    }
  });
  if (!partialText.trim() && result.text) {
    if (firstDeltaMs === undefined) firstDeltaMs = Date.now() - startedAt;
    partialText = result.text;
  }
  await partialUpdater.flush(partialText);
  throwIfCancelled(jobId);

  await patchJob(jobId, {
    stage: "save",
    message: "正在写入账号风格卡",
    progress: 90
  });
  const saved = await completePreparedAccountStyle(context, result, {
    firstDeltaMs,
    totalMs: Date.now() - startedAt
  });
  throwIfCancelled(jobId);
  await completeJob(jobId, {
    message: "账号风格卡已生成",
    result: saved,
    partialText: saved.style,
    resultRef: {
      id: start.input.accountId,
      href: start.href || "/library",
      label: "查看账号库"
    }
  });
}

async function runProjectStyleJob(jobId: string, start: Extract<JobStartInput, { kind: "project-style" }>) {
  throwIfCancelled(jobId);
  const startedAt = Date.now();
  let partialText = "";
  let firstDeltaMs: number | undefined;
  const partialUpdater = createPartialTextUpdater(jobId, {
    stage: "generate",
    message: "正在生成项目风格卡",
    progress(text) {
      return Math.min(90, 45 + Math.floor(text.length / 90));
    }
  });
  await patchJob(jobId, {
    stage: "validate",
    message: "正在校验项目配置",
    progress: 15
  });
  if (!start.input.sourceAccountIds.length && !start.input.sourceMaterialIds?.length) {
    throw new Error("先加案例或账号");
  }
  throwIfCancelled(jobId);

  await patchJob(jobId, {
    stage: "prepare",
    message: "正在保存项目并读取参考样本",
    progress: 35
  });
  const prepared = await prepareSavedProjectStyleContext(start.input, {
    signal: getJobAbortSignal(jobId),
    onAnalysisProgress(progress) {
      const percent = progress.analysisCount
        ? Math.floor((progress.completedCount / progress.analysisCount) * 30)
        : 0;
      void patchJob(jobId, {
        stage: "analysis",
        message: progress.message || `正在分析完整样本 ${progress.completedCount}/${progress.analysisCount}`,
        progress: Math.min(44, 15 + percent)
      });
    }
  });
  throwIfCancelled(jobId);
  const cached = completeCachedProjectStyle(prepared.context);
  if (cached) {
    const result = await buildSavedProjectStyleResult(prepared, { ...cached, totalMs: Date.now() - startedAt });
    await patchJob(jobId, {
      stage: "cache",
      message: "样本未变化，已复用现有项目风格卡",
      progress: 95,
      partialText: result.style
    });
    await completeJob(jobId, {
      message: "项目风格卡已复用",
      result,
      partialText: result.style,
      resultRef: {
        id: result.project.id,
        href: "/project-workbench",
        label: "查看项目工作台"
      }
    });
    return;
  }

  await patchJob(jobId, {
    stage: "generate",
    message: "正在生成项目风格卡",
    progress: 45
  });
  const completion = await streamStyleResponseTextWithFallback({
    policy: "project_style",
    messages: prepared.context.messages,
    signal: getJobAbortSignal(jobId),
    onDelta(delta) {
      if (firstDeltaMs === undefined) firstDeltaMs = Date.now() - startedAt;
      partialText += delta;
      partialUpdater.update(partialText);
    }
  });
  if (!partialText.trim() && completion.text) {
    if (firstDeltaMs === undefined) firstDeltaMs = Date.now() - startedAt;
    partialText = completion.text;
  }
  await partialUpdater.flush(partialText);
  throwIfCancelled(jobId);

  await patchJob(jobId, {
    stage: "finalize",
    message: "正在写入项目风格卡",
    progress: 92
  });
  const saved = await completePreparedProjectStyle(prepared.context, completion, {
    firstDeltaMs,
    totalMs: Date.now() - startedAt
  });
  const result = await buildSavedProjectStyleResult(prepared, saved);
  await completeJob(jobId, {
    message: "项目风格卡已更新",
    result,
    partialText: result.style,
    resultRef: {
      id: result.project.id,
      href: "/project-workbench",
      label: "查看项目工作台"
    }
  });
}

async function runTranscribeVideoJob(jobId: string, start: Extract<JobStartInput, { kind: "transcribe-video" }>) {
  throwIfCancelled(jobId);
  await patchJob(jobId, {
    stage: "prepare",
    message: "正在检查字幕和媒体",
    progress: 12
  });

  await patchJob(jobId, {
    stage: "transcribe",
    message: "正在转写视频",
    progress: 35
  });
  const result = await transcribeVideo({
    ...start.input,
    signal: getJobAbortSignal(jobId)
  });
  throwIfCancelled(jobId);

  await patchJob(jobId, {
    stage: "save",
    message: "正在保存转写结果",
    progress: 88
  });

  await completeJob(jobId, {
    message: "转写稿已生成",
    result,
    resultRef: {
      id: start.input.videoId,
      href: start.href || "/library",
      label: "查看账号库"
    }
  });
}

async function runBatchTranscribeJob(jobId: string, start: Extract<JobStartInput, { kind: "batch-transcribe" }>) {
  throwIfCancelled(jobId);
  const result = await runBatchTranscribe(start.input, {
    signal: getJobAbortSignal(jobId),
    onPrepare() {
      throwIfCancelled(jobId);
      void patchTransientJob(jobId, {
        stage: "prepare",
        message: "正在读取账号和候选视频",
        progress: 8
      });
    },
    onMediaPreloadStart({ total }) {
      throwIfCancelled(jobId);
      void patchTransientJob(jobId, {
        stage: "media-preload",
        message: `正在预取 ${total} 条抖音视频的媒体地址`,
        progress: 12
      });
    },
    onVideoStart({ index, total, video }) {
      throwIfCancelled(jobId);
      const progress = total ? 18 + Math.round((index / total) * 64) : 70;
      void patchTransientJob(jobId, {
        stage: "transcribe",
        message: `正在处理第 ${index + 1}/${total} 条视频：${video.title}`,
        progress
      });
    },
    onVideoResult(video) {
      throwIfCancelled(jobId);
      void patchTransientJob(jobId, {
        message: `已处理：${video.title}`,
        result: { latestVideo: video }
      });
    },
    async onTranscribeComplete({ completed, skipped, failed }) {
      throwIfCancelled(jobId);
      await patchJobWithDataChange(jobId, {
        stage: "transcripts-saved",
        message: `转写已同步：新增 ${completed}，跳过 ${skipped}，失败 ${failed}`,
        progress: 86
      }, {
        resource: "library-account",
        accountId: start.input.accountId
      });
    },
    onStyleStart() {
      throwIfCancelled(jobId);
      void patchTransientJob(jobId, {
        stage: "style",
        message: "正在更新账号风格卡",
        progress: 88
      });
    },
    onFinalize() {
      throwIfCancelled(jobId);
      void patchTransientJob(jobId, {
        stage: "finalize",
        message: "正在整理转写结果",
        progress: 98
      });
    }
  });
  throwIfCancelled(jobId);

  await completeJob(jobId, {
    message: summarizeBatchResult(result),
    result,
    resultRef: {
      id: start.input.accountId,
      href: start.href || "/library",
      label: "查看账号库"
    }
  });
}

async function runEngagementJob(jobId: string, start: Extract<JobStartInput, { kind: "engagement" }>) {
  throwIfCancelled(jobId);
  await patchJob(jobId, {
    stage: "prepare",
    message: start.input.sourceType === "url" ? "正在读取链接并准备素材" : "正在准备互动素材",
    progress: 18
  });
  const result = await generateEngagement(start.input, {
    signal: getJobAbortSignal(jobId),
    async onProgress(progress) {
      throwIfCancelled(jobId);
      await patchTransientJob(jobId, {
        stage: progress.stage,
        message: progress.message,
        progress: progress.progress,
        result: progress.previewComments
          ? {
              previewComments: progress.previewComments,
              requestedCount: start.input.commentCount
            }
          : undefined
      });
    }
  });
  throwIfCancelled(jobId);

  await completeJob(jobId, {
    message: buildEngagementSuccessMessage(result.record),
    result,
    resultRef: {
      id: result.record.id,
      href: buildEngagementRecordHref(
        result.record.id,
        start.input.sourceType === "draft" ? `/assets?draftId=${encodeURIComponent(start.input.draftId)}` : "/assets"
      ),
      label: "查看评论生成"
    }
  });
}

async function runHotlistRefreshJob(jobId: string, start: Extract<JobStartInput, { kind: "hotlist-refresh" }>) {
  throwIfCancelled(jobId);
  await patchJob(jobId, {
    stage: "prepare",
    message: "正在读取热榜账号池",
    progress: 8
  });

  const result = await refreshDouyinHotlist({
    accountIds: start.input.accountIds,
    limit: start.input.limit,
    windowKey: start.input.window,
    signal: getJobAbortSignal(jobId),
    async onProgress(progress) {
      throwIfCancelled(jobId);
      const account = progress.result;
      const status = account.status === "completed" ? "有更新" : account.status === "unchanged" ? "无变化" : "失败";
      await patchJobWithDataChange(jobId, {
        stage: "collect",
        message: `已处理 ${progress.completed}/${progress.total}：${account.name}（${status}）`,
        progress: Math.min(92, 10 + Math.round((progress.completed / progress.total) * 82))
      }, {
        resource: "douyin-hotlist",
        accountId: account.accountId
      });
    }
  });
  throwIfCancelled(jobId);

  if (result.refresh.requested > 0 && result.refresh.failed === result.refresh.requested) {
    const details = result.refresh.accounts
      .map((account) => account.error)
      .filter(Boolean)
      .slice(0, 3)
      .join("；");
    throw new Error(details ? `视频热榜刷新失败：${details}` : "视频热榜刷新失败：所有账号都未返回可用结果。");
  }

  await completeJob(jobId, {
    message: `热榜刷新完成：${result.refresh.completed} 个账号有更新，${result.refresh.unchanged} 个无变化，${result.refresh.failed} 个失败`,
    result: {
      automatic: Boolean(start.input.automatic),
      refresh: result.refresh,
      summary: result.summary
    },
    resultRef: {
      href: start.href || "/douyin-hotlist",
      label: "查看视频热榜"
    }
  });
}

async function runCollectAccountJob(jobId: string, start: Extract<JobStartInput, { kind: "collect-account" }>) {
  const result = await collectAccountContent(start.input, {
    signal: getJobAbortSignal(jobId),
    async onProgress(progress) {
      throwIfCancelled(jobId);
      await patchTransientJob(jobId, progress);
    }
  });
  throwIfCancelled(jobId);
  await completeJob(jobId, {
    message: `账号采集完成：写入 ${result.filteredCount} 条视频到「${result.account.name}」`,
    result,
    resultRef: {
      id: result.account.id,
      href: start.href || "/library",
      label: "查看账号库"
    }
  });
}

async function runSingleVideoTranscribeJob(jobId: string, start: Extract<JobStartInput, { kind: "single-video-transcribe" }>) {
  await patchJob(jobId, {
    stage: "resolve-link",
    message: "正在识别视频并读取字幕",
    progress: 18
  });
  const result = await transcribeLinkSource({
    ...start.input,
    analyzeVideo: true,
    signal: getJobAbortSignal(jobId)
  });
  throwIfCancelled(jobId);
  await completeJob(jobId, {
    message: result.fallback ? result.fallbackReason || "已提取可用文本" : "视频文案已提取",
    result,
    resultRef: { href: start.href || "/tools", label: "查看工具台" }
  });
}

async function runPublishCopyJob(jobId: string, start: Extract<JobStartInput, { kind: "publish-copy" }>) {
  await patchJob(jobId, {
    stage: "research",
    message: "正在规划检索词并收集同类选题",
    progress: 22
  });
  const result = await generatePublishCopy(start.input, { signal: getJobAbortSignal(jobId) });
  throwIfCancelled(jobId);
  await completeJob(jobId, {
    message: `已生成 ${result.candidates.length} 组标题和发布文案`,
    result,
    resultRef: { href: start.href || "/tools", label: "查看工具台" }
  });
}

async function runHotspotRefreshJob(jobId: string, start: Extract<JobStartInput, { kind: "hotspot-refresh" }>) {
  await patchJob(jobId, {
    stage: "collect",
    message: "正在刷新热点来源",
    progress: 8
  });
  const result = await getHotspotRadar({
    refresh: true,
    retryReport: start.input.retryReport,
    signal: getJobAbortSignal(jobId),
    async onProgress(progress) {
      if (!progress.dataChanged) throwIfCancelled(jobId);
      const patch = {
        stage: progress.stage || "collect",
        message: `${progress.sourceName}${progress.failed ? "（失败）" : ""} · ${progress.completed}/${progress.total}`,
        progress: progress.stage === "AI 粗筛" ? 55 + Math.round(progress.completed / Math.max(1, progress.total) * 15) : progress.stage === "AI 精筛" ? 70 + Math.round(progress.completed / Math.max(1, progress.total) * 20) : progress.stage === "日报" ? 94 : Math.min(54, 8 + Math.round(progress.completed / Math.max(1, progress.total) * 46))
      };
      if (progress.dataChanged) await patchJobWithDataChange(jobId, patch, { resource: "hotspots" });
      else await patchTransientJob(jobId, patch);
    }
  });
  throwIfCancelled(jobId);
  await completeJob(jobId, {
    message: `热点刷新完成：${result.summary.hotspotCount} 个热点，${result.summary.failedSourceCount} 个来源异常`,
    result,
    resultRef: { href: start.href || "/hotspots", label: "查看热点雷达" }
  });
}

async function runGrossMarginRefreshJob(jobId: string, start: Extract<JobStartInput, { kind: "gross-margin-refresh" }>) {
  await patchJob(jobId, {
    stage: "load",
    message: "正在读取监控记录",
    progress: 8
  });
  const records = await refreshGrossMarginMonitorRecords(start.input.recordIds, {
    signal: getJobAbortSignal(jobId),
    async onProgress(progress) {
      throwIfCancelled(jobId);
      await patchJobWithDataChange(jobId, {
        stage: "refresh",
        message: `已刷新 ${progress.completed}/${progress.total}：${progress.record.accountName || progress.record.title || progress.record.id}`,
        progress: Math.min(94, 10 + Math.round((progress.completed / Math.max(1, progress.total)) * 84))
      }, {
        resource: "gross-margin",
        recordId: progress.record.id
      });
    }
  });
  throwIfCancelled(jobId);
  const failed = records.filter((record) => record.status === "failed").length;
  await completeJob(jobId, {
    message: `监控刷新完成：${records.length - failed} 条成功，${failed} 条失败`,
    result: { records },
    resultRef: { href: start.href || "/gross-margin/monitor", label: "查看数据监控" }
  });
}

export async function cancelJob(jobId: string) {
  await ensureInitialized();
  const current = await getJob(jobId);

  if (current.status === "completed" || current.status === "failed" || current.status === "cancelled" || current.status === "interrupted") {
    throw new Error("任务已结束，无法停止");
  }

  runtime.cancelRequests.add(jobId);
  runtime.pending.delete(jobId);
  runtime.abortControllers.get(jobId)?.abort();

  const next = await patchJob(jobId, {
    status: "cancelled",
    stage: "cancelled",
    message: "任务已停止",
    error: undefined,
    completedAt: nowIso()
  });
  await removeJobPayload(jobId);
  await pruneJobHistory();
  pumpJobQueue();
  return next;
}

export async function retryJob(jobId: string) {
  await ensureInitialized();
  const current = await getJob(jobId);
  if (!isTerminalJob(current)) throw new Error("任务仍在运行，无法重试");
  const input = await readJobPayload(jobId);
  if (!input) throw new Error("任务恢复参数缺失，请重新发起。");
  return createJob(input);
}

async function completeJob(
  jobId: string,
  patch: Pick<JobRecord, "message"> & Partial<Pick<JobRecord, "result" | "resultRef" | "partialText">>
) {
  await patchJob(jobId, {
    ...patch,
    status: "completed",
    stage: "done",
    progress: 100,
    completedAt: nowIso()
  }, {
    beforePatch() {
      throwIfCancelled(jobId);
    }
  });
  await removeJobPayload(jobId);
  await pruneJobHistory();
}

function createPartialTextUpdater(
  jobId: string,
  options: {
    stage: string;
    message: string;
    progress: (text: string) => number;
  }
) {
  let lastPatchedAt = 0;
  let lastPatchedLength = 0;

  const shouldPatch = (text: string) => {
    const now = Date.now();
    return (
      !lastPatchedAt ||
      now - lastPatchedAt >= PARTIAL_TEXT_PATCH_INTERVAL_MS ||
      text.length - lastPatchedLength >= PARTIAL_TEXT_PATCH_CHARS
    );
  };

  const patch = (text: string) => {
    lastPatchedAt = Date.now();
    lastPatchedLength = text.length;
    return patchTransientJob(jobId, {
      stage: options.stage,
      message: options.message,
      progress: options.progress(text),
      partialText: text
    });
  };

  return {
    update(text: string) {
      if (shouldPatch(text)) void patch(text);
    },
    async flush(text: string) {
      if (text && text.length !== lastPatchedLength) await patch(text);
    }
  };
}

function makeJobId(kind: JobKind) {
  return `job-${kind}-${Date.now()}-${shortHash(`${kind}-${Date.now()}-${Math.random()}`)}`;
}

function defaultJobTitle(input: JobStartInput) {
  if (input.kind === "image-prompt-assist") return input.input.mode === "polish" ? "AI 润色提示词" : "AI 构图建议";
  if (input.kind === "image-generation") return "生成图片";
  if (input.kind === "write-copy") return "生成文案";
  if (input.kind === "account-style") return "生成账号风格卡";
  if (input.kind === "project-style") return "生成项目风格卡";
  if (input.kind === "transcribe-video") return "转写视频";
  if (input.kind === "batch-transcribe") return input.input.updateStyle ? "批量转写并更新风格" : "批量转写";
  if (input.kind === "hotlist-refresh") return input.input.automatic ? "自动刷新视频热榜" : "刷新视频热榜";
  if (input.kind === "collect-account") return "采集账号";
  if (input.kind === "single-video-transcribe") return "提取单条视频文案";
  if (input.kind === "publish-copy") return "生成标题与发布文案";
  if (input.kind === "hotspot-refresh") return "刷新热点雷达";
  if (input.kind === "gross-margin-refresh") return "批量刷新数据监控";
  if (input.input.sourceType === "record") return "补齐评论素材";
  return "生成评论素材";
}

function defaultInputSummary(input: JobStartInput) {
  if (input.kind === "image-generation" || input.kind === "image-prompt-assist") return input.input.prompt.slice(0, 60);
  if (input.kind === "write-copy") {
    if (input.input.action === "revise") return input.input.revisionScope === "selection" ? "选中段落续改" : "全文续改";
    return input.input.mode === "topic" ? "自由输入" : "素材改写";
  }
  if (input.kind === "account-style") return input.input.accountId;
  if (input.kind === "project-style") return input.input.name;
  if (input.kind === "transcribe-video") return input.input.videoId;
  if (input.kind === "batch-transcribe") {
    const range = input.input.videoIds?.length
      ? `所选 ${input.input.videoIds.length} 条视频`
      : input.input.limit === "all"
        ? "全部待转写视频"
        : `${input.input.limit} 条待转写视频`;
    return `${input.input.accountId} · ${range}`;
  }
  if (input.kind === "hotlist-refresh") {
    return `${input.input.window} · ${input.input.accountIds?.length ? `${input.input.accountIds.length} 个账号` : "全部账号"}`;
  }
  if (input.kind === "collect-account") return `${input.input.platform === "bilibili" ? "B站" : "抖音"} · ${input.input.name}`;
  if (input.kind === "single-video-transcribe") return input.input.titleHint || input.input.url;
  if (input.kind === "publish-copy") return input.input.topicHint || input.input.sourceText.slice(0, 42);
  if (input.kind === "hotspot-refresh") return "全量热点来源";
  if (input.kind === "gross-margin-refresh") return input.input.recordIds?.length ? `${input.input.recordIds.length} 条记录` : "全部监控记录";
  if (input.input.sourceType === "draft") return "从草稿生成";
  if (input.input.sourceType === "url") return "从链接生成";
  if (input.input.sourceType === "record") return "补齐已有评论";
  return input.input.title || "从粘贴文案生成";
}

function defaultJobScope(input: JobStartInput): JobScope {
  if (input.kind === "image-generation" || input.kind === "image-prompt-assist") return { targetType: "text", sourceKey: shortHash(input.input.prompt) };
  if (input.kind === "write-copy") {
    return compactJobScope({
      targetType: input.input.targetType,
      platform: input.input.platform,
      accountId: input.input.accountId,
      projectId: input.input.projectId,
      sourceKey: writeCopySourceKey(input.input)
    });
  }
  if (input.kind === "account-style") {
    return compactJobScope({
      targetType: "account",
      platform: input.input.platform,
      accountId: input.input.accountId
    });
  }
  if (input.kind === "project-style") {
    return compactJobScope({
      targetType: "project",
      projectId: input.input.projectId,
      sourceKey: input.input.projectId ? undefined : shortHash(`${input.input.name}-${input.input.sourceAccountIds.join(",")}-${(input.input.sourceMaterialIds || []).join(",")}`)
    });
  }
  if (input.kind === "transcribe-video") {
    return compactJobScope({
      targetType: "account",
      platform: input.input.platform,
      accountId: input.input.accountId,
      videoId: input.input.videoId
    });
  }
  if (input.kind === "batch-transcribe") {
    return compactJobScope({
      targetType: "account",
      platform: input.input.platform,
      accountId: input.input.accountId
    });
  }
  if (input.kind === "hotlist-refresh") {
    return compactJobScope({
      targetType: "hotlist",
      sourceKey: shortHash(`${input.input.window}-${(input.input.accountIds || []).join(",") || "all"}`)
    });
  }
  if (input.kind === "collect-account") {
    return compactJobScope({
      targetType: "account",
      platform: input.input.platform,
      sourceKey: shortHash(`${input.input.name}-${input.input.uidOrUrl || ""}`)
    });
  }
  if (input.kind === "single-video-transcribe") {
    return compactJobScope({ targetType: "url", sourceKey: shortHash(input.input.url) });
  }
  if (input.kind === "publish-copy") {
    return compactJobScope({ targetType: "text", sourceKey: shortHash(input.input.sourceText) });
  }
  if (input.kind === "hotspot-refresh") {
    return compactJobScope({ targetType: "hotspot", sourceKey: "all" });
  }
  if (input.kind === "gross-margin-refresh") {
    return compactJobScope({ targetType: "gross-margin", sourceKey: shortHash((input.input.recordIds || ["all"]).join(",")) });
  }
  if (input.input.sourceType === "draft") {
    return compactJobScope({
      targetType: "draft",
      draftId: input.input.draftId
    });
  }
  if (input.input.sourceType === "record") {
    return compactJobScope({
      targetType: "engagement",
      engagementRecordId: input.input.recordId
    });
  }
  if (input.input.sourceType === "url") {
    return compactJobScope({
      targetType: "url",
      sourceKey: engagementSourceKey(input.input)
    });
  }
  return compactJobScope({
    targetType: "text",
    sourceKey: engagementSourceKey(input.input)
  });
}

function compactJobScope(scope: JobScope): JobScope {
  return Object.fromEntries(
    Object.entries(scope).filter(([, value]) => typeof value === "string" && value.trim())
  ) as JobScope;
}

function defaultHref(input: JobStartInput) {
  if (input.kind === "image-generation" || input.kind === "image-prompt-assist") return "/images";
  if (input.kind === "write-copy") return "/writer";
  if (input.kind === "account-style" || input.kind === "transcribe-video" || input.kind === "batch-transcribe") return "/library";
  if (input.kind === "project-style") return "/project-workbench";
  if (input.kind === "hotlist-refresh") return "/douyin-hotlist";
  if (input.kind === "collect-account") return "/library";
  if (input.kind === "single-video-transcribe" || input.kind === "publish-copy") return "/tools";
  if (input.kind === "hotspot-refresh") return "/hotspots";
  if (input.kind === "gross-margin-refresh") return "/gross-margin/monitor";
  return "/assets";
}

function firstWriteResultContent(result: WriteGenerationResult) {
  return isWriteBatchResult(result) ? result.results[0]?.content : result.content;
}

function writeResultRef(result: WriteGenerationResult) {
  if (isWriteBatchResult(result)) {
    const firstResult = result.results[0];
    if (!firstResult?.draft) {
      return { href: "/writer", label: "查看写作台" };
    }
    return {
      id: firstResult.draft.id,
      href: "/writer",
      label: `查看 ${result.results.length} 篇文案`
    };
  }

  const firstResult = result;
  if (!firstResult?.draft) {
    return {
      href: "/writer",
      label: "查看写作台"
    };
  }

  return {
    id: firstResult.draft.id,
    href: buildWriterDraftHref(firstResult.draft),
    label: "查看文案"
  };
}

function isWriteBatchResult(result: WriteGenerationResult): result is WriteBatchResult {
  return "kind" in result && result.kind === "write-batch";
}

function summarizeBatchResult(result: BatchTranscribeResult) {
  return `批量转写完成：新增 ${result.completed}，跳过 ${result.skipped}，失败 ${result.failed}`;
}

function buildEngagementSuccessMessage(record: EngagementRecord) {
  const commentCount = record.comments?.items.length || 0;
  const danmakuCount = record.danmaku?.items.length || 0;
  const requestedCommentCount = record.comments?.requestedCount || 0;
  const requestedDanmakuCount = record.danmaku?.requestedCount || 0;
  const commentLabel = requestedCommentCount && commentCount < requestedCommentCount
    ? `${commentCount}/${requestedCommentCount} 条评论`
    : `${commentCount} 条评论`;
  const danmakuLabel = requestedDanmakuCount && danmakuCount < requestedDanmakuCount
    ? `${danmakuCount}/${requestedDanmakuCount} 条弹幕`
    : `${danmakuCount} 条弹幕`;
  if (commentCount && danmakuCount) return `已生成 ${commentLabel}和 ${danmakuLabel}`;
  if (commentCount) return `已生成 ${commentLabel}`;
  return `已生成 ${danmakuLabel}`;
}

function getJobAbortSignal(jobId: string) {
  return runtime.abortControllers.get(jobId)?.signal;
}

function maxActiveJobs() {
  const parsed = Number.parseInt(process.env.JOB_MAX_ACTIVE || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ACTIVE_JOBS;
  return Math.min(Math.max(parsed, 1), 6);
}

function jobHistoryLimit() {
  const parsed = Number.parseInt(process.env.JOB_HISTORY_LIMIT || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_JOB_HISTORY_LIMIT;
  return Math.min(Math.max(parsed, 50), 1000);
}

function jobHistoryMaxBytes() {
  const parsedMb = Number.parseInt(process.env.JOB_HISTORY_MAX_MB || "", 10);
  if (!Number.isFinite(parsedMb)) return DEFAULT_JOB_HISTORY_MAX_BYTES;
  return Math.min(Math.max(parsedMb, 5), 500) * 1024 * 1024;
}

function jobResultPersistBytes() {
  const parsedKb = Number.parseInt(process.env.JOB_RESULT_PERSIST_KB || "", 10);
  if (!Number.isFinite(parsedKb)) return DEFAULT_JOB_RESULT_PERSIST_BYTES;
  return Math.min(Math.max(parsedKb, 16), 1024) * 1024;
}

async function pruneJobHistory() {
  const limit = jobHistoryLimit();
  const maxBytes = jobHistoryMaxBytes();
  const jobs = await listJobSummariesFromDisk();
  let terminalCount = 0;
  let retainedBytes = 0;
  const removable: JobSummaryRead[] = [];

  for (const job of jobs) {
    const size = await fs.stat(job.filePath).then((stat) => stat.size).catch(() => 0);
    if (!isTerminalJob(job)) {
      retainedBytes += size;
      continue;
    }

    const withinCount = terminalCount < limit;
    const withinBytes = retainedBytes + size <= maxBytes || terminalCount === 0;
    if (withinCount && withinBytes) {
      terminalCount += 1;
      retainedBytes += size;
    } else {
      removable.push(job);
    }
  }
  if (!removable.length) return;

  await Promise.all(
    removable.map(async (job) => {
      runtime.records.delete(job.id);
      runtime.pending.delete(job.id);
      if (isCloudStorageMode()) await deleteCloudJob(job.id);
      else await fs.rm(job.filePath, { force: true }).catch(() => undefined);
      await removeJobPayload(job.id);
      recordJobChange(job.id, true);
    })
  );
  invalidateJobSummaryCache();
}

function invalidateJobSummaryCache() {
  jobSummaryCache = null;
}

async function writeJobPayload(jobId: string, input: JobStartInput) {
  await ensureJobs();
  await writeJson(jobPayloadPath(jobId), { version: 1, input });
}

async function readJobPayload(jobId: string) {
  const payload = await readJson<{ version?: number; input?: JobStartInput }>(jobPayloadPath(jobId));
  if (payload?.version !== 1 || !payload.input || !jobKindSet.has(payload.input.kind)) return null;
  return payload.input;
}

async function removeJobPayload(jobId: string) {
  await fs.rm(jobPayloadPath(jobId), { force: true }).catch(() => undefined);
}

function recordJobChange(jobId: string, removed = false) {
  runtime.changeRevision += 1;
  runtime.changeLog.push({ revision: runtime.changeRevision, jobId, ...(removed ? { removed: true } : {}) });
  if (runtime.changeLog.length > JOB_CHANGE_LOG_LIMIT) {
    runtime.changeLog.splice(0, runtime.changeLog.length - JOB_CHANGE_LOG_LIMIT);
  }
}

function jobChangeCursor() {
  return `${runtime.changeEpoch}.${runtime.changeRevision}`;
}

function parseJobChangeCursor(cursor?: string) {
  if (!cursor) return null;
  const separator = cursor.lastIndexOf(".");
  if (separator < 1) return null;
  const epoch = cursor.slice(0, separator);
  const revision = Number.parseInt(cursor.slice(separator + 1), 10);
  if (!epoch || !Number.isSafeInteger(revision) || revision < 0) return null;
  return { epoch, revision };
}

function isTerminalJob(job: Pick<JobRecord, "status">) {
  return (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled" ||
    job.status === "interrupted"
  );
}

function shouldRecordJobEvent(
  current: JobRecord,
  next: JobRecord,
  patch: Partial<JobRecord>
) {
  if (!("status" in patch) && !("stage" in patch) && !("message" in patch)) return false;
  return current.status !== next.status || current.stage !== next.stage || current.message !== next.message;
}

function appendJobEvent(events: JobEvent[] | undefined, event: JobEvent) {
  const last = events?.at(-1);
  if (
    last &&
    last.status === event.status &&
    last.stage === event.stage &&
    last.message === event.message
  ) {
    return events;
  }
  return [...(events || []), event].slice(-80);
}

function throwIfCancelled(jobId: string): asserts jobId is string {
  if (runtime.cancelRequests.has(jobId)) {
    throw new CancelledJobError();
  }
}

class CancelledJobError extends Error {
  constructor() {
    super("任务已停止");
    this.name = "CancelledJobError";
  }
}

function isCancelledJobError(error: unknown, signal?: AbortSignal) {
  if (error instanceof CancelledJobError) return true;
  if (signal?.aborted) return true;
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /AbortError|aborted|任务已停止/i.test(error.message);
}

function parseJobSummaryJson(target: string, raw: string): JobSummaryRead {
  const kind = readRequiredString(target, raw, "kind");
  if (!jobKindSet.has(kind as JobKind)) {
    throw new Error(`任务记录字段无效：${target} 的 kind 不是已知任务类型。`);
  }

  const status = readRequiredString(target, raw, "status");
  if (!jobStatusSet.has(status as JobRecord["status"])) {
    throw new Error(`任务记录字段无效：${target} 的 status 不是已知任务状态。`);
  }

  const inputSummary = readOptionalString(target, raw, "inputSummary");
  const error = readOptionalString(target, raw, "error");
  const scope = readOptionalObject<JobScope>(target, raw, "scope");
  const stage = readOptionalString(target, raw, "stage");
  const href = readOptionalString(target, raw, "href");
  const resultRef = readOptionalObject<JobRecord["resultRef"]>(target, raw, "resultRef");
  const events = readOptionalArray<JobEvent>(target, raw, "events");
  const dataRevision = readOptionalNumber(target, raw, "dataRevision");
  const dataChange = readOptionalObject<JobRecord["dataChange"]>(target, raw, "dataChange");
  const attempt = readOptionalNumber(target, raw, "attempt");
  const resumedAt = readOptionalString(target, raw, "resumedAt");
  const completedAt = readOptionalString(target, raw, "completedAt");
  const resultCompacted = readOptionalBoolean(target, raw, "resultCompacted");
  const resultSizeBytes = readOptionalNumber(target, raw, "resultSizeBytes");

  return {
    id: readRequiredString(target, raw, "id"),
    kind: kind as JobKind,
    status: status as JobRecord["status"],
    title: readRequiredString(target, raw, "title"),
    ...(inputSummary ? { inputSummary: summarizeJobListText(inputSummary, 120) } : {}),
    ...(scope ? { scope } : {}),
    ...(stage ? { stage } : {}),
    message: summarizeJobListText(readRequiredString(target, raw, "message"), 160),
    progress: readRequiredNumber(target, raw, "progress"),
    ...(href ? { href } : {}),
    ...(resultRef ? { resultRef } : {}),
    ...(events ? { events: summarizeJobEvents(events) } : {}),
    ...(dataRevision !== undefined ? { dataRevision } : {}),
    ...(dataChange ? { dataChange } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(resumedAt ? { resumedAt } : {}),
    ...(error ? { error: summarizeJobListText(error, 240) } : {}),
    createdAt: readRequiredString(target, raw, "createdAt"),
    updatedAt: readRequiredString(target, raw, "updatedAt"),
    ...(completedAt ? { completedAt } : {}),
    ...(resultCompacted !== undefined ? { resultCompacted } : {}),
    ...(resultSizeBytes !== undefined ? { resultSizeBytes } : {}),
    hasPartialText: hasTopLevelProperty(raw, "partialText"),
    hasResult: hasTopLevelProperty(raw, "result"),
    filePath: target
  };
}

function readRequiredString(target: string, raw: string, key: string) {
  const value = readOptionalTopLevelJsonValue(target, raw, key);
  if (value.found && typeof value.value === "string") return value.value;
  throw new Error(`任务记录字段缺失或无效：${target} 缺少字符串字段 ${key}。`);
}

function readOptionalString(target: string, raw: string, key: string) {
  const value = readOptionalTopLevelJsonValue(target, raw, key);
  if (!value.found) return undefined;
  if (typeof value.value === "string") return value.value;
  throw new Error(`任务记录字段无效：${target} 的 ${key} 不是字符串。`);
}

function readRequiredNumber(target: string, raw: string, key: string) {
  const value = readOptionalTopLevelJsonValue(target, raw, key);
  if (value.found && typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
  throw new Error(`任务记录字段缺失或无效：${target} 缺少数字字段 ${key}。`);
}

function readOptionalNumber(target: string, raw: string, key: string) {
  const value = readOptionalTopLevelJsonValue(target, raw, key);
  if (!value.found) return undefined;
  if (typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
  throw new Error(`任务记录字段无效：${target} 的 ${key} 不是数字。`);
}

function readOptionalBoolean(target: string, raw: string, key: string) {
  const value = readOptionalTopLevelJsonValue(target, raw, key);
  if (!value.found) return undefined;
  if (typeof value.value === "boolean") return value.value;
  throw new Error(`任务记录字段无效：${target} 的 ${key} 不是布尔值。`);
}

function readOptionalObject<T>(target: string, raw: string, key: string): T | undefined {
  const value = readOptionalTopLevelJsonValue(target, raw, key);
  if (!value.found) return undefined;
  if (value.value && typeof value.value === "object" && !Array.isArray(value.value)) return value.value as T;
  throw new Error(`任务记录字段无效：${target} 的 ${key} 不是对象。`);
}

function readOptionalArray<T>(target: string, raw: string, key: string): T[] | undefined {
  const value = readOptionalTopLevelJsonValue(target, raw, key);
  if (!value.found) return undefined;
  if (Array.isArray(value.value)) return value.value as T[];
  throw new Error(`任务记录字段无效：${target} 的 ${key} 不是数组。`);
}

function readOptionalTopLevelJsonValue(
  target: string,
  raw: string,
  key: string
): { found: false } | { found: true; value: unknown } {
  const valueStart = topLevelValueStart(raw, key);
  if (valueStart < 0) return { found: false };
  const valueEnd = findJsonValueEnd(target, raw, valueStart);
  const valueText = raw.slice(valueStart, valueEnd).trim();

  try {
    return { found: true, value: JSON.parse(valueText) as unknown };
  } catch (error) {
    throw new Error(`JSON 文件损坏，无法解析：${target}。${describeFsError(error)}`);
  }
}

function hasTopLevelProperty(raw: string, key: string) {
  return topLevelValueStart(raw, key) >= 0;
}

function topLevelValueStart(raw: string, key: string) {
  const propertyIndex = raw.indexOf(`\n  "${key}":`);
  if (propertyIndex < 0) return -1;
  const colonIndex = raw.indexOf(":", propertyIndex);
  if (colonIndex < 0) return -1;

  let valueStart = colonIndex + 1;
  while (valueStart < raw.length && /\s/.test(raw[valueStart])) valueStart += 1;
  return valueStart < raw.length ? valueStart : -1;
}

function findJsonValueEnd(target: string, raw: string, start: number) {
  const first = raw[start];
  if (first === "\"") return findJsonStringEnd(target, raw, start);
  if (first === "{" || first === "[") return findJsonStructuredValueEnd(target, raw, start);

  let end = start;
  while (end < raw.length && raw[end] !== "," && raw[end] !== "\n" && raw[end] !== "\r" && raw[end] !== "}") {
    end += 1;
  }
  if (end === start) {
    throw new Error(`JSON 文件损坏，无法解析：${target}。字段值为空。`);
  }
  return end;
}

function findJsonStringEnd(target: string, raw: string, start: number) {
  let escaped = false;
  for (let index = start + 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") return index + 1;
  }
  throw new Error(`JSON 文件损坏，无法解析：${target}。字符串字段没有闭合。`);
}

function findJsonStructuredValueEnd(target: string, raw: string, start: number) {
  const stack = [raw[start] === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return index + 1;
    } else if (char === "}" || char === "]") {
      throw new Error(`JSON 文件损坏，无法解析：${target}。结构字段括号不匹配。`);
    }
  }

  throw new Error(`JSON 文件损坏，无法解析：${target}。结构字段没有闭合。`);
}

function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function describeFsError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "未知文件系统错误";
}

function toJobListItem(job: JobRecord): JobListItem {
  const { partialText, result, ...item } = job;
  return {
    ...item,
    error: item.error ? summarizeJobListText(item.error, 240) : undefined,
    events: item.events ? summarizeJobEvents(item.events) : undefined,
    inputSummary: item.inputSummary ? summarizeJobListText(item.inputSummary, 120) : undefined,
    message: summarizeJobListText(item.message, 160),
    hasPartialText: Boolean(partialText),
    hasResult: typeof result !== "undefined"
  };
}

function summarizeJobEvents(events: JobEvent[]) {
  return events.slice(-JOB_SUMMARY_EVENT_LIMIT);
}

function summarizeJobListText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function compareJobsByUpdatedAtDesc(left: JobRecord, right: JobRecord) {
  return +new Date(right.updatedAt) - +new Date(left.updatedAt);
}
