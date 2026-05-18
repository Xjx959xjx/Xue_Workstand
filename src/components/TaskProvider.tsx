"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { FeedbackInput } from "./FeedbackProvider";
import { useFeedback } from "./FeedbackProvider";
import { getJobs, startJob } from "@/lib/client";
import { formatJobErrorMessage } from "@/lib/job-messages";
import { JobRecord, JobStartInput } from "@/lib/types";
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

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const { refresh } = useLibrary();
  const { notify } = useFeedback();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const firstLoadRef = useRef(true);
  const initialFailureShownRef = useRef(false);
  const notifiedRef = useRef<Set<string>>(new Set());
  const previousStatusRef = useRef<Map<string, JobRecord["status"]>>(new Map());

  useEffect(() => {
    notifiedRef.current = readNotifiedJobIds();
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await getJobs();
      setJobs(data.jobs);
      setError("");
      handleJobNotifications(
        data.jobs,
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
  }, [notify, refresh]);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running"),
    [jobs]
  );

  useEffect(() => {
    const interval = window.setInterval(refreshJobs, activeJobs.length ? 1800 : 5000);
    return () => window.clearInterval(interval);
  }, [activeJobs.length, refreshJobs]);

  const startTask = useCallback(
    async (input: JobStartInput) => {
      const result = await startJob(input);
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

function isRecentJob(job: JobRecord) {
  const time = Date.parse(job.completedAt || job.updatedAt || job.createdAt);
  return Number.isFinite(time) && Date.now() - time < 15 * 60 * 1000;
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
