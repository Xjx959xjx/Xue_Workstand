"use client";

import { formatDate, formatPlatform } from "@/components/Formatters";
import type { Draft } from "@/lib/types";

type WriterHistoryPanelProps = {
  activeTitle?: string;
  drafts: Draft[];
  loading: boolean;
  selectedDraftId: string;
  onSelectDraft: (draft: Draft) => void;
};

export function WriterHistoryPanel({
  drafts,
  loading,
  selectedDraftId,
  onSelectDraft
}: WriterHistoryPanelProps) {
  return (
    <aside className="panel writer-history-panel">
      <div className="writer-history-shell">
        <div className="writer-history-header">
          <div>
            <h2>历史记录</h2>
            <p className="pane-subtitle">全部账号和项目</p>
          </div>
          <span className="stat-pill">{drafts.length} 条</span>
        </div>

        <div className="writer-history-body">
          <div className="status-summary">
            <span>全部记录</span>
            <span>按保存时间排序</span>
          </div>

          {loading ? (
            <p className="subtle">正在读取历史记录。</p>
          ) : drafts.length ? (
            <div className="writer-history-list">
              {drafts.map((draft) => {
                const active = selectedDraftId === draft.id;
                return (
                  <button
                    aria-current={active ? "true" : undefined}
                    className={`list-button ${active ? "active" : ""}`}
                    key={draft.id}
                    onClick={() => onSelectDraft(draft)}
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
                );
              })}
            </div>
          ) : (
            <p className="subtle">还没有历史记录。生成后的内容会保存在这里。</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function getDraftReferenceLabel(draft: Draft) {
  return draft.targetType === "project"
    ? `项目 / ${draft.projectName}`
    : `${formatPlatform(draft.platform)} / ${draft.accountName}`;
}
