"use client";

import type { KeyboardEvent } from "react";
import { Plus, Save, X } from "lucide-react";
import { isBackdropEvent } from "@/components/dialog-events";
import type { ProjectListItem } from "@/lib/types";

type ProjectPickerModalProps = {
  busy: string;
  canSaveProject: boolean;
  projectDescription: string;
  projectName: string;
  projects: ProjectListItem[];
  selectedProjectId: string;
  onClose: () => void;
  onNewProject: () => void;
  onProjectDescriptionChange: (value: string) => void;
  onProjectNameChange: (value: string) => void;
  onSaveProject: () => void;
  onSelectProject: (projectId: string) => void;
};

export function ProjectPickerModal({
  busy,
  canSaveProject,
  projectDescription,
  projectName,
  projects,
  selectedProjectId,
  onClose,
  onNewProject,
  onProjectDescriptionChange,
  onProjectNameChange,
  onSaveProject,
  onSelectProject
}: ProjectPickerModalProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (isBackdropEvent(event)) onClose();
      }}
    >
      <div aria-labelledby="project-picker-title" aria-modal="true" className="modal-panel project-picker-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="project-picker-title">项目</h2>
            <p className="pane-subtitle">选择项目，或编辑当前项目资料。</p>
          </div>
          <div className="button-row">
            <button className="btn" onClick={onNewProject} type="button">
              <Plus aria-hidden="true" size={16} />
              新建
            </button>
            <button className="btn icon-btn" aria-label="关闭项目弹窗" onClick={onClose} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </div>

        <div className="project-picker-body">
          <div className="project-picker-column">
            <h3>项目列表</h3>
            <div className="project-picker-list" aria-label="项目列表">
              {projects.map((project) => (
                <button
                  className={`project-picker-row ${selectedProjectId === project.id ? "active" : ""}`}
                  key={project.id}
                  onClick={() => onSelectProject(project.id)}
                  type="button"
                >
                  <strong>{project.name}</strong>
                  <span>{project.sourceMaterialCount} 案例 · {project.sourceAccounts.length} 账号</span>
                </button>
              ))}
              {!projects.length ? <p className="subtle">暂无项目</p> : null}
            </div>
          </div>

          <div className="project-picker-form">
            <h3>项目信息</h3>
            <label className="field">
              <span>名称</span>
              <input autoComplete="off" value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} placeholder="项目名" />
            </label>
            <label className="field">
              <span>说明</span>
              <textarea autoComplete="off" value={projectDescription} onChange={(event) => onProjectDescriptionChange(event.target.value)} placeholder="用途、受众、方向" />
            </label>
            <button className="btn primary" disabled={!canSaveProject} onClick={onSaveProject} type="button">
              <Save aria-hidden="true" size={16} />
              {busy === "save" ? "保存中" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
