"use client";

import Link from "next/link";
import { ArrowRight, FileText, Save, Sparkles } from "lucide-react";
import type { JobRecord, ProjectListItem } from "@/lib/types";
import { EMPTY_STYLE } from "./project-workbench-utils";

type ProjectStylePanelProps = {
  activeStyleJob: JobRecord | undefined;
  busy: string;
  canSaveWorkspace: boolean;
  canWrite: boolean;
  isDirty: boolean;
  projectDetailLoading: boolean;
  selectedProjectMeta: ProjectListItem | null;
  styleDraft: string;
  writerHref: string;
  onGenerateStyle: () => void;
  onSaveWorkspace: () => void;
  onStyleDraftChange: (value: string) => void;
};

export function ProjectStylePanel({
  activeStyleJob,
  busy,
  canSaveWorkspace,
  canWrite,
  isDirty,
  projectDetailLoading,
  selectedProjectMeta,
  styleDraft,
  writerHref,
  onGenerateStyle,
  onSaveWorkspace,
  onStyleDraftChange
}: ProjectStylePanelProps) {
  const styleCount = styleDraft.trim().length;
  const saveLabel = selectedProjectMeta ? (isDirty ? "未保存" : "已保存") : "待保存";
  const canShowSave = canSaveWorkspace || busy === "save";
  const generateLabel = styleCount ? "重生成" : "生成";
  const styleStatus = busy === "style" ? "正在生成项目风格卡" : styleCount ? "可继续编辑，也可以直接进入写作" : "等待素材生成";

  return (
    <section className="project-workbench-section style-editor-panel" aria-label="项目风格卡">
      <div className="project-style-head">
        <div className="project-style-heading">
          <span className="project-style-kicker">
            <FileText aria-hidden="true" size={14} />
            项目资产
          </span>
          <h2>风格卡</h2>
          <p className="pane-subtitle">{styleStatus}</p>
        </div>
        <div className="project-style-actions">
          <span className={`status-pill ${isDirty || !selectedProjectMeta ? "pending" : "done"}`}>{saveLabel}</span>
          <button className="btn" disabled={busy === "style"} onClick={onGenerateStyle} type="button">
            <Sparkles aria-hidden="true" size={16} />
            {busy === "style" ? "生成中" : generateLabel}
          </button>
          {canShowSave ? (
            <button className="btn" disabled={!canSaveWorkspace} onClick={onSaveWorkspace} type="button">
              <Save aria-hidden="true" size={16} />
              {busy === "save" ? "保存中" : "保存"}
            </button>
          ) : null}
          <Link className={`btn primary ${canWrite ? "" : "disabled"}`} href={writerHref} aria-disabled={!canWrite}>
            写作
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </div>

      <div className="project-style-meta" aria-label="风格卡状态">
        <div>
          <span>字数</span>
          <strong>{styleCount || "0"}</strong>
        </div>
        <div>
          <span>来源</span>
          <strong>{selectedProjectMeta ? "当前项目" : "未绑定项目"}</strong>
        </div>
        <div>
          <span>状态</span>
          <strong>{busy === "style" ? "生成中" : isDirty ? "有修改" : "已同步"}</strong>
        </div>
      </div>

      {activeStyleJob && (activeStyleJob.status === "running" || activeStyleJob.status === "queued") ? (
        <div className="project-progress" role="status" aria-live="polite">
          <div className="project-progress-copy">
            <span>{activeStyleJob.message}</span>
            <strong>{activeStyleJob.progress}%</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${activeStyleJob.progress}%` }} />
          </div>
        </div>
      ) : null}

      {projectDetailLoading && selectedProjectMeta ? <p className="subtle">正在读取项目详情…</p> : null}

      <div className="project-style-document">
        <textarea
          aria-label="项目风格卡"
          autoComplete="off"
          className="project-workbench-style"
          value={styleDraft}
          onChange={(event) => onStyleDraftChange(event.target.value)}
          placeholder={EMPTY_STYLE}
        />
      </div>
    </section>
  );
}
