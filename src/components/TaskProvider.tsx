"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { FeedbackInput } from "./FeedbackProvider";
import { useFeedback } from "./FeedbackProvider";
import { cancelJob, getJob, getJobs, startJob } from "@/lib/client";
import { formatJobErrorMessage } from "@/lib/job-messages";
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
};

const TaskContext = createContext<TaskContextValue | null>(null);
const NOTIFIED_STORAGE_KEY = "style-workbench-notified-jobs";
const TASKS_CHANGED_EVENT = "style-workbench:tasks-changed";
const ACTIVE_JOB_POLL_INTERVAL_MS = 1500;
const INITIAL_TASK_REFRESH_DELAY_MS = 1600;

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { refresh } = useLibrary();
  const { notify } = useFeedback();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const firstLoadRef = useRef(true);
  const fullJobCacheRef = useRef<Map<string, JobRecord>>(new Map());
  const initialFailureShownRef = useRef(false);
  const notifiedRef = useRef<Set<string>>(new Set());
  const pendingRefreshRef = useRef(false);
  const pathnameRef = useRef(pathname);
  const previousStatusRef = useRef<Map<string, JobRecord["status"]>>(new Map());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const hydrationErrorsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    notifiedRef.current = readNotifiedJobIds();
  }, []);

  const refreshJobs = useCallback(async () => {
    if (refreshPromiseRef.current) {
      pendingRefreshRef.current = true;
      return refreshPromiseRef.current;
    }

    const run = async (): Promise<void> => {
      try {
        const data = await getJobs();
        const summaries = data.jobs;
        await hydrateTrackedJobs(
          summaries,
          firstLoadRef.current,
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
        );
        setJobs(mergedJobs);
        setError("");
        handleJobNotifications(
          mergedJobs,
          firstLoadRef.current,
          notifiedRef.current,
          previousStatusRef.current,
          notify,
          refresh,
          initialFailureShownRef
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
  }, [notify, refresh]);

  useEffect(() => {
    pathnameRef.current = pathname;
    setJobs((current) => mergeJobSummaries(current, fullJobCacheRef.current, hydrationErrorsRef.current, pathname));
  }, [pathname]);

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

  const value = useMemo(
    () => ({
      jobs,
      activeJobs,
      recentJobs: jobs.slice(0, 12),
      loading,
      error,
      refreshJobs,
      startTask,
      cancelTask
    }),
    [activeJobs, cancelTask, error, jobs, loading, refreshJobs, startTask]
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
      cancelTask: context.cancelTask
    };
  }, [context, includeRecent, scopedJobs]);

  if (!scopedContext) throw new Error("useScopedTasks must be used inside TaskProvider");
  return scopedContext;
}

function handleJobNotifications(
  jobs: JobRecord[],
  isFirstLoad: boolean,
  notified: Set<string>,
  previousStatus: Map<string, JobRecord["status"]>,
  notify: (input: FeedbackInput) => void,
  refreshLibrary: () => Promise<void>,
  initialFailureShown: React.MutableRefObject<boolean>
) {
  const nextStatus = new Map<string, JobRecord["status"]>();

  for (const job of jobs) {
    nextStatus.set(job.id, job.status);
    if (isFirstLoad) {
      if (job.status === "failed" && isRecentJob(job) && !initialFailureShown.current) {
        initialFailureShown.current = true;
        notifyJob(job, notify);
      }
      if (isTerminalJob(job)) notified.add(job.id);
      continue;
    }

    const previous = previousStatus.get(job.id);
    const becameTerminal = isTerminalJob(job) && previous !== job.status;
    if (!becameTerminal || notified.has(job.id)) continue;

    notified.add(job.id);
    persistNotifiedJobIds(notified);
    if (job.status === "completed") void refreshLibrary();
    notifyJob(job, notify);
  }

  previousStatus.clear();
  nextStatus.forEach((status, jobId) => previousStatus.set(jobId, status));
  if (isFirstLoad) persistNotifiedJobIds(notified);
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
  isFirstLoad: boolean,
  previousStatus: Map<string, JobRecord["status"]>,
  cache: Map<string, JobRecord>,
  hydrationErrors: Map<string, string>,
  pathname: string
) {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const jobIds = jobs
    .filter((job, index) => shouldHydrateJob(job, index, isFirstLoad, previousStatus, cache, pathname))
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
  isFirstLoad: boolean,
  previousStatus: Map<string, JobRecord["status"]>,
  cache: Map<string, JobRecord>,
  pathname: string
) {
  const relevantToCurrentPage = isJobRelevantToPath(job, pathname);
  const needsFullJob = Boolean(job.hasResult || job.hasPartialText);
  if (isActiveJob(job)) return relevantToCurrentPage && needsFullJob;
  if (!isTerminalJob(job)) return false;
  if (!relevantToCurrentPage || !needsFullJob) return false;
  const cachedJob = cache.get(job.id);
  if (cachedJob && (!job.hasResult || typeof cachedJob.result !== "undefined")) return false;
  if (isFirstLoad) return shouldHydrateInitialTerminalJob(job, index, pathname);

  const previous = previousStatus.get(job.id);
  if (previous && previous !== job.status) return true;
  return false;
}

function shouldHydrateInitialTerminalJob(job: JobListItem, index: number, pathname: string) {
  return pathname === "/writer" && job.kind === "write-copy" && index < 12 && isRecentJob(job);
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
  if (kind === "write-copy") return "/writer";
  if (kind === "project-style") return "/project-workbench";
  if (kind === "engagement") return "/assets";
  if (kind === "hotlist-refresh") return "/douyin-hotlist";
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
  notify({
    tone: failed ? "error" : "success",
    title: hydrationFailed ? "任务结果同步失败" : failed ? `${job.title}失败` : "任务完成",
    message: failed ? formatJobErrorMessage(job.error || job.message) : job.message,
    durationMs: failed ? 15000 : 5000,
    action:
      job.resultRef?.href || job.href
        ? {
            label: job.resultRef?.label || (failed ? "查看任务" : "查看结果"),
            href: job.resultRef?.href || job.href
          }
        : undefined
  });
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

function emitTasksChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}
