"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { FeedbackInput } from "./FeedbackProvider";
import { useFeedback } from "./FeedbackProvider";
import { getJob, getJobs, startJob } from "@/lib/client";
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
};

const TaskContext = createContext<TaskContextValue | null>(null);
const NOTIFIED_STORAGE_KEY = "style-workbench-notified-jobs";
const ACTIVE_POLL_INTERVAL_MS = 3000;
const IDLE_POLL_INTERVAL_MS = 30000;
const HIDDEN_POLL_INTERVAL_MS = 60000;
const TASKS_CHANGED_EVENT = "style-workbench:tasks-changed";

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { refresh } = useLibrary();
  const { notify } = useFeedback();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageVisible, setPageVisible] = useState(true);
  const firstLoadRef = useRef(true);
  const fullJobCacheRef = useRef<Map<string, JobRecord>>(new Map());
  const initialFailureShownRef = useRef(false);
  const notifiedRef = useRef<Set<string>>(new Set());
  const pendingRefreshRef = useRef(false);
  const pathnameRef = useRef(pathname);
  const previousStatusRef = useRef<Map<string, JobRecord["status"]>>(new Map());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    notifiedRef.current = readNotifiedJobIds();
  }, []);

  useEffect(() => {
    pathnameRef.current = pathname;
    setJobs((current) => mergeJobSummaries(current, fullJobCacheRef.current, pathname));
  }, [pathname]);

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
          pathnameRef.current
        );
        pruneFullJobCache(fullJobCacheRef.current, summaries);

        const mergedJobs = mergeJobSummaries(summaries, fullJobCacheRef.current, pathnameRef.current);
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
    refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    const onTasksChanged = () => {
      void refreshJobs();
    };
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
  }, [refreshJobs]);

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running"),
    [jobs]
  );

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(!document.hidden);
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeout = 0;

    const schedule = () => {
      const delay = pageVisible ? (activeJobs.length ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS) : HIDDEN_POLL_INTERVAL_MS;
      timeout = window.setTimeout(async () => {
        await refreshJobs();
        if (!cancelled) schedule();
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeJobs.length, pageVisible, refreshJobs]);

  const startTask = useCallback(
    async (input: JobStartInput) => {
      const result = await startJob(input);
      emitTasksChanged();
      await refreshJobs();
      return result.job;
    },
    [refreshJobs]
  );

  const value = useMemo(
    () => ({
      jobs,
      activeJobs,
      recentJobs: jobs.slice(0, 12),
      loading,
      error,
      refreshJobs,
      startTask
    }),
    [activeJobs, error, jobs, loading, refreshJobs, startTask]
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

type UseScopedTasksOptions = {
  href?: string;
  kinds?: JobKind[];
  includeRecent?: boolean;
};

export function useScopedTasks(options: UseScopedTasksOptions = {}) {
  const kindKey = options.kinds?.join("|") || "";
  const kindSet = useMemo(() => (kindKey ? new Set(kindKey.split("|") as JobKind[]) : null), [kindKey]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageVisible, setPageVisible] = useState(true);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const pendingRefreshRef = useRef(false);
  const includeRecent = options.includeRecent ?? true;
  const recentLimit = includeRecent ? 12 : Number.POSITIVE_INFINITY;

  const refreshJobs = useCallback(async () => {
    if (refreshPromiseRef.current) {
      pendingRefreshRef.current = true;
      return refreshPromiseRef.current;
    }

    const run = async (): Promise<void> => {
      try {
        const summaries = (await getJobs()).jobs.filter((job) => isJobInScope(job, options.href, kindSet));
        const limitedSummaries = includeRecent ? summaries.slice(0, recentLimit) : summaries.filter((job) => isActiveJob(job));
        const hydrated = await Promise.all(limitedSummaries.map((job) => hydrateScopedJob(job)));
        setJobs(hydrated);
        setError("");
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
  }, [includeRecent, kindSet, options.href, recentLimit]);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(!document.hidden);
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const activeJobs = useMemo(() => jobs.filter((job) => isActiveJob(job)), [jobs]);

  useEffect(() => {
    let cancelled = false;
    let timeout = 0;

    const schedule = () => {
      const delay = pageVisible ? (activeJobs.length ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS) : HIDDEN_POLL_INTERVAL_MS;
      timeout = window.setTimeout(async () => {
        await refreshJobs();
        if (!cancelled) schedule();
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeJobs.length, pageVisible, refreshJobs]);

  useEffect(() => {
    const onTasksChanged = () => {
      void refreshJobs();
    };
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
  }, [refreshJobs]);

  const startTask = useCallback(async (input: JobStartInput) => {
    const result = await startJob(input);
    emitTasksChanged();
    await refreshJobs();
    return result.job;
  }, [refreshJobs]);

  return useMemo(
    () => ({
      jobs,
      activeJobs,
      recentJobs: jobs.slice(0, 12),
      loading,
      error,
      refreshJobs,
      startTask
    }),
    [activeJobs, error, jobs, loading, refreshJobs, startTask]
  );
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
  return job.status === "completed" || job.status === "failed";
}

function isActiveJob(job: JobRecord | JobListItem) {
  return job.status === "queued" || job.status === "running";
}

function isRecentJob(job: JobRecord) {
  const time = Date.parse(job.completedAt || job.updatedAt || job.createdAt);
  return Number.isFinite(time) && Date.now() - time < 15 * 60 * 1000;
}

async function hydrateTrackedJobs(
  jobs: JobListItem[],
  isFirstLoad: boolean,
  previousStatus: Map<string, JobRecord["status"]>,
  cache: Map<string, JobRecord>,
  pathname: string
) {
  const jobIds = jobs
    .filter((job, index) => shouldHydrateJob(job, index, isFirstLoad, previousStatus, pathname))
    .map((job) => job.id);
  if (!jobIds.length) return;

  const fullJobs = await Promise.all(
    [...new Set(jobIds)].map(async (jobId) => {
      try {
        return (await getJob(jobId)).job;
      } catch {
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
  pathname: string
) {
  const relevantToCurrentPage = isJobRelevantToPath(job, pathname);
  if (isActiveJob(job)) return relevantToCurrentPage && Boolean(job.hasPartialText || job.hasResult);
  if (!isTerminalJob(job)) return false;
  if (isFirstLoad) return relevantToCurrentPage && index < 3 && (job.hasResult || job.hasPartialText) && isRecentJob(job);

  const previous = previousStatus.get(job.id);
  return relevantToCurrentPage && Boolean(previous && previous !== job.status && (job.hasResult || job.hasPartialText));
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

async function hydrateScopedJob(job: JobListItem): Promise<JobRecord> {
  if (!job.hasPartialText && !job.hasResult) return job;
  try {
    return (await getJob(job.id)).job;
  } catch {
    return job;
  }
}

function defaultJobHref(kind: JobRecord["kind"]) {
  if (kind === "write-copy") return "/writer";
  if (kind === "project-style") return "/project-workbench";
  if (kind === "engagement") return "/assets";
  return "/library";
}

function mergeJobSummaries(jobs: JobListItem[], cache: Map<string, JobRecord>, pathname: string) {
  return jobs.map((job) => {
    const fullJob = cache.get(job.id);
    if (fullJob) return { ...fullJob, ...job };
    if (isJobRelevantToPath(job, pathname)) return job;
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
  const failed = job.status === "failed";
  notify({
    tone: failed ? "error" : "success",
    title: failed ? `${job.title}失败` : "任务完成",
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

export function TaskStatusIcon({ status }: { status: JobRecord["status"] }) {
  if (status === "running" || status === "queued") return <Loader2 aria-hidden="true" size={14} />;
  if (status === "completed") return <CheckCircle2 aria-hidden="true" size={14} />;
  return <XCircle aria-hidden="true" size={14} />;
}

function emitTasksChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}
