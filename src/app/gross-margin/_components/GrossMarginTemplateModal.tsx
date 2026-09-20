"use client";

import { useMemo, useRef, useState } from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { ModalBackdrop } from "@/components/ModalBackdrop";
import {
  grossMarginReviewTemplateVariables,
  renderGrossMarginReviewTemplate,
  type GrossMarginReviewTemplateValues
} from "@/lib/gross-margin-template";
import type { GrossMarginReviewTemplate } from "@/lib/types";

export function GrossMarginTemplateModal({
  busy,
  platformLabel,
  previewValues,
  template,
  onClose,
  onReset,
  onSave
}: {
  busy: boolean;
  platformLabel: string;
  previewValues: GrossMarginReviewTemplateValues;
  template: GrossMarginReviewTemplate;
  onClose: () => void;
  onReset: () => Promise<void>;
  onSave: (value: string) => Promise<void>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(template.content);
  const preview = useMemo(() => {
    try {
      return { text: renderGrossMarginReviewTemplate(draft, previewValues), error: "" };
    } catch (error) {
      return { text: "", error: error instanceof Error ? error.message : "文案模板无法预览" };
    }
  }, [draft, previewValues]);
  const canSave = Boolean(draft.trim()) && !preview.error && !busy;
  const lineCount = useMemo(() => draft.split("\n").filter((line) => line.trim()).length, [draft]);

  function insertVariable(name: string) {
    const token = `{{${name}}}`;
    const textarea = textareaRef.current;
    if (!textarea) {
      setDraft((current) => `${current}${current.endsWith("\n") || !current ? "" : "\n"}${token}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${draft.slice(0, start)}${token}${draft.slice(end)}`;
    setDraft(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + token.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        aria-labelledby="gross-template-modal-title"
        aria-modal="true"
        className="modal-panel gross-template-modal"
        role="dialog"
        tabIndex={-1}
      >
        <header className="gross-template-header">
          <div>
            <h2 id="gross-template-modal-title">{platformLabel}文案模板</h2>
            <p className="subtle">
              {lineCount} 行，{template.customized ? "当前使用永久自定义模板" : "当前使用系统默认模板"}
            </p>
          </div>
          <button aria-label="关闭文案模板弹窗" className="btn icon-btn icon-only" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="gross-template-layout">
          <section className="gross-template-edit-column" aria-label="编辑模板">
            <label className="field gross-template-editor">
              <span>模板内容</span>
              <textarea
                autoComplete="off"
                name="grossTemplateContent"
                ref={textareaRef}
                rows={18}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <div className="gross-template-variable-list" aria-label="可插入变量">
              {grossMarginReviewTemplateVariables.map((variable) => (
                <button className="btn compact" key={variable.name} onClick={() => insertVariable(variable.name)} type="button">
                  {`{{${variable.name}}}`}
                </button>
              ))}
            </div>
          </section>

          <aside className="gross-template-preview" aria-label="文案预览">
            <div className="gross-template-preview-head">
              <strong>实时预览</strong>
              <span>{preview.error ? "需修正" : `${countTemplateLines(preview.text)} 行`}</span>
            </div>
            {preview.error ? (
              <p className="gross-template-error" role="alert">
                {preview.error}
              </p>
            ) : (
              <pre>{preview.text}</pre>
            )}
          </aside>
        </div>

        <footer className="button-row gross-template-actions">
          <button className="btn" disabled={busy} onClick={onClose} type="button">
            取消
          </button>
          <button className="btn" disabled={busy} onClick={() => setDraft(template.defaultContent)} type="button">
            <RotateCcw aria-hidden="true" size={15} />
            套用默认
          </button>
          <button className="btn" disabled={busy || !template.customized} onClick={() => void onReset()} type="button">
            <RotateCcw aria-hidden="true" size={15} />
            恢复系统默认
          </button>
          <button
            aria-busy={busy}
            className="btn primary"
            disabled={!canSave}
            onClick={() => void onSave(draft)}
            type="button"
          >
            <Save aria-hidden="true" size={15} />
            {busy ? "保存中" : "保存模板"}
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}

function countTemplateLines(value: string) {
  return value.split("\n").filter((line) => line.trim()).length;
}
