import { promises as fs } from "fs";
import path from "path";
import {
  completePreparedAccountStyle,
  completePreparedWriteCopy,
  prepareAccountStyleContext,
  prepareWriteCopyContext,
  saveAndGenerateProjectStyleProfile,
  streamResponseTextWithFallback
} from "./ai";
import { runBatchTranscribe } from "./batch-transcribe";
import { generateEngagement } from "./engagement";
import { libraryRoot } from "./storage";
import { transcribeVideo } from "./transcription";
import {
  BatchTranscribeResult,
  EngagementRecord,
  JobKind,
  JobRecord,
  JobStartInput,
  WriteResult
} from "./types";
import { nowIso, safeSegment, shortHash } from "./utils";

type JobRuntime = {
  initialized: boolean;
  active: Map<string, Promise<void>>;
};

const globalJobs = globalThis as typeof globalThis & {
  __styleWorkbenchJobs?: JobRuntime;
};

const runtime =
  globalJobs.__styleWorkbenchJobs ||
  (globalJobs.__styleWorkbenchJobs = {
    initialized: false,
    active: new Map()
  });

const jobWriteQueues = new Map<string, Promise<unknown>>();

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
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(target: string, value: unknown) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, target);
}

async function writeJob(job: JobRecord) {
  await writeJson(jobJsonPath(job.id), job);
}

async function patchJob(jobId: string, patch: Partial<JobRecord>) {
  return enqueueJobWrite(jobId, async () => {
    const current = await getJob(jobId);
    const next: JobRecord = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    await writeJob(next);
    return next;
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
  runtime.initialized = true;
  await ensureJobs();

  const jobs = await listJobsFromDisk();
  await Promise.all(
    jobs
      .filter((job) => (job.status === "running" || job.status === "queued") && !runtime.active.has(job.id))
      .map((job) =>
        writeJob({
          ...job,
          status: "interrupted",
          progress: job.progress || 0,
          message: "开发服务器重启后任务已中断，请重新发起。",
          error: "任务已中断，请重新发起。",
          updatedAt: nowIso(),
          completedAt: nowIso()
        })
      )
  );
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
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

export async function listJobs() {
  await ensureInitialized();
  return listJobsFromDisk();
}

export async function getJob(jobId: string) {
  await ensureInitialized();
  await ensureJobs();
  const job = await readJson<JobRecord>(jobJsonPath(jobId));
  if (!job) throw new Error("找不到任务记录");
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
    stage: "queued",
    message: "任务已加入队列",
    progress: 0,
    href: input.href || defaultHref(input),
    createdAt: now,
    updatedAt: now
  };

  await writeJob(job);
  startBackgroundJob(job.id, input);
  return job;
}

function startBackgroundJob(jobId: string, input: JobStartInput) {
  if (runtime.active.has(jobId)) return;

  const promise = runJob(jobId, input).finally(() => {
    runtime.active.delete(jobId);
  });
  runtime.active.set(jobId, promise);
}

async function runJob(jobId: string, input: JobStartInput) {
  try {
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
    await patchJob(jobId, {
      status: "failed",
      progress: 100,
      stage: "failed",
      message: "任务失败",
      error: error instanceof Error ? error.message : "任务失败，请稍后重试。",
      completedAt: nowIso()
    });
  }
}

async function runWriteCopyJob(jobId: string, start: Extract<JobStartInput, { kind: "write-copy" }>) {
  let partialText = "";
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

  const prepared = await prepareWriteCopyContext(start.input);

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
    onDelta(delta) {
      partialText += delta;
      void patchJob(jobId, {
        stage: "generate",
        message: "正在生成文案",
        progress: Math.min(86, 60 + Math.floor(partialText.length / 120)),
        partialText
      });
    }
  });

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
      message: "正在保存草稿",
      progress: 88
    });
  }

  const finalResult = await completePreparedWriteCopy({
    prepared,
    result,
    save: start.input.save
  });

  await completeJob(jobId, {
    message: "文案生成完成",
    result: finalResult,
    partialText: finalResult.content,
    resultRef: writeResultRef(finalResult)
  });
}

async function runAccountStyleJob(jobId: string, start: Extract<JobStartInput, { kind: "account-style" }>) {
  let partialText = "";
  await patchJob(jobId, {
    stage: "prepare",
    message: "正在读取账号转写样本",
    progress: 12
  });
  const context = await prepareAccountStyleContext(start.input.platform, start.input.accountId);

  await patchJob(jobId, {
    stage: "generate",
    message: "正在生成账号风格卡",
    progress: 35
  });
  const result = await streamResponseTextWithFallback({
    messages: context.messages,
    maxOutputTokens: 3200,
    onDelta(delta) {
      partialText += delta;
      void patchJob(jobId, {
        stage: "generate",
        message: "正在生成账号风格卡",
        progress: Math.min(88, 45 + Math.floor(partialText.length / 90)),
        partialText
      });
    }
  });

  await patchJob(jobId, {
    stage: "save",
    message: "正在写入账号风格卡",
    progress: 90
  });
  const saved = await completePreparedAccountStyle(context, result);
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
  await patchJob(jobId, {
    stage: "validate",
    message: "正在校验项目配置",
    progress: 15
  });
  if (!start.input.sourceAccountIds.length) {
    throw new Error("请至少选择一个参考账号后再总结项目风格");
  }

  await patchJob(jobId, {
    stage: "generate",
    message: "正在保存项目并读取参考样本",
    progress: 45
  });
  const result = await saveAndGenerateProjectStyleProfile(start.input);

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
      href: "/projects",
      label: "查看项目库"
    }
  });
}

async function runTranscribeVideoJob(jobId: string, start: Extract<JobStartInput, { kind: "transcribe-video" }>) {
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
  const result = await transcribeVideo(start.input);

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
  const result = await runBatchTranscribe(start.input, {
    onPrepare() {
      void patchJob(jobId, {
        stage: "prepare",
        message: "正在读取账号和候选视频",
        progress: 8
      });
    },
    onMediaPreloadStart({ total }) {
      void patchJob(jobId, {
        stage: "media-preload",
        message: `正在预取 ${total} 条抖音视频的媒体地址`,
        progress: 12
      });
    },
    onVideoStart({ index, total, video }) {
      const progress = total ? 18 + Math.round((index / total) * 64) : 70;
      void patchJob(jobId, {
        stage: "transcribe",
        message: `正在处理第 ${index + 1}/${total} 条视频：${video.title}`,
        progress
      });
    },
    onVideoResult(video) {
      void patchJob(jobId, {
        message: `已处理：${video.title}`,
        result: { latestVideo: video }
      });
    },
    onStyleStart() {
      void patchJob(jobId, {
        stage: "style",
        message: "正在更新账号风格卡",
        progress: 88
      });
    },
    onFinalize() {
      void patchJob(jobId, {
        stage: "finalize",
        message: "正在整理转写结果",
        progress: 98
      });
    }
  });

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
  const result = await generateEngagement(start.input);

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
  });
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

function defaultHref(input: JobStartInput) {
  if (input.kind === "write-copy") return "/writer";
  if (input.kind === "account-style" || input.kind === "transcribe-video" || input.kind === "batch-transcribe") return "/library";
  if (input.kind === "project-style") return "/projects";
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
    href: `/drafts?draftId=${encodeURIComponent(result.draft.id)}`,
    label: "查看草稿"
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
