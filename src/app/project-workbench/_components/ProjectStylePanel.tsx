"use client";

import Link from "next/link";
import { ArrowRight, Save, Sparkles } from "lucide-react";
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
  const saveLabel = busy === "style" ? "生成中" : selectedProjectMeta ? (isDirty ? "有修改" : "已保存") : "待保存";
  const canShowSave = canSaveWorkspace || busy === "save";
  const generateLabel = styleCount ? "重新生成" : "生成风格卡";
  const styleStatus = busy === "style" ? "正在生成项目风格卡" : styleCount ? `${styleCount} 字，可直接编辑` : "加入参考内容后生成，也可以直接填写";

  return (
    <section className="project-workbench-section style-editor-panel" aria-label="项目风格卡">
      <div className="project-style-head">
        <div className="project-style-heading">
          <div className="project-style-title-row">
            <h2>项目风格卡</h2>
            <span className={`status-pill ${isDirty || !selectedProjectMeta ? "pending" : "done"}`}>{saveLabel}</span>
          </div>
          <p className="pane-subtitle">{styleStatus}</p>
        </div>
        <div className="project-style-actions">
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

      {activeStyleJob && (activeStyleJob.status === "running" || activeStyleJob.status === "queued") ? (
        <div className="project-progress" role="status" aria-live="polite">
          <div className="project-progress-copy">
            <span>{activeStyleJob.message}</span>
            <strong>{activeStyleJob.progress}%</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ transform: `scaleX(${activeStyleJob.progress / 100})` }} />
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
