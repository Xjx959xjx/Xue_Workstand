"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { CheckCircle2, Loader2, RefreshCw, X, XCircle } from "lucide-react";
import { formatJobErrorMessage } from "@/lib/job-messages";
import type { JobRecord } from "@/lib/types";
import { useOptionalTasks } from "./TaskProvider";

export function TaskCenter() {
  const tasks = useOptionalTasks();
  const [open, setOpen] = useState(false);
  const [stoppingJobId, setStoppingJobId] = useState("");
  const activeJobs = tasks?.activeJobs ?? [];
  const activeJobIds = new Set(activeJobs.map((job) => job.id));
  const recentJobs = tasks?.recentJobs.filter((job) => !activeJobIds.has(job.id)).slice(0, 4) ?? [];
  const activeCount = activeJobs.length;
  const primaryJob = activeJobs[0] || recentJobs[0] || null;
  const progress = clampProgress(primaryJob?.progress ?? 0);
  const progressStyle = { "--task-progress": `${progress}%` } as CSSProperties;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!tasks) return null;

  return (
    <div className="task-center">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`打开任务中心，${activeCount} 个进行中任务`}
        className={`task-center-trigger ${activeCount ? "active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="task-center-trigger-copy">
          <strong>任务中心</strong>
          <small>{primaryJob ? primaryJob.title : "没有进行中的任务"}</small>
        </span>
        <span aria-hidden="true" className="task-center-rail">
          <span className="task-center-rail-fill" style={progressStyle} />
        </span>
        <span className="task-center-trigger-meta">
          <span>{activeCount}</span>
          <small>{primaryJob?.progress ?? 0}%</small>
        </span>
      </button>

      {open ? (
        <>
          <button className="task-center-backdrop" aria-label="关闭任务中心" onClick={() => setOpen(false)} type="button" />
          <aside className="task-center-drawer" aria-label="任务中心" role="dialog">
            <header className="task-center-drawer-header">
              <div>
                <h2>任务中心</h2>
                <p className="subtle">{activeCount ? `${activeCount} 个任务正在处理` : "没有进行中的任务"}</p>
              </div>
              <div className="task-center-drawer-actions">
                <button
                  aria-busy={tasks.loading}
                  aria-label="刷新任务"
                  className="btn icon-only compact"
                  disabled={tasks.loading}
                  onClick={() => void tasks.refreshJobs()}
                  title="刷新任务"
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                </button>
                <button aria-label="关闭任务中心" className="btn icon-only compact" onClick={() => setOpen(false)} title="关闭" type="button">
                  <X aria-hidden="true" size={15} />
                </button>
              </div>
            </header>

            {tasks.error ? <div className="task-center-error" role="alert">{tasks.error}</div> : null}

            <div className="task-center-drawer-body">
              <TaskSection
                title="进行中"
                jobs={activeJobs}
                onCancel={async (jobId) => {
                  setStoppingJobId(jobId);
                  try {
                    await tasks.cancelTask(jobId);
                  } finally {
                    setStoppingJobId((current) => (current === jobId ? "" : current));
                  }
                }}
                stoppingJobId={stoppingJobId}
              />
              <TaskSection title="最近任务" jobs={recentJobs} onCancel={async () => undefined} stoppingJobId={stoppingJobId} readOnly />
              {!activeJobs.length && !recentJobs.length ? (
                <p className="task-center-more">最近没有任务记录。</p>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

function TaskSection({
  jobs,
  onCancel,
  stoppingJobId,
  title,
  readOnly = false
}: {
  jobs: JobRecord[];
  onCancel: (jobId: string) => Promise<void>;
  stoppingJobId: string;
  title: string;
  readOnly?: boolean;
}) {
  return (
    <section className="task-center-section">
      <div className="task-center-section-title">
        <h3>{title}</h3>
        <span>{jobs.length}</span>
      </div>
      <div className="task-center-list">
        {jobs.length ? (
          jobs.map((job) => (
            <TaskRow job={job} key={job.id} onCancel={onCancel} stopping={stoppingJobId === job.id} readOnly={readOnly} />
          ))
        ) : (
          <div className="task-center-empty">暂无{title}</div>
        )}
      </div>
    </section>
  );
}

function TaskRow({
  job,
  onCancel,
  stopping,
  readOnly
}: {
  job: JobRecord;
  onCancel: (jobId: string) => Promise<void>;
  stopping: boolean;
  readOnly?: boolean;
}) {
  const detail = job.status === "failed" ? formatJobErrorMessage(job.error || job.message) : job.message;
  const recentEvents = (job.events || []).slice(-3);
  return (
    <div className={`task-center-row ${job.status}`}>
      <span className={`task-center-row-state ${job.status}`}>
        <TaskStatusIcon status={job.status} />
      </span>
      <span className="task-center-row-copy">
        <strong>{job.title}</strong>
        <small title={detail}>{detail}</small>
      </span>
      <span className="task-center-row-meta">
        <span>{formatJobStatus(job.status)}</span>
        <span>{clampProgress(job.progress)}%</span>
      </span>
      {!readOnly && isActiveJob(job) ? (
        <button className="btn compact" disabled={stopping} onClick={() => void onCancel(job.id)} type="button">
          {stopping ? "停止中…" : "停止"}
        </button>
      ) : null}
      {isActiveJob(job) ? (
        <span className="task-center-row-progress" aria-label={`任务进度 ${job.progress}%`}>
          <span style={{ width: `${clampProgress(job.progress)}%` }} />
        </span>
      ) : null}
      {job.status === "failed" && detail ? <span className="task-center-row-error">{detail}</span> : null}
      {recentEvents.length > 1 ? (
        <span className="task-center-row-events" title={recentEvents.map(formatJobEvent).join("\n")}>
          {recentEvents.map((event) => event.message).join(" / ")}
        </span>
      ) : null}
    </div>
  );
}

function formatJobEvent(event: NonNullable<JobRecord["events"]>[number]) {
  return `${formatEventTime(event.at)} ${event.message}（${event.progress}%）`;
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function isActiveJob(job: JobRecord) {
  return job.status === "queued" || job.status === "running";
}

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

function formatJobStatus(status: JobRecord["status"]) {
  if (status === "queued") return "排队中";
  if (status === "running") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已停止";
  return "已中断";
}

function TaskStatusIcon({ status }: { status: JobRecord["status"] }) {
  if (status === "running" || status === "queued") return <Loader2 aria-hidden="true" size={14} />;
  if (status === "completed") return <CheckCircle2 aria-hidden="true" size={14} />;
  return <XCircle aria-hidden="true" size={14} />;
}
