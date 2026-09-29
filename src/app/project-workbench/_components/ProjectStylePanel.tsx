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
      <div className="project-style-heading">
        <span className="page-title-eyebrow">STYLE CARD</span>
        <h2>项目风格卡</h2>
        <label htmlFor="project-style-document">语气、结构与表达习惯</label>
        <p className="pane-subtitle" role="status">{styleStatus} · {saveLabel}</p>
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
          id="project-style-document"
          autoComplete="off"
          className="project-workbench-style"
          value={styleDraft}
          onChange={(event) => onStyleDraftChange(event.target.value)}
          placeholder={EMPTY_STYLE}
        />
      </div>
      <div className="project-style-actions">
        {canShowSave ? <button className="btn primary" disabled={!canSaveWorkspace} onClick={onSaveWorkspace} type="button"><Save aria-hidden="true" size={15} />{busy === "save" ? "保存中" : "保存风格卡"}</button> : null}
        <button className="btn" disabled={busy === "style"} onClick={onGenerateStyle} type="button"><Sparkles aria-hidden="true" size={15} />{busy === "style" ? "生成中" : generateLabel}</button>
        <Link className={`btn ${canWrite ? "" : "disabled"}`} href={writerHref} aria-disabled={!canWrite}>去写作<ArrowRight aria-hidden="true" size={15} /></Link>
      </div>
    </section>
  );
}
