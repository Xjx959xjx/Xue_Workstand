"use client";

import { formatDate, formatPlatform } from "@/components/Formatters";
import { isBackdropEvent } from "@/components/dialog-events";
import type { Draft } from "@/lib/types";
import { getDraftReferenceLabel } from "./asset-view-utils";

type SourcePreviewModalProps = {
  draft: Draft;
  onClose: () => void;
};

export function SourcePreviewModal({ draft, onClose }: SourcePreviewModalProps) {
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (isBackdropEvent(event)) onClose();
      }}
    >
      <div aria-labelledby="source-preview-title" aria-modal="true" className="modal-panel source-preview-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="source-preview-title">来源预览</h2>
            <p className="pane-subtitle">{draft.title}</p>
          </div>
          <button className="btn" onClick={onClose} type="button">
            关闭
          </button>
        </div>
        <div className="source-preview-body">
          <div className="stat-row">
            <span className="stat-pill">{draft.targetType === "project" ? "项目" : formatPlatform(draft.platform)}</span>
            <span className="stat-pill">{getDraftReferenceLabel(draft)}</span>
            <span className="stat-pill">{formatDate(draft.createdAt)}</span>
          </div>
          <article className="markdown-box draft-document">{draft.content}</article>
        </div>
      </div>
    </div>
  );
}
