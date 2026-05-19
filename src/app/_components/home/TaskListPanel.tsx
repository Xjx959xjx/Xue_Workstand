"use client";

import Link from "next/link";
import { BookOpenText, ChevronRight, FileText, FolderKanban, MessageSquareText } from "lucide-react";
import type { HomeStats } from "./QuickStartPanel";

const entries = [
  {
    href: "/library",
    title: "账号风格库",
    body: "管理平台、账号、爆款视频、转写稿和可编辑风格卡。",
    action: "查看账号库",
    icon: BookOpenText
  },
  {
    href: "/project-workbench",
    title: "项目工作台",
    body: "管理项目、添加案例素材，并生成项目风格卡。",
    action: "进入工作台",
    icon: FolderKanban
  },
  {
    href: "/writer",
    title: "对话写作",
    body: "选择账号风格，按主题生成或改写已有文案。",
    action: "开始写文案",
    icon: MessageSquareText
  },
  {
    href: "/drafts",
    title: "草稿管理",
    body: "查看生成结果、引用账号、历史版本和可复用片段。",
    action: "查看草稿",
    icon: FileText
  }
];

type TaskListPanelProps = {
  canWrite: boolean;
  stats: HomeStats;
};

export function TaskListPanel({ canWrite, stats }: TaskListPanelProps) {
  function entryStatus(title: string) {
    if (title === "账号风格库") return `${stats.accountCount} 个账号 · ${stats.videoCount} 条视频`;
    if (title === "项目工作台") return `${stats.projectCount} 个项目 · ${stats.copySourceCount} 份案例`;
    if (title === "对话写作") return canWrite ? "已有参考账号" : "先添加一个参考账号";
    return `${stats.draftCount} 个草稿`;
  }

  return (
    <div className="panel">
      <div className="panel-inner">
        <div className="section-title-row">
          <h2>常用任务</h2>
          <span className="status-pill done">本地工作流</span>
        </div>
        <div className="task-list">
          {entries.map((entry) => {
            const Icon = entry.icon;
            const disabled = entry.title === "对话写作" && !canWrite;
            const content = (
              <>
                <span className="entry-icon">
                  <Icon aria-hidden="true" size={18} />
                </span>
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.body}</small>
                </span>
                <span className="task-row-meta">
                  <span>{entryStatus(entry.title)}</span>
                  <span className="task-action">
                    {entry.action}
                    <ChevronRight aria-hidden="true" size={14} />
                  </span>
                </span>
              </>
            );
            return disabled ? (
              <div aria-disabled="true" className="task-row disabled-card" key={entry.href}>
                {content}
              </div>
            ) : (
              <Link className="task-row" href={entry.href} key={entry.href}>
                {content}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
