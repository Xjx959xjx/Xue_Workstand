"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { ModalBackdrop } from "@/components/ModalBackdrop";

export function GrossMarginTemplateModal({
  generatedValue,
  isCustomized,
  onClose,
  onSave,
  value
}: {
  generatedValue: string;
  isCustomized: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
  value: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(value);
  const canSave = Boolean(draft.trim());
  const lineCount = useMemo(() => draft.split("\n").filter((line) => line.trim()).length, [draft]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        aria-labelledby="gross-template-modal-title"
        aria-modal="true"
        className="modal-panel gross-template-modal"
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="gross-template-header">
          <div>
            <h2 id="gross-template-modal-title">文案模版</h2>
            <p className="subtle">{lineCount} 行，{isCustomized ? "当前使用已保存版本" : "当前使用自动生成版本"}</p>
          </div>
          <button aria-label="关闭文案模版弹窗" className="btn icon-btn icon-only" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <label className="field gross-template-editor">
          <span>内容</span>
          <textarea
            autoComplete="off"
            name="grossTemplateContent"
            rows={15}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>

        <footer className="button-row gross-template-actions">
          <button className="btn" onClick={onClose} type="button">
            取消
          </button>
          <button className="btn" onClick={() => setDraft(generatedValue)} type="button">
            <RotateCcw aria-hidden="true" size={15} />
            恢复自动生成
          </button>
          <button className="btn primary" disabled={!canSave} onClick={() => onSave(draft)} type="button">
            <Save aria-hidden="true" size={15} />
            保存模版
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
