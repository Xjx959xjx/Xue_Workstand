"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { Check, LinkIcon, Search, UsersRound, X } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem, CopySource } from "@/lib/types";
import { SourceRow } from "./SourceRow";
import { formatJob, type LinkJob } from "./project-workbench-utils";

export type ProjectCaseDrawerTab = "sources" | "links" | "accounts";

type ProjectCaseDrawerProps = {
  accounts: AccountListItem[];
  busy: string;
  filteredSources: CopySource[];
  initialTab: ProjectCaseDrawerTab;
  jobs: LinkJob[];
  linkAnalyzeVideo: boolean;
  linkInput: string;
  parsedLinkCount: number;
  selectedAccounts: AccountListItem[];
  sourceAccountIds: string[];
  sourceMaterialIds: string[];
  sourceSearch: string;
  onClose: () => void;
  onLinkAnalyzeVideoChange: (enabled: boolean) => void;
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
  initialTab,
  jobs,
  linkAnalyzeVideo,
  linkInput,
  parsedLinkCount,
  selectedAccounts,
  sourceAccountIds,
  sourceMaterialIds,
  sourceSearch,
  onClose,
  onLinkAnalyzeVideoChange,
  onLinkInputChange,
  onSourceSearchChange,
  onToggleAccount,
  onToggleSource,
  onTranscribeLinks
}: ProjectCaseDrawerProps) {
  const [activeTab, setActiveTab] = useState<ProjectCaseDrawerTab>(initialTab);
  const locked = busy === "links";
  const selectedAccountCount = sourceAccountIds.length;
  const selectedSourceCount = sourceMaterialIds.length;
  const selectedTranscriptCount = selectedAccounts.reduce((sum, account) => sum + account.transcriptCount, 0);
  const orderedAccounts = [...accounts].sort((left, right) => {
    const leftSelected = sourceAccountIds.includes(left.id);
    const rightSelected = sourceAccountIds.includes(right.id);
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    return left.name.localeCompare(right.name, "zh-CN");
  });
  const activeTitle = activeTab === "sources" ? "选素材" : activeTab === "links" ? "转写链接" : "选账号";
  const activeHint =
    activeTab === "sources"
      ? "从素材池加入案例"
      : activeTab === "links"
        ? "粘贴链接后转写为案例素材"
        : "选择账号作为风格参考";

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (!locked && event.target === event.currentTarget) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !locked) onClose();
  }

  return (
    <div className="project-drawer-backdrop" onMouseDown={handleBackdropMouseDown}>
      <aside aria-labelledby="project-case-drawer-title" aria-modal="true" className="project-drawer" onKeyDown={handleKeyDown} role="dialog" tabIndex={-1}>
        <div className="project-drawer-head">
          <div>
            <p className="eyebrow">案例与参考</p>
            <h2 id="project-case-drawer-title">{activeTitle}</h2>
            <p className="pane-subtitle">{activeHint}</p>
            <div className="project-drawer-head-stats" aria-label="当前选择">
              <span>{selectedSourceCount} 案例</span>
              <span>{selectedAccountCount} 账号</span>
            </div>
          </div>
          <button className="btn icon-btn" aria-label="关闭弹窗" disabled={locked} onClick={onClose} type="button" title="关闭">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="project-drawer-tabs" role="tablist" aria-label="案例来源">
          <DrawerTabButton active={activeTab === "sources"} label="素材" meta={`${filteredSources.length} 份`} onClick={() => setActiveTab("sources")} />
          <DrawerTabButton active={activeTab === "links"} label="链接" meta={parsedLinkCount ? `${parsedLinkCount} 条` : "粘贴"} onClick={() => setActiveTab("links")} />
          <DrawerTabButton active={activeTab === "accounts"} label="账号" meta={`${selectedAccountCount}/${accounts.length}`} onClick={() => setActiveTab("accounts")} />
        </div>

        <div className="project-drawer-body">
          {activeTab === "sources" ? (
            <div className="project-drawer-pane" role="tabpanel">
              <label className="project-drawer-search">
                <Search aria-hidden="true" size={15} />
                <input autoComplete="off" name="sourceSearch" value={sourceSearch} onChange={(event) => onSourceSearchChange(event.target.value)} placeholder="搜索标题、链接或转写…" />
              </label>
              <div className="project-workbench-pick-list">
                {filteredSources.slice(0, 12).map((source) => (
                  <SourceRow key={source.id} source={source} selected={sourceMaterialIds.includes(source.id)} compact onToggle={() => onToggleSource(source.id)} />
                ))}
                {filteredSources.length > 12 ? <div className="project-more-row">还有 {filteredSources.length - 12} 份，继续搜索可缩小范围</div> : null}
                {!filteredSources.length ? (
                  <button className="project-workbench-empty action" onClick={() => setActiveTab("links")} type="button">
                    没有匹配，去转写链接
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {activeTab === "links" ? (
            <div className="project-drawer-pane" role="tabpanel">
              <label className="field">
                <span>链接</span>
                <textarea
                  autoComplete="off"
                  className="project-workbench-linkbox"
                  disabled={locked}
                  name="sourceLinks"
                  value={linkInput}
                  onChange={(event) => onLinkInputChange(event.target.value)}
                  placeholder="每行一个 B站 / 抖音链接，也可以直接粘贴分享文案…"
                />
              </label>
              <label className={`source-analysis-option ${linkAnalyzeVideo ? "active" : ""}`}>
                <input checked={linkAnalyzeVideo} disabled={locked} name="sourceAnalyzeVideo" onChange={(event) => onLinkAnalyzeVideoChange(event.target.checked)} type="checkbox" />
                <span>
                  <strong>生成画面描述</strong>
                  <small>转写后抽关键帧补充场景、字幕、UI 和动作；抽不到视频时只保存标题和转写。</small>
                </span>
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
            <div className="project-drawer-pane" role="tabpanel">
              <div className="project-drawer-selection-note">
                <span>
                  <strong>{selectedAccountCount}</strong>
                  已选账号
                </span>
                <span>
                  <strong>{selectedTranscriptCount}</strong>
                  可参考转写
                </span>
              </div>
              <div className="project-workbench-account-list">
                {orderedAccounts.map((account) => {
                  const checked = sourceAccountIds.includes(account.id);
                  return (
                    <label className={`project-account-choice ${checked ? "selected" : ""}`} key={account.id}>
                      <input checked={checked} name="sourceAccountIds" onChange={() => onToggleAccount(account.id)} type="checkbox" />
                      <span className="project-account-choice-icon">
                        <UsersRound aria-hidden="true" size={15} />
                      </span>
                      <span className="project-account-choice-copy">
                        <strong>{account.name}</strong>
                        <small>{formatPlatform(account.platform)} · {account.transcriptCount} 转写 · {account.videoCount} 视频</small>
                      </span>
                      <span className={`status-pill ${checked ? "done" : ""}`}>{checked ? "已选" : "可选"}</span>
                    </label>
                  );
                })}
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
          <span className="project-drawer-foot-copy">
            <strong>已选 {selectedSourceCount} 案例 · {selectedAccountCount} 账号</strong>
            <small>{locked ? "正在转写，完成后自动加入素材池。" : "完成后回到工作台保存修改。"}</small>
          </span>
          <button className="btn primary" disabled={locked} onClick={onClose} type="button">
            <Check aria-hidden="true" size={16} />
            完成
          </button>
        </div>
      </aside>
    </div>
  );
}

function DrawerTabButton({
  active,
  label,
  meta,
  onClick
}: {
  active: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button aria-selected={active} className={active ? "active" : ""} onClick={onClick} role="tab" type="button">
      <span>{label}</span>
      <small>{meta}</small>
    </button>
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
