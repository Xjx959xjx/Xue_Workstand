"use client";

import { CSSProperties, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { formatJobErrorMessage } from "@/lib/job-messages";
import type { JobRecord } from "@/lib/types";
import { TaskStatusIcon, useTasks } from "./TaskProvider";

type ProgressStyle = CSSProperties & {
  "--task-progress": string;
};

export function TaskCenter() {
  const { activeJobs, error, loading, refreshJobs } = useTasks();
  const [open, setOpen] = useState(false);
  const visibleJobs = activeJobs.slice(0, 4);
  const primaryJob = activeJobs[0] || null;
  const activeCount = activeJobs.length;
  const hasTasks = activeCount > 0;
  const hiddenActiveCount = Math.max(0, activeCount - visibleJobs.length);
  const triggerSummary = `${activeCount} 个进行中`;
  const progress = clampProgress(primaryJob?.progress ?? 0);
  const progressStyle: ProgressStyle = { "--task-progress": `${progress}%` };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!hasTasks) return null;

  return (
    <div className="task-center">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`打开任务中心，${triggerSummary}`}
        className={`task-center-trigger ${activeCount ? "active" : ""}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="task-center-rail">
          <span className="task-center-rail-fill" style={progressStyle} />
        </span>
      </button>

      {open ? (
        <>
          <button className="task-center-backdrop" aria-label="关闭任务中心" onClick={() => setOpen(false)} type="button" />
          <aside className="task-center-drawer" aria-label="任务中心" role="dialog">
            <header className="task-center-drawer-header">
              <div>
                <h2>任务中心</h2>
                <p className="subtle">{activeCount} 个任务正在处理</p>
              </div>
              <div className="task-center-drawer-actions">
                <button
                  aria-busy={loading}
                  className="btn icon-only compact"
                  disabled={loading}
                  onClick={() => void refreshJobs()}
                  title="刷新任务"
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                </button>
                <button className="btn icon-only compact" onClick={() => setOpen(false)} title="关闭" type="button">
                  <X aria-hidden="true" size={15} />
                </button>
              </div>
            </header>

            {error ? <div className="task-center-error" role="alert">{error}</div> : null}

            <div className="task-center-drawer-body">
              <TaskSection title="进行中" jobs={visibleJobs} />
              {hiddenActiveCount ? <p className="task-center-more">另有 {hiddenActiveCount} 个任务继续在后台处理。</p> : null}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

function TaskSection({
  jobs,
  title
}: {
  jobs: JobRecord[];
  title: string;
}) {
  return (
    <section className="task-center-section">
      <div className="task-center-section-title">
        <h3>{title}</h3>
        <span>{jobs.length}</span>
      </div>
      <div className="task-center-list">
        {jobs.map((job) => (
          <TaskRow job={job} key={job.id} />
        ))}
      </div>
    </section>
  );
}

function TaskRow({ job }: { job: JobRecord }) {
  const detail = job.status === "failed" ? formatJobErrorMessage(job.error || job.message) : job.message;
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
        <span>{job.progress}%</span>
      </span>
      {isActiveJob(job) ? (
        <span className="task-center-row-progress" aria-label={`任务进度 ${job.progress}%`}>
          <span style={{ width: `${clampProgress(job.progress)}%` }} />
        </span>
      ) : null}
      {job.status === "failed" && detail ? <span className="task-center-row-error">{detail}</span> : null}
    </div>
  );
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
  return "已中断";
}
