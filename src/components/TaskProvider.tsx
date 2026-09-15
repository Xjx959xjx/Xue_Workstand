"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { FeedbackInput } from "./FeedbackProvider";
import { useFeedback } from "./FeedbackProvider";
import {
  invalidateImageRecordsCache,
  cancelJob,
  getJob,
  getJobs,
  invalidateDouyinHotlistCache,
  invalidateDraftsCache,
  invalidateEngagementRecordsCache,
  invalidateGrossMarginLibraryCache,
  invalidateHotspotRadarCache,
  retryJob as retryJobRequest,
  startJob
} from "@/lib/client";
import { invalidateAccountDetail, invalidateProjectDetail } from "@/lib/detail-cache";
import { formatJobErrorMessage } from "@/lib/job-messages";
import { getJobResultHref } from "@/lib/job-links";
import { applyJobListResponse } from "@/lib/job-sync";
import type { JobKind, JobListItem, JobRecord, JobStartInput } from "@/lib/types";
import { useLibrary } from "./LibraryProvider";

type TaskContextValue = {
  jobs: JobRecord[];
  activeJobs: JobRecord[];
  recentJobs: JobRecord[];
  loading: boolean;
  error: string;
  refreshJobs: () => Promise<void>;
  startTask: (input: JobStartInput) => Promise<JobRecord>;
  cancelTask: (jobId: string) => Promise<JobRecord>;
  retryTask: (jobId: string) => Promise<JobRecord>;
};

const TaskContext = createContext<TaskContextValue | null>(null);
const NOTIFIED_STORAGE_KEY = "style-workbench-notified-jobs";
const WATCHED_STORAGE_KEY = "style-workbench-watched-jobs";
const TASKS_CHANGED_EVENT = "style-workbench:tasks-changed";
const ACTIVE_JOB_POLL_INTERVAL_MS = 1500;
const INITIAL_TASK_REFRESH_DELAY_MS = 1600;
const ROUTE_TASK_REFRESH_DELAY_MS = 800;

export function TaskProvider({ children, allowedKinds }: { children: React.ReactNode; allowedKinds?: JobKind[] }) {
  const pathname = usePathname();
  const { refresh } = useLibrary();
  const { notify } = useFeedback();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const jobsRef = useRef<JobRecord[]>([]);
  const cursorRef = useRef<string | undefined>(undefined);
  const firstLoadRef = useRef(true);
  const fullJobCacheRef = useRef<Map<string, JobRecord>>(new Map());
  const initialFailureShownRef = useRef(false);
  const notifiedRef = useRef<Set<string>>(new Set());
  const watchedRef = useRef<Set<string>>(new Set());
  const pendingRefreshRef = useRef(false);
  const pathnameRef = useRef(pathname);
  const previousStatusRef = useRef<Map<string, JobRecord["status"]>>(new Map());
  const previousDataRevisionRef = useRef<Map<string, number>>(new Map());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const hydrationErrorsRef = useRef<Map<string, string>>(new Map());
  const allowedKindKey = allowedKinds?.join("|") || "";

  useEffect(() => {
    notifiedRef.current = readNotifiedJobIds();
    watchedRef.current = readWatchedJobIds();
  }, []);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const refreshJobs = useCallback(async () => {
    if (refreshPromiseRef.current) {
      pendingRefreshRef.current = true;
      return refreshPromiseRef.current;
    }

    const run = async (): Promise<void> => {
      try {
        const data = await getJobs(cursorRef.current);
        cursorRef.current = data.cursor;
        const summaries = applyJobListResponse(jobsRef.current, data);
        for (const removedJobId of data.removedJobIds) {
          fullJobCacheRef.current.delete(removedJobId);
          hydrationErrorsRef.current.delete(removedJobId);
        }
        await hydrateTrackedJobs(
          summaries,
          previousStatusRef.current,
          fullJobCacheRef.current,
          hydrationErrorsRef.current,
          pathnameRef.current
        );
        pruneFullJobCache(fullJobCacheRef.current, summaries);

        const mergedJobs = mergeJobSummaries(
          summaries,
          fullJobCacheRef.current,
          hydrationErrorsRef.current,
          pathnameRef.current
        ).filter((job) => !allowedKindKey || allowedKindKey.split("|").includes(job.kind));
        jobsRef.current = mergedJobs;
        setJobs(mergedJobs);
        setError("");
        handleJobDataSync(
          mergedJobs,
          firstLoadRef.current,
          previousStatusRef.current,
          previousDataRevisionRef.current,
          refresh
        );
        handleJobNotifications(
          mergedJobs,
          firstLoadRef.current,
          notifiedRef.current,
          previousStatusRef.current,
          notify,
          initialFailureShownRef,
          watchedRef.current
        );
        firstLoadRef.current = false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "读取任务状态失败");
      } finally {
        setLoading(false);
      }

      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        return run();
      }
    };

    refreshPromiseRef.current = run().finally(() => {
      refreshPromiseRef.current = null;
    });
    return refreshPromiseRef.current;
  }, [allowedKindKey, notify, refresh]);

  useEffect(() => {
    const previousPathname = pathnameRef.current;
    pathnameRef.current = pathname;
    setJobs((current) => mergeJobSummaries(current, fullJobCacheRef.current, hydrationErrorsRef.current, pathname));
    if (previousPathname === pathname || firstLoadRef.current) return;

    const needsResultHydration = jobsRef.current.some((job, index) =>
      shouldHydrateJob(
        job as JobListItem,
        index,
        previousStatusRef.current,
        fullJobCacheRef.current,
        pathname
      )
    );
    if (!needsResultHydration) return;

    const timeoutId = window.setTimeout(() => {
      void refreshJobs();
    }, ROUTE_TASK_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [pathname, refreshJobs]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshJobs();
    }, INITIAL_TASK_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [refreshJobs]);

  useEffect(() => {
    const onTasksChanged = () => {
      void refreshJobs();
    };
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
  }, [refreshJobs]);

  useEffect(() => {
    const onFocus = () => {
      void refreshJobs();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshJobs();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshJobs]);

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running"),
    [jobs]
  );
  const hasActiveJobs = activeJobs.length > 0;

  // Active jobs continue running in the server process, so keep polling until they settle.
  useEffect(() => {
    if (!hasActiveJobs) return;

    let stopped = false;
    let timeoutId: number | undefined;

    const poll = async () => {
      try {
        await refreshJobs();
      } finally {
        if (stopped) return;
        timeoutId = window.setTimeout(() => {
          void poll();
        }, ACTIVE_JOB_POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [hasActiveJobs, refreshJobs]);

  const startTask = useCallback(
    async (input: JobStartInput) => {
      try {
        const result = await startJob(input);
        watchedRef.current.add(result.job.id);
        persistWatchedJobIds(watchedRef.current);
        setError("");
        emitTasksChanged();
        await refreshJobs();
        return result.job;
      } catch (err) {
        setError(err instanceof Error ? err.message : "启动后台任务失败");
        throw err;
      }
    },
    [refreshJobs]
  );

  const cancelTask = useCallback(async (jobId: string) => {
    const result = await cancelJob(jobId);
    emitTasksChanged();
    await refreshJobs();
    return result.job;
  }, [refreshJobs]);

  const retryTask = useCallback(async (jobId: string) => {
    try {
      const result = await retryJobRequest(jobId);
      watchedRef.current.add(result.job.id);
      persistWatchedJobIds(watchedRef.current);
      setError("");
      emitTasksChanged();
      await refreshJobs();
      return result.job;
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试后台任务失败");
      throw err;
    }
  }, [refreshJobs]);

  const value = useMemo(
    () => ({
      jobs,
      activeJobs,
      recentJobs: jobs.slice(0, 12),
      loading,
      error,
      refreshJobs,
      startTask,
      cancelTask,
      retryTask
    }),
    [activeJobs, cancelTask, error, jobs, loading, refreshJobs, retryTask, startTask]
  );

  return (
    <TaskContext.Provider value={value}>
      {children}
    </TaskContext.Provider>
  );
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (!context) throw new Error("useTasks must be used inside TaskProvider");
  return context;
}

export function useOptionalTasks() {
  return useContext(TaskContext);
}

type UseScopedTasksOptions = {
  href?: string;
  kinds?: JobKind[];
  includeRecent?: boolean;
};

export function useScopedTasks(options: UseScopedTasksOptions = {}) {
  const context = useContext(TaskContext);
  const kindKey = options.kinds?.join("|") || "";
  const kindSet = useMemo(() => (kindKey ? new Set(kindKey.split("|") as JobKind[]) : null), [kindKey]);
  const includeRecent = options.includeRecent ?? true;
  const scopedJobs = useMemo(
    () => (context?.jobs ?? []).filter((job) => isJobInScope(job, options.href, kindSet)),
    [context?.jobs, kindSet, options.href]
  );

  const scopedContext = useMemo(() => {
    if (!context) return null;
    const activeJobs = scopedJobs.filter((job) => isActiveJob(job));
    return {
      jobs: scopedJobs,
      activeJobs,
      recentJobs: includeRecent ? scopedJobs.slice(0, 12) : activeJobs,
      loading: context.loading,
      error: context.error,
      refreshJobs: context.refreshJobs,
      startTask: context.startTask,
      cancelTask: context.cancelTask,
      retryTask: context.retryTask
    };
  }, [context, includeRecent, scopedJobs]);

  if (!scopedContext) throw new Error("useScopedTasks must be used inside TaskProvider");
  return scopedContext;
}

function handleJobDataSync(
  jobs: JobRecord[],
  isFirstLoad: boolean,
  previousStatus: Map<string, JobRecord["status"]>,
  previousDataRevision: Map<string, number>,
  refreshLibrary: (options?: { force?: boolean }) => Promise<void>
) {
  let libraryChanged = false;
  const nextDataRevision = new Map<string, number>();

  for (const job of jobs) {
    const dataRevision = job.dataRevision || 0;
    nextDataRevision.set(job.id, dataRevision);
    const dataChanged = dataRevision > (previousDataRevision.get(job.id) || 0);
    const becameCompleted = job.status === "completed" && previousStatus.get(job.id) !== "completed";
    const recentCompletedOnFirstLoad = isFirstLoad && job.status === "completed" && isRecentJob(job);
    if (!dataChanged && !becameCompleted && !recentCompletedOnFirstLoad) continue;
    libraryChanged = invalidateJobClientCaches(job) || libraryChanged;
  }

  previousDataRevision.clear();
  nextDataRevision.forEach((revision, jobId) => previousDataRevision.set(jobId, revision));
  if (libraryChanged) void refreshLibrary({ force: true });
}

function invalidateJobClientCaches(job: JobRecord) {
  if (job.kind === "image-generation") invalidateImageRecordsCache();
  if (job.dataChange?.resource === "douyin-hotlist" || job.kind === "hotlist-refresh") {
    invalidateDouyinHotlistCache();
  }
  if (job.dataChange?.resource === "gross-margin" || job.kind === "gross-margin-refresh") {
    invalidateGrossMarginLibraryCache();
  }
  if (job.kind === "hotspot-refresh") invalidateHotspotRadarCache();
  if (job.kind === "write-copy") invalidateDraftsCache();
  if (job.kind === "engagement") {
    invalidateEngagementRecordsCache();
    if (job.scope?.draftId) invalidateDraftsCache();
  }
  if (job.kind === "project-style") invalidateProjectDetail(job.scope?.projectId);

  const updatesAccount =
    job.dataChange?.resource === "library-account" ||
    job.kind === "account-style" ||
    job.kind === "transcribe-video" ||
    job.kind === "batch-transcribe" ||
    job.kind === "collect-account";
  if (updatesAccount) {
    const platform = job.scope?.platform;
    const accountId = job.dataChange?.accountId || job.scope?.accountId;
    if (platform && accountId) invalidateAccountDetail(platform, accountId);
    else invalidateAccountDetail();
  }

  return updatesAccount || job.kind === "write-copy" || job.kind === "project-style" || job.kind === "engagement";
}

function handleJobNotifications(
  jobs: JobRecord[],
  isFirstLoad: boolean,
  notified: Set<string>,
  previousStatus: Map<string, JobRecord["status"]>,
  notify: (input: FeedbackInput) => void,
  initialFailureShown: React.MutableRefObject<boolean>,
  watched: Set<string>
) {
  const nextStatus = new Map<string, JobRecord["status"]>();

  for (const job of jobs) {
    nextStatus.set(job.id, job.status);
    if (isFirstLoad) {
      const watchedTerminalJob = isTerminalJob(job) && watched.has(job.id) && !notified.has(job.id);
      if (watchedTerminalJob) {
        notifyJob(job, notify);
      } else if (
        job.status === "failed" &&
        isRecentJob(job) &&
        !notified.has(job.id) &&
        !initialFailureShown.current
      ) {
        initialFailureShown.current = true;
        notifyJob(job, notify);
      }
      if (isTerminalJob(job)) {
        notified.add(job.id);
        watched.delete(job.id);
      }
      continue;
    }

    const previous = previousStatus.get(job.id);
    const becameTerminal = isTerminalJob(job) && previous !== job.status;
    if (!becameTerminal || notified.has(job.id)) continue;

    notified.add(job.id);
    persistNotifiedJobIds(notified);
    watched.delete(job.id);
    persistWatchedJobIds(watched);
    notifyJob(job, notify);
  }

  previousStatus.clear();
  nextStatus.forEach((status, jobId) => previousStatus.set(jobId, status));
  if (isFirstLoad) {
    persistNotifiedJobIds(notified);
    persistWatchedJobIds(watched);
  }
}

function isTerminalJob(job: JobRecord) {
  return job.status === "completed" || job.status === "failed" || job.status === "cancelled" || job.status === "interrupted";
}

function isActiveJob(job: JobRecord | JobListItem) {
  return job.status === "queued" || job.status === "running";
}

function isRecentJob(job: Pick<JobRecord, "completedAt" | "updatedAt" | "createdAt">) {
  const time = Date.parse(job.completedAt || job.updatedAt || job.createdAt);
  return Number.isFinite(time) && Date.now() - time < 15 * 60 * 1000;
}

async function hydrateTrackedJobs(
  jobs: JobListItem[],
  previousStatus: Map<string, JobRecord["status"]>,
  cache: Map<string, JobRecord>,
  hydrationErrors: Map<string, string>,
  pathname: string
) {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const jobIds = jobs
    .filter((job, index) => shouldHydrateJob(job, index, previousStatus, cache, pathname))
    .map((job) => job.id);
  if (!jobIds.length) return;

  const fullJobs = await Promise.all(
    [...new Set(jobIds)].map(async (jobId) => {
      try {
        const job = (await getJob(jobId)).job;
        hydrationErrors.delete(jobId);
        return job;
      } catch (err) {
        const summary = jobsById.get(jobId);
        if (summary && shouldExposeHydrationError(summary)) {
          hydrationErrors.set(jobId, formatHydrationError(err));
        }
        return null;
      }
    })
  );

  for (const job of fullJobs) {
    if (job) cache.set(job.id, job);
  }
}

function shouldHydrateJob(
  job: JobListItem,
  index: number,
  previousStatus: Map<string, JobRecord["status"]>,
  cache: Map<string, JobRecord>,
  pathname: string
) {
  const relevantToCurrentPage = isJobRelevantToPath(job, pathname);
  const needsFullJob = Boolean(job.hasResult || job.hasPartialText);
  if (isActiveJob(job)) return relevantToCurrentPage && needsFullJob;
  if (!isTerminalJob(job)) return false;
  if (!relevantToCurrentPage || !needsFullJob) return false;
  const previous = previousStatus.get(job.id);
  if (previous && previous !== job.status) return true;
  const cachedJob = cache.get(job.id);
  if (cachedJob?.status === job.status && (!job.hasResult || typeof cachedJob.result !== "undefined")) return false;
  return shouldHydrateRecentTerminalJob(job, index, pathname);
}

function shouldHydrateRecentTerminalJob(job: JobListItem, index: number, pathname: string) {
  void pathname;
  return index < 12 && isRecentJob(job);
}

function shouldExposeHydrationError(job: JobListItem) {
  return job.status === "completed" && Boolean(job.hasResult);
}

function formatHydrationError(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  return `任务已完成，但读取生成结果失败${message ? `：${formatJobErrorMessage(message)}。` : "。"}请刷新任务中心后重试。`;
}

function isJobRelevantToPath(job: JobListItem, pathname: string) {
  return isJobRelevantToHref(job, pathname);
}

function isJobRelevantToHref(job: Pick<JobRecord, "kind" | "href" | "resultRef">, targetHref: string) {
  const relevantHref = job.resultRef?.href || job.href || defaultJobHref(job.kind);
  if (!relevantHref) return false;
  const jobPath = relevantHref.split("?")[0] || "/";
  const targetPath = targetHref.split("?")[0] || "/";
  if (jobPath === "/") return targetPath === "/";
  return targetPath === jobPath || targetPath.startsWith(`${jobPath}/`);
}

function isJobInScope(job: JobListItem, href: string | undefined, kinds: Set<JobKind> | null) {
  if (kinds && !kinds.has(job.kind)) return false;
  if (href && !isJobRelevantToHref(job, href)) return false;
  return true;
}

function defaultJobHref(kind: JobRecord["kind"]) {
  if (kind === "image-generation") return "/images";
  if (kind === "write-copy") return "/writer";
  if (kind === "project-style") return "/project-workbench";
  if (kind === "engagement") return "/assets";
  if (kind === "hotlist-refresh") return "/douyin-hotlist";
  if (kind === "collect-account") return "/library";
  if (kind === "single-video-transcribe" || kind === "publish-copy") return "/tools";
  if (kind === "hotspot-refresh") return "/hotspots";
  if (kind === "gross-margin-refresh") return "/gross-margin/monitor";
  return "/library";
}

function mergeJobSummaries(
  jobs: JobListItem[],
  cache: Map<string, JobRecord>,
  hydrationErrors: Map<string, string>,
  pathname: string
) {
  return jobs.map((job) => {
    const hydrationError = hydrationErrors.get(job.id);
    const fullJob = cache.get(job.id);
    if (fullJob) {
      const mergedJob = { ...fullJob, ...job };
      return hydrationError ? { ...mergedJob, error: hydrationError, message: hydrationError } : mergedJob;
    }
    if (isJobRelevantToPath(job, pathname)) {
      if (hydrationError) return { ...job, error: hydrationError, message: hydrationError };
      return job;
    }
    return { ...job, partialText: undefined, result: undefined };
  });
}

function pruneFullJobCache(cache: Map<string, JobRecord>, jobs: JobListItem[]) {
  const keepIds = new Set(jobs.slice(0, 20).map((job) => job.id));
  for (const jobId of cache.keys()) {
    if (!keepIds.has(jobId)) cache.delete(jobId);
  }
}

function notifyJob(job: JobRecord, notify: (input: FeedbackInput) => void) {
  if (job.status === "cancelled") return;
  const hydrationFailed = job.status === "completed" && Boolean(job.error) && Boolean((job as { hasResult?: boolean }).hasResult);
  const failed = job.status === "failed" || hydrationFailed;
  const partialFailure = !failed && hasPartialRefreshFailure(job);
  const resultHref = getJobResultHref(job);
  notify({
    tone: failed ? "error" : partialFailure ? "warning" : "success",
    title: hydrationFailed ? "任务结果同步失败" : failed ? `${job.title}失败` : partialFailure ? `${job.title}部分完成` : `${job.title}完成`,
    message: failed ? formatJobErrorMessage(job.error || job.message) : job.message,
    durationMs: failed || partialFailure ? 15000 : resultHref ? 10000 : 5000,
    action:
      resultHref
        ? {
            label: job.resultRef?.label || (failed ? "查看任务" : "查看结果"),
            href: resultHref
          }
        : undefined
  });
}

function hasPartialRefreshFailure(job: JobRecord) {
  if (job.kind !== "hotlist-refresh" || job.status !== "completed" || !job.result || typeof job.result !== "object") return false;
  const refresh = (job.result as { refresh?: { failed?: unknown } }).refresh;
  return typeof refresh?.failed === "number" && refresh.failed > 0;
}

function readNotifiedJobIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NOTIFIED_STORAGE_KEY) || "[]") as string[];
    return new Set(parsed.filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

function persistNotifiedJobIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify([...ids].slice(-80)));
}

function readWatchedJobIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(WATCHED_STORAGE_KEY) || "[]") as string[];
    return new Set(parsed.filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

function persistWatchedJobIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(WATCHED_STORAGE_KEY, JSON.stringify([...ids].slice(-20)));
}

function emitTasksChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}
