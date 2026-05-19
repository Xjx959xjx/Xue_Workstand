"use client";

import { memo, type RefObject } from "react";
import { Save, Sparkles } from "lucide-react";
import { LibraryEditorModal } from "./LibraryEditorModal";

type AccountStyleEditorModalProps = {
  busy: string;
  panelRef: RefObject<HTMLDivElement | null>;
  styleDraft: string;
  styleProgress: number;
  styleStage: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onGenerateStyle: () => void;
  onSaveStyle: () => void;
};

export const AccountStyleEditorModal = memo(function AccountStyleEditorModal({
  busy,
  panelRef,
  styleDraft,
  styleProgress,
  styleStage,
  onChange,
  onClose,
  onGenerateStyle,
  onSaveStyle
}: AccountStyleEditorModalProps) {
  return (
    <LibraryEditorModal labelledBy="library-style-modal-title" panelRef={panelRef} onClose={onClose}>
      <div className="modal-header">
        <h2 id="library-style-modal-title">账号风格卡</h2>
        <button className="btn" onClick={onClose} type="button">
          关闭
        </button>
      </div>
      <div className="modal-editor">
        <textarea
          aria-label="账号风格卡"
          autoComplete="off"
          name="accountStyle"
          value={styleDraft}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="button-row">
          <button className="btn progress-button" disabled={busy === "style"} onClick={onGenerateStyle} type="button">
            <span className="progress-button-fill" style={{ width: `${busy === "style" ? styleProgress : 0}%` }} />
            <span className="progress-button-content">
              <Sparkles aria-hidden="true" size={16} />
              {busy === "style" ? `自动总结中 ${styleProgress}%` : "自动总结"}
            </span>
          </button>
          <button className="btn primary" disabled={busy === "save-style" || busy === "style"} onClick={onSaveStyle} type="button">
            <Save aria-hidden="true" size={16} />
            保存
          </button>
        </div>
        {busy === "style" ? <p className="subtle">{styleStage}</p> : null}
      </div>
    </LibraryEditorModal>
  );
});
