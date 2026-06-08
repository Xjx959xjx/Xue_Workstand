import { promises as fs } from "fs";
import path from "path";
import {
  completeCachedAccountStyle,
  completePreparedAccountStyle,
  completePreparedWriteCopy,
  prepareAccountStyleContext,
  prepareWriteCopyContext,
  saveAndGenerateProjectStyleProfile,
  streamResponseTextWithFallback
} from "./ai";
import { runBatchTranscribe } from "./batch-transcribe";
import { buildWriterDraftHref } from "./draft-links";
import { generateEngagement } from "./engagement";
import { hasFeishuDocLink } from "./feishu";
import { engagementSourceKey, writeCopySourceKey } from "./job-scope";
import { libraryRoot } from "./storage";
import { readJsonFile, writeJsonFile } from "./storage/fs";
import { transcribeVideo } from "./transcription";
import {
  BatchTranscribeResult,
  EngagementRecord,
  JobEvent,
  JobKind,
  JobListItem,
  JobRecord,
  JobScope,
  JobStartInput,
  WriteResult
} from "./types";
import { nowIso, safeSegment, shortHash } from "./utils";

type JobRuntime = {
  initialized: boolean;
  initializing?: Promise<void>;
  active: Map<string, Promise<void>>;
  abortControllers: Map<string, AbortController>;
  cancelRequests: Set<string>;
  pending: Map<string, JobStartInput>;
  records: Map<string, JobRecord>;
};

type PatchJobOptions = {
  persist?: boolean;
  beforePatch?: (current: JobRecord) => void;
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
    return existing;
  }

  const created: JobRuntime = {
    initialized: false,
    active: new Map(),
    abortControllers: new Map(),
    cancelRequests: new Set(),
    pending: new Map(),
    records: new Map()
  };
  globalJobs.__styleWorkbenchJobs = created;
  return created;
})();

const jobWriteQueues = new Map<string, Promise<unknown>>();
const PARTIAL_TEXT_PATCH_INTERVAL_MS = 250;
const PARTIAL_TEXT_PATCH_CHARS = 160;
const DEFAULT_MAX_ACTIVE_JOBS = 2;
const DEFAULT_JOB_HISTORY_LIMIT = 200;

function jobsPath() {
  return path.join(libraryRoot(), "jobs");
}

function jobJsonPath(jobId: string) {
  return path.join(jobsPath(), `${normalizeJobId(jobId)}.json`);
}

function normalizeJobId(jobId: string) {
  return safeSegment(jobId.trim());
}

async function ensureJobs() {
  await fs.mkdir(jobsPath(), { recursive: true });
}

async function readJson<T>(target: string): Promise<T | null> {
  return readJsonFile<T>(target);
}

async function writeJson(target: string, value: unknown) {
  return writeJsonFile(target, value);
}

async function writeJob(job: JobRecord, options: PatchJobOptions = {}) {
  runtime.records.set(job.id, job);
  if (options.persist === false) return;
  await writeJson(jobJsonPath(job.id), job);
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
    return next;
  });
}

function patchTransientJob(jobId: string, patch: Partial<JobRecord>) {
  return patchJob(jobId, patch, { persist: false });
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
  await ensureJobs();

  const jobs = await listJobsFromDisk();
  const records = new Map(runtime.records);
  for (const job of jobs) {
    if (!records.has(job.id)) records.set(job.id, job);
  }
  runtime.records = records;

  const interruptedAt = nowIso();
  await Promise.all(
    [...runtime.records.values()]
      .filter((job) => (job.status === "running" || job.status === "queued") && !runtime.active.has(job.id))
      .map((job) =>
        writeJob({
          ...job,
          status: "interrupted",
          progress: job.progress || 0,
          message: "开发服务器重启后任务已中断，请重新发起。",
          error: "任务已中断，请重新发起。",
          updatedAt: interruptedAt,
          completedAt: interruptedAt
        })
      )
  );
  runtime.initialized = true;
}

async function listJobsFromDisk() {
  await ensureJobs();
  const files = await fs.readdir(jobsPath()).catch(() => []);
  const jobs = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJson<JobRecord>(path.join(jobsPath(), file)))
  );
  return jobs
    .filter((job): job is JobRecord => Boolean(job))
    .sort(compareJobsByUpdatedAtDesc);
}

export async function listJobs() {
  await ensureInitialized();
  return [...runtime.records.values()].sort(compareJobsByUpdatedAtDesc);
}

export async function listJobSummaries() {
  const jobs = await listJobs();
  return jobs.map(toJobListItem);
}

export async function getJob(jobId: string) {
  await ensureInitialized();
  const cached = runtime.records.get(jobId);
  if (cached) return cached;

  const job = await readJson<JobRecord>(jobJsonPath(jobId));
  if (!job) throw new Error("找不到任务记录");
  runtime.records.set(job.id, job);
  return job;
}

export async function createJob(input: JobStartInput) {
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

  await writeJob(job);
  queueBackgroundJob(job.id, input);
  return job;
}

function queueBackgroundJob(jobId: string, input: JobStartInput) {
  if (runtime.active.has(jobId) || runtime.pending.has(jobId)) return;
  runtime.pending.set(jobId, input);
  pumpJobQueue();
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
    await patchJob(jobId, {
      status: "running",
      stage: "start",
      message: "任务正在运行",
      progress: 3
    });

    if (input.kind === "write-copy") {
      await runWriteCopyJob(jobId, input);
    } else if (input.kind === "account-style") {
      await runAccountStyleJob(jobId, input);
    } else if (input.kind === "project-style") {
      await runProjectStyleJob(jobId, input);
    } else if (input.kind === "transcribe-video") {
      await runTranscribeVideoJob(jobId, input);
    } else if (input.kind === "batch-transcribe") {
      await runBatchTranscribeJob(jobId, input);
    } else {
      await runEngagementJob(jobId, input);
    }
  } catch (error) {
    if (isCancelledJobError(error, controller.signal)) {
      const current = runtime.records.get(jobId) || (await readJson<JobRecord>(jobJsonPath(jobId)));
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

async function runWriteCopyJob(jobId: string, start: Extract<JobStartInput, { kind: "write-copy" }>) {
  throwIfCancelled(jobId);
  let partialText = "";
  const partialUpdater = createPartialTextUpdater(jobId, {
    stage: "generate",
    message: "正在生成文案",
    progress(text) {
      return Math.min(86, 60 + Math.floor(text.length / 120));
    }
  });
  await patchJob(jobId, {
    stage: "prepare",
    message: "正在读取风格卡和代表样本",
    progress: 10
  });

  if (start.input.mode === "rewrite" && /https?:\/\//i.test(start.input.sourceText || "")) {
    await patchJob(jobId, {
      stage: "transcribe-links",
      message: "正在转写链接里的视频文稿",
      progress: 18
    });
  }

  if (hasFeishuDocLink(start.input.supportDocLinks)) {
    await patchJob(jobId, {
      stage: "fetch-support-docs",
      message: "正在读取商单支持文档",
      progress: 24
    });
  }

  const prepared = await prepareWriteCopyContext(start.input, { signal: getJobAbortSignal(jobId) });
  throwIfCancelled(jobId);

  if (start.input.useWebResearch) {
    await patchJob(jobId, {
      stage: "research",
      message: prepared.research?.startsWith("联网资料：模型联网暂时不可用")
        ? "联网检索暂不可用，正在继续生成"
        : "联网检索已完成，正在整理资料",
      progress: 35,
      result: prepared.research ? { research: prepared.research } : undefined
    });
  }

  await patchJob(jobId, {
    stage: "generate",
    message: "正在生成文案",
    progress: 55
  });

  const result = await streamResponseTextWithFallback({
    messages: prepared.messages,
    signal: getJobAbortSignal(jobId),
    onDelta(delta) {
      partialText += delta;
      partialUpdater.update(partialText);
    }
  });
  await partialUpdater.flush(partialText);
  throwIfCancelled(jobId);

  if (!result.text.trim()) {
    await patchJob(jobId, {
      stage: "fallback",
      message: "正在切换到本地模板",
      progress: 76
    });
  }

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
    message: "文案生成完成",
    result: finalResult,
    partialText: finalResult.content,
    resultRef: writeResultRef(finalResult)
  });
}

async function runAccountStyleJob(jobId: string, start: Extract<JobStartInput, { kind: "account-style" }>) {
  throwIfCancelled(jobId);
  let partialText = "";
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
  const context = await prepareAccountStyleContext(start.input.platform, start.input.accountId);
  throwIfCancelled(jobId);
  const cached = completeCachedAccountStyle(context);
  if (cached) {
    await patchJob(jobId, {
      stage: "cache",
      message: "样本未变化，已复用现有风格卡",
      progress: 95,
      partialText: cached.style
    });
    await completeJob(jobId, {
      message: "账号风格卡已复用",
      result: cached,
      partialText: cached.style,
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
  const result = await streamResponseTextWithFallback({
    messages: context.messages,
    maxOutputTokens: 3200,
    signal: getJobAbortSignal(jobId),
    onDelta(delta) {
      partialText += delta;
      partialUpdater.update(partialText);
    }
  });
  await partialUpdater.flush(partialText);
  throwIfCancelled(jobId);

  await patchJob(jobId, {
    stage: "save",
    message: "正在写入账号风格卡",
    progress: 90
  });
  const saved = await completePreparedAccountStyle(context, result);
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
    stage: "generate",
    message: "正在保存项目并读取参考样本",
    progress: 45
  });
  const result = await saveAndGenerateProjectStyleProfile(start.input, { signal: getJobAbortSignal(jobId) });
  throwIfCancelled(jobId);

  await patchJob(jobId, {
    stage: "finalize",
    message: "正在写入项目风格卡",
    progress: 92
  });
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
  await patchJob(jobId, {
    stage: "generate",
    message: "正在生成评论和弹幕",
    progress: 48
  });
  const result = await generateEngagement(start.input, { signal: getJobAbortSignal(jobId) });
  throwIfCancelled(jobId);

  await completeJob(jobId, {
    message: buildEngagementSuccessMessage(result.record),
    result,
    resultRef: {
      id: result.record.id,
      href: start.input.sourceType === "draft" ? `/assets?draftId=${encodeURIComponent(start.input.draftId)}` : "/assets",
      label: "查看评论生成"
    }
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
  await pruneJobHistory();
  pumpJobQueue();
  return next;
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
  if (input.kind === "write-copy") return "生成文案";
  if (input.kind === "account-style") return "生成账号风格卡";
  if (input.kind === "project-style") return "生成项目风格卡";
  if (input.kind === "transcribe-video") return "转写视频";
  if (input.kind === "batch-transcribe") return input.input.updateStyle ? "批量转写并更新风格" : "批量转写";
  return "生成评论素材";
}

function defaultInputSummary(input: JobStartInput) {
  if (input.kind === "write-copy") return input.input.mode === "topic" ? "主题写作" : "文案改写";
  if (input.kind === "account-style") return input.input.accountId;
  if (input.kind === "project-style") return input.input.name;
  if (input.kind === "transcribe-video") return input.input.videoId;
  if (input.kind === "batch-transcribe") return `${input.input.accountId} · ${input.input.limit === "all" ? "全部视频" : `${input.input.limit} 条视频`}`;
  if (input.input.sourceType === "draft") return "从草稿生成";
  if (input.input.sourceType === "url") return "从链接生成";
  return input.input.title || "从粘贴文案生成";
}

function defaultJobScope(input: JobStartInput): JobScope {
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
  if (input.input.sourceType === "draft") {
    return compactJobScope({
      targetType: "draft",
      draftId: input.input.draftId
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
  if (input.kind === "write-copy") return "/writer";
  if (input.kind === "account-style" || input.kind === "transcribe-video" || input.kind === "batch-transcribe") return "/library";
  if (input.kind === "project-style") return "/project-workbench";
  return "/assets";
}

function writeResultRef(result: WriteResult) {
  if (!result.draft) {
    return {
      href: "/writer",
      label: "查看写作台"
    };
  }

  return {
    id: result.draft.id,
    href: buildWriterDraftHref(result.draft),
    label: "查看历史"
  };
}

function summarizeBatchResult(result: BatchTranscribeResult) {
  return `批量转写完成：新增 ${result.completed}，跳过 ${result.skipped}，失败 ${result.failed}`;
}

function buildEngagementSuccessMessage(record: EngagementRecord) {
  const commentCount = record.comments?.items.length || 0;
  const danmakuCount = record.danmaku?.items.length || 0;
  if (commentCount && danmakuCount) return `已生成 ${commentCount} 条评论和 ${danmakuCount} 条弹幕`;
  if (commentCount) return `已生成 ${commentCount} 条评论`;
  return `已生成 ${danmakuCount} 条弹幕`;
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

async function pruneJobHistory() {
  const limit = jobHistoryLimit();
  const jobs = [...runtime.records.values()].sort(compareJobsByUpdatedAtDesc);
  const keep = new Set(jobs.slice(0, limit).map((job) => job.id));
  const removable = jobs.filter((job) => !keep.has(job.id) && isTerminalJob(job));
  if (!removable.length) return;

  await Promise.all(
    removable.map(async (job) => {
      runtime.records.delete(job.id);
      runtime.pending.delete(job.id);
      await fs.rm(jobJsonPath(job.id), { force: true }).catch(() => undefined);
    })
  );
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

function toJobListItem(job: JobRecord): JobListItem {
  const { partialText, result, ...item } = job;
  return {
    ...item,
    error: item.error ? summarizeJobListText(item.error, 240) : undefined,
    inputSummary: item.inputSummary ? summarizeJobListText(item.inputSummary, 120) : undefined,
    message: summarizeJobListText(item.message, 160),
    hasPartialText: Boolean(partialText),
    hasResult: typeof result !== "undefined"
  };
}

function summarizeJobListText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function compareJobsByUpdatedAtDesc(left: JobRecord, right: JobRecord) {
  return +new Date(right.updatedAt) - +new Date(left.updatedAt);
}
