"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BookOpenText,
  ChevronDown,
  FileText,
  FolderKanban,
  Home,
  Layers3,
  MessageSquareMore,
  MessageSquareText,
  NotebookText,
  Sparkles
} from "lucide-react";
import { TaskStatusIcon, useTasks } from "./TaskProvider";
import { formatJobErrorMessage } from "@/lib/job-messages";
import { JobRecord } from "@/lib/types";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/copy-tools", label: "文案工具", icon: NotebookText },
  { href: "/library", label: "账号库", icon: BookOpenText },
  { href: "/projects", label: "项目库", icon: Layers3 },
  { href: "/project-workbench", label: "项目工作台", icon: FolderKanban },
  { href: "/writer", label: "对话写作", icon: MessageSquareText },
  { href: "/assets", label: "评论生成", icon: MessageSquareMore },
  { href: "/drafts", label: "草稿", icon: FileText }
];

export function AppNav() {
  const pathname = usePathname();
  const { activeJobs, recentJobs } = useTasks();

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <Sparkles aria-hidden="true" size={20} />
        </span>
        <span>
          <strong>账号风格库</strong>
          <small>本地工作台</small>
        </span>
      </Link>
      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link href={item.href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} key={item.href}>
              <Icon aria-hidden="true" size={19} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <SidebarTaskModule activeJobs={activeJobs} recentJobs={recentJobs} />
    </aside>
  );
}

function SidebarTaskModule({
  activeJobs,
  recentJobs
}: {
  activeJobs: JobRecord[];
  recentJobs: JobRecord[];
}) {
  const [open, setOpen] = useState(false);
  const visibleJobs = (open ? recentJobs : recentJobs.slice(0, 1)).slice(0, 5);
  const primaryJob = activeJobs[0] || recentJobs[0] || null;
  const activeCount = activeJobs.length;

  return (
    <section className={`sidebar-tasks ${open ? "open" : ""}`} aria-label="后台任务">
      <button
        className="sidebar-task-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="sidebar-task-icon">
          <Activity aria-hidden="true" size={16} />
        </span>
        <span className="sidebar-task-heading">
          <strong>任务</strong>
          <small>{primaryJob ? primaryJob.message : "暂无后台任务"}</small>
        </span>
        <span className={`sidebar-task-count ${activeCount ? "active" : ""}`}>
          {activeCount || recentJobs.length || 0}
        </span>
        <ChevronDown aria-hidden="true" className="sidebar-task-chevron" size={15} />
      </button>

      {primaryJob ? (
        <div className="sidebar-task-progress" aria-label={`任务进度 ${primaryJob.progress}%`}>
          <span
            className={primaryJob.status === "running" || primaryJob.status === "queued" ? "running" : ""}
            style={{ width: `${primaryJob.progress}%` }}
          />
        </div>
      ) : null}

      {open && visibleJobs.length ? (
        <div className="sidebar-task-list">
          {visibleJobs.map((job) => (
            <SidebarTaskRow key={job.id} job={job} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SidebarTaskRow({ job }: { job: JobRecord }) {
  const href = job.resultRef?.href || job.href;
  const detail = job.status === "failed" ? formatJobErrorMessage(job.error || job.message) : job.message;
  const content = (
    <>
      <span className={`sidebar-task-state ${job.status}`}>
        <TaskStatusIcon status={job.status} />
      </span>
      <span className="sidebar-task-row-copy">
        <strong>{job.title}</strong>
        <small title={detail}>{detail}</small>
      </span>
      <span className="sidebar-task-meta">
        <span>{formatJobStatus(job.status)}</span>
        <span>{job.progress}%</span>
      </span>
      {job.status === "failed" && detail ? <span className="sidebar-task-error">{detail}</span> : null}
    </>
  );

  if (href && (job.status === "completed" || job.status === "failed")) {
    return (
      <Link className={`sidebar-task-row ${job.status}`} href={href}>
        {content}
      </Link>
    );
  }

  return <div className={`sidebar-task-row ${job.status}`}>{content}</div>;
}

function formatJobStatus(status: JobRecord["status"]) {
  if (status === "queued") return "排队中";
  if (status === "running") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return "已中断";
}
