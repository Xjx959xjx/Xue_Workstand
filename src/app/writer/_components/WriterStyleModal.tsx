"use client";

import { WriterDialogModal } from "./WriterDialogModal";

type WriterStyleModalProps = {
  activeStyle?: string;
  activeTitle?: string;
  onClose: () => void;
};

export function WriterStyleModal({ activeStyle, activeTitle, onClose }: WriterStyleModalProps) {
  return (
    <WriterDialogModal labelledBy="writer-style-dialog-title" onClose={onClose}>
      <div className="modal-header">
        <h2 id="writer-style-dialog-title">{activeTitle || "风格卡"}</h2>
        <button className="btn" onClick={onClose} type="button">
          关闭
        </button>
      </div>
      <div className="markdown-box modal-content">{activeStyle || "暂无风格卡"}</div>
    </WriterDialogModal>
  );
}
