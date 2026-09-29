"use client";

import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { ModalBackdrop } from "@/components/ModalBackdrop";

export function ConfirmDialog({
  body,
  busy = false,
  cancelLabel = "取消",
  confirmLabel = "确认",
  title,
  onCancel,
  onConfirm
}: {
  body: ReactNode;
  busy?: boolean;
  cancelLabel?: string;
  confirmLabel?: string;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <ModalBackdrop disabled={busy} onClose={onCancel} initialFocusRef={cancelButtonRef}>
      <div
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        aria-modal="true"
        className="modal-panel confirm-panel"
        role="dialog"
        tabIndex={-1}
      >
        <div className="confirm-dialog-body">
          <div className="confirm-dialog-icon" aria-hidden="true">
            <AlertTriangle aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 id={titleId}>{title}</h2>
            <div className="confirm-dialog-content" id={descriptionId}>{body}</div>
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button className="btn" disabled={busy} ref={cancelButtonRef} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button className="btn danger" disabled={busy} onClick={onConfirm} type="button">
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
