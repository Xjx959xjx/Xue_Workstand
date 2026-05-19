"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { Check, LinkIcon, Search, X } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem, CopySource } from "@/lib/types";
import { SourceRow } from "./SourceRow";
import { formatJob, type LinkJob } from "./project-workbench-utils";

type DrawerTab = "sources" | "links" | "accounts";

type ProjectCaseDrawerProps = {
  accounts: AccountListItem[];
  busy: string;
  filteredSources: CopySource[];
  jobs: LinkJob[];
  linkInput: string;
  parsedLinkCount: number;
  selectedAccounts: AccountListItem[];
  sourceAccountIds: string[];
  sourceMaterialIds: string[];
  sourceSearch: string;
  onClose: () => void;
  onLinkInputChange: (value: string) => void;
  onSourceSearchChange: (value: string) => void;
  onToggleAccount: (accountId: string) => void;
  onToggleSource: (sourceId: string) => void;
  onTranscribeLinks: () => void;
};

export function ProjectCaseDrawer({
  accounts,
  busy,
  filteredSources,
  jobs,
  linkInput,
  parsedLinkCount,
  selectedAccounts,
  sourceAccountIds,
  sourceMaterialIds,
  sourceSearch,
  onClose,
  onLinkInputChange,
  onSourceSearchChange,
  onToggleAccount,
  onToggleSource,
  onTranscribeLinks
}: ProjectCaseDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>("sources");
  const activeTitle = activeTab === "sources" ? "选素材" : activeTab === "links" ? "转写链接" : "选账号";
  const activeHint =
    activeTab === "sources"
      ? "从素材池加入案例"
      : activeTab === "links"
        ? "粘贴链接后转写为案例素材"
        : "选择账号作为风格参考";

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") onClose();
  }

  return (
    <div className="project-drawer-backdrop" onMouseDown={handleBackdropMouseDown}>
      <aside aria-labelledby="project-case-drawer-title" aria-modal="true" className="project-drawer" onKeyDown={handleKeyDown} role="dialog" tabIndex={-1}>
        <div className="project-drawer-head">
          <div>
            <p className="eyebrow">案例与参考</p>
            <h2 id="project-case-drawer-title">{activeTitle}</h2>
            <p className="pane-subtitle">{activeHint}</p>
          </div>
          <button className="btn icon-btn" aria-label="关闭弹窗" onClick={onClose} type="button" title="关闭">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="project-drawer-tabs" role="tablist" aria-label="案例来源">
          <button className={activeTab === "sources" ? "active" : ""} onClick={() => setActiveTab("sources")} type="button">素材</button>
          <button className={activeTab === "links" ? "active" : ""} onClick={() => setActiveTab("links")} type="button">链接</button>
          <button className={activeTab === "accounts" ? "active" : ""} onClick={() => setActiveTab("accounts")} type="button">账号</button>
        </div>

        <div className="project-drawer-body">
          {activeTab === "sources" ? (
            <div className="project-drawer-pane">
              <label className="project-drawer-search">
                <Search aria-hidden="true" size={15} />
                <input autoComplete="off" value={sourceSearch} onChange={(event) => onSourceSearchChange(event.target.value)} placeholder="搜索标题、链接或转写" />
              </label>
              <div className="project-workbench-pick-list">
                {filteredSources.slice(0, 12).map((source) => (
                  <SourceRow key={source.id} source={source} selected={sourceMaterialIds.includes(source.id)} compact onToggle={() => onToggleSource(source.id)} />
                ))}
                {!filteredSources.length ? <p className="subtle">无匹配</p> : null}
              </div>
            </div>
          ) : null}

          {activeTab === "links" ? (
            <div className="project-drawer-pane">
              <label className="field">
                <span>链接</span>
                <textarea
                  autoComplete="off"
                  className="project-workbench-linkbox"
                  value={linkInput}
                  onChange={(event) => onLinkInputChange(event.target.value)}
                  placeholder="每行一个 B站 / 抖音链接"
                />
              </label>
              <div className="case-intake-actions">
                <span>识别 {parsedLinkCount} 条</span>
                <button className="btn primary" disabled={!parsedLinkCount || busy === "links"} onClick={onTranscribeLinks} type="button">
                  <LinkIcon aria-hidden="true" size={16} />
                  {busy === "links" ? "转写中" : "转写并加入"}
                </button>
              </div>
              {jobs.length ? <ProjectLinkJobList jobs={jobs} /> : null}
            </div>
          ) : null}

          {activeTab === "accounts" ? (
            <div className="project-drawer-pane">
              <div className="project-workbench-account-list">
                {accounts.map((account) => (
                  <label className="check-card compact" key={account.id}>
                    <input checked={sourceAccountIds.includes(account.id)} onChange={() => onToggleAccount(account.id)} type="checkbox" />
                    <span>
                      <strong>{account.name}</strong>
                      <small>{formatPlatform(account.platform)} · {account.transcriptCount} 转写</small>
                    </span>
                  </label>
                ))}
                {!accounts.length ? <p className="subtle">暂无账号</p> : null}
              </div>
              {selectedAccounts.length ? (
                <div className="project-workbench-chip-row">
                  {selectedAccounts.map((account) => (
                    <span className="stat-pill" key={account.id}>{account.name}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="project-drawer-foot">
          <span>已选 {sourceMaterialIds.length} 案例 · {sourceAccountIds.length} 账号</span>
          <button className="btn primary" onClick={onClose} type="button">
            <Check aria-hidden="true" size={16} />
            完成
          </button>
        </div>
      </aside>
    </div>
  );
}

function ProjectLinkJobList({ jobs }: { jobs: LinkJob[] }) {
  return (
    <div className="project-workbench-job-list">
      {jobs.map((job) => (
        <div className={`project-workbench-job ${job.status}`} key={job.url}>
          <span className={`status-pill ${job.status === "completed" ? "done" : job.status === "failed" ? "failed" : "pending"}`}>{formatJob(job.status)}</span>
          <span>{job.message || job.url}</span>
        </div>
      ))}
    </div>
  );
}
