"use client";

import { Check, LinkIcon, Search, UsersRound, X } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import { ModalBackdrop } from "@/components/ModalBackdrop";
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
  const activeTitle = initialTab === "sources" ? "选择已有素材" : initialTab === "links" ? "转写视频链接" : "选择参考账号";
  const activeHint =
    initialTab === "sources"
      ? "勾选后直接加入当前项目"
      : initialTab === "links"
        ? "粘贴 B站或抖音链接，转写完成后自动加入项目"
        : "只在需要补充长期口吻时选择账号";

  return (
    <ModalBackdrop disabled={locked} onClose={onClose}>
      <div aria-labelledby="project-case-dialog-title" aria-modal="true" className="modal-panel project-case-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="project-case-dialog-title">{activeTitle}</h2>
            <p className="pane-subtitle">{activeHint}</p>
          </div>
          <button className="btn icon-btn" aria-label="关闭弹窗" disabled={locked} onClick={onClose} type="button" title="关闭">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="project-case-modal-body">
          {initialTab === "sources" ? (
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
                {!filteredSources.length ? <div className="project-workbench-empty">没有匹配素材</div> : null}
              </div>
            </div>
          ) : null}

          {initialTab === "links" ? (
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
              {jobs.length ? <ProjectLinkJobList jobs={jobs} /> : null}
            </div>
          ) : null}

          {initialTab === "accounts" ? (
            <div className="project-drawer-pane" role="tabpanel">
              <p className="project-case-selection-summary">已选 {selectedAccountCount} 个账号，共 {selectedTranscriptCount} 份可参考转写</p>
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
            </div>
          ) : null}
        </div>
        <div className="modal-actions project-case-modal-actions">
          {initialTab === "links" ? (
            <>
              <span>已识别 {parsedLinkCount} 条链接</span>
              <button className="btn primary" disabled={!parsedLinkCount || locked} onClick={onTranscribeLinks} type="button">
                <LinkIcon aria-hidden="true" size={16} />
                {locked ? "转写中" : "转写并加入"}
              </button>
            </>
          ) : (
            <>
              <span>{initialTab === "sources" ? `已选 ${selectedSourceCount} 份素材` : `已选 ${selectedAccountCount} 个账号`}</span>
              <button className="btn primary" onClick={onClose} type="button">
                <Check aria-hidden="true" size={16} />
                完成
              </button>
            </>
          )}
        </div>
      </div>
    </ModalBackdrop>
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
