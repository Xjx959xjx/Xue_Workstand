"use client";

import { Trash2 } from "lucide-react";
import { formatDate } from "@/components/Formatters";
import type { Draft } from "@/lib/types";
import { getDraftReferenceLabel } from "./draft-view-utils";

type DraftListPaneProps = {
  busy: string;
  draftManageMode: boolean;
  drafts: Draft[];
  selectedDraft: Draft | null;
  selectedDraftIds: string[];
  onDeleteClick: () => void;
  onManageModeChange: (enabled: boolean) => void;
  onSelectDraft: (draftId: string) => void;
};

export function DraftListPane({
  busy,
  draftManageMode,
  drafts,
  selectedDraft,
  selectedDraftIds,
  onDeleteClick,
  onManageModeChange,
  onSelectDraft
}: DraftListPaneProps) {
  return (
    <aside className={`pane ${draftManageMode ? "selection-mode" : ""}`}>
      <div className="pane-header">
        <h2>草稿</h2>
        <button
          className={`btn icon-btn ${draftManageMode ? "primary" : ""}`}
          aria-label={draftManageMode ? "完成草稿管理" : "管理草稿"}
          onClick={() => onManageModeChange(!draftManageMode)}
          title="管理草稿"
          type="button"
        >
          {draftManageMode ? "完成" : "管理"}
        </button>
      </div>
      {draftManageMode ? (
        <div className="selection-toolbar" role="toolbar" aria-label="草稿批量操作">
          <div className="selection-copy">
            <strong>草稿选择</strong>
            <span>已选 {selectedDraftIds.length} 个</span>
          </div>
          <button
            className="btn danger"
            disabled={!selectedDraftIds.length || busy === "draft-delete"}
            onClick={onDeleteClick}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
            {busy === "draft-delete" ? "删除中…" : "删除草稿"}
          </button>
        </div>
      ) : null}
      <div className="pane-body">
        <div className="status-summary">
          <span>{drafts.length} 个草稿</span>
          <span>按保存时间排序</span>
        </div>
        {drafts.map((draft) => (
          <button
            aria-current={!draftManageMode && selectedDraft?.id === draft.id ? "true" : undefined}
            aria-pressed={draftManageMode ? selectedDraftIds.includes(draft.id) : undefined}
            className={`list-button ${selectedDraft?.id === draft.id ? "active" : ""} ${
              draftManageMode && selectedDraftIds.includes(draft.id) ? "checked" : ""
            }`}
            key={draft.id}
            onClick={() => onSelectDraft(draft.id)}
            type="button"
          >
            <span>
              <span className="list-title">{draft.title}</span>
              <span className="list-meta">
                {getDraftReferenceLabel(draft)} · {formatDate(draft.createdAt)}
              </span>
            </span>
            <span className="status-pill done">{draft.mode === "topic" ? "主题" : "改写"}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
