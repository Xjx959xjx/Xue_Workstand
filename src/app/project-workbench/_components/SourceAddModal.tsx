"use client";

import type { KeyboardEvent } from "react";
import { LinkIcon, X } from "lucide-react";
import { isBackdropEvent } from "@/components/dialog-events";
import { formatJob, type LinkJob } from "./project-workbench-utils";

type SourceAddModalProps = {
  busy: string;
  jobs: LinkJob[];
  linkAnalyzeVideo: boolean;
  linkInput: string;
  parsedLinkCount: number;
  onClose: () => void;
  onLinkAnalyzeVideoChange: (enabled: boolean) => void;
  onLinkInputChange: (value: string) => void;
  onTranscribeLinks: () => void;
};

export function SourceAddModal({
  busy,
  jobs,
  linkAnalyzeVideo,
  linkInput,
  parsedLinkCount,
  onClose,
  onLinkAnalyzeVideoChange,
  onLinkInputChange,
  onTranscribeLinks
}: SourceAddModalProps) {
  const locked = busy === "links";

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !locked) onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (!locked && isBackdropEvent(event)) onClose();
      }}
    >
      <div aria-labelledby="source-add-title" aria-modal="true" className="modal-panel project-source-add-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="source-add-title">添加素材</h2>
            <p className="pane-subtitle">粘贴 B站 / 抖音链接，解析后加入当前项目素材池。</p>
          </div>
          <button className="btn icon-btn" aria-label="关闭添加素材弹窗" disabled={locked} onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="project-source-add-body">
          <label className="field">
            <span>链接</span>
            <textarea
              autoComplete="off"
              className="project-workbench-linkbox source-add-linkbox"
              disabled={locked}
              value={linkInput}
              onChange={(event) => onLinkInputChange(event.target.value)}
              placeholder="每行一个 B站 / 抖音链接，也可以直接粘贴分享文案"
            />
          </label>

          <label className={`source-analysis-option ${linkAnalyzeVideo ? "active" : ""}`}>
            <input checked={linkAnalyzeVideo} disabled={locked} onChange={(event) => onLinkAnalyzeVideoChange(event.target.checked)} type="checkbox" />
            <span>
              <strong>生成画面描述</strong>
              <small>转写后抽关键帧，按画面顺序补充场景、字幕、UI 和动作；抽不到视频时只保存标题和转写。</small>
            </span>
          </label>

          <div className="source-add-actions">
            <span>识别 {parsedLinkCount} 条</span>
            <button className="btn primary" disabled={!parsedLinkCount || locked} onClick={onTranscribeLinks} type="button">
              <LinkIcon aria-hidden="true" size={16} />
              {locked ? "解析中" : "解析并加入"}
            </button>
          </div>

          {jobs.length ? <ProjectLinkJobList jobs={jobs} /> : null}
        </div>
      </div>
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
