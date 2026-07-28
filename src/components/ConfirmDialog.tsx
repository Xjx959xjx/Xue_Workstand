"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
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
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <ModalBackdrop disabled={busy} onClose={onCancel}>
      <div
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="modal-panel confirm-panel"
        onKeyDown={(event) => handleDialogKeyDown(event, busy, onCancel, onConfirm)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="confirm-dialog-body">
          <div className="confirm-dialog-icon" aria-hidden="true">
            <AlertTriangle aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 id="confirm-dialog-title">{title}</h2>
            <div className="confirm-dialog-content">{body}</div>
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button className="btn" disabled={busy} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button className="btn danger" disabled={busy} onClick={onConfirm} ref={confirmButtonRef} type="button">
            {busy ? "删除中…" : confirmLabel}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>, busy: boolean, onClose: () => void, onConfirm: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (!busy) onClose();
    return;
  }

  if (event.key === "Enter" && !busy) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.type !== "button") {
      event.preventDefault();
      onConfirm();
      return;
    }
  }

  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );

  if (!focusable.length) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (document.activeElement === event.currentTarget) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
