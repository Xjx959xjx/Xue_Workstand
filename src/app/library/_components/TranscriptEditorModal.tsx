"use client";

import { memo, type RefObject } from "react";
import { Save } from "lucide-react";
import { LibraryEditorModal } from "./LibraryEditorModal";

type TranscriptEditorModalProps = {
  activeTranscript: string;
  busy: string;
  panelRef: RefObject<HTMLDivElement | null>;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export const TranscriptEditorModal = memo(function TranscriptEditorModal({
  activeTranscript,
  busy,
  panelRef,
  onChange,
  onClose,
  onSave
}: TranscriptEditorModalProps) {
  return (
    <LibraryEditorModal labelledBy="library-transcript-modal-title" panelRef={panelRef} onClose={onClose}>
      <div className="modal-header">
        <h2 id="library-transcript-modal-title">转写稿全文</h2>
        <button className="btn" onClick={onClose} type="button">
          关闭
        </button>
      </div>
      <div className="modal-editor">
        <textarea
          aria-label="转写稿全文"
          autoComplete="off"
          name="transcript"
          value={activeTranscript}
          onChange={(event) => onChange(event.target.value)}
          placeholder="暂无转写稿…"
        />
        <div className="button-row">
          <button
            className="btn primary"
            disabled={busy === "save-transcript"}
            onClick={onSave}
            type="button"
          >
            <Save aria-hidden="true" size={16} />
            保存转写稿
          </button>
        </div>
      </div>
    </LibraryEditorModal>
  );
});
