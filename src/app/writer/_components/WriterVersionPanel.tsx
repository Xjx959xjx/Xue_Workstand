"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Columns2, History } from "lucide-react";
import { getDraft } from "@/lib/client";
import { formatDate } from "@/components/Formatters";
import type { Draft, DraftSummary } from "@/lib/types";
import { WriterDialogModal } from "./WriterDialogModal";

type Props = {
  drafts: DraftSummary[];
  currentId: string;
  currentContent: string;
  hasUnsavedChanges: boolean;
  disabled: boolean;
  onClose: () => void;
  onContinue: (draft: DraftSummary) => Promise<boolean>;
};

export function WriterVersionPanel({ drafts, currentId, currentContent, hasUnsavedChanges, disabled, onClose, onContinue }: Props) {
  const [selectedId, setSelectedId] = useState(currentId);
  const [preview, setPreview] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comparing, setComparing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [retry, setRetry] = useState(0);
  const selected = drafts.find((draft) => draft.id === selectedId);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setPreview(null);
    setError("");
    getDraft(selectedId).then((draft) => {
      if (!ignore) setPreview(draft);
    }).catch((failure) => {
      if (!ignore) setError(failure instanceof Error ? failure.message : "读取版本失败，请重试。");
    }).finally(() => {
      if (!ignore) setLoading(false);
    });
    return () => { ignore = true; };
  }, [selectedId, retry]);

  return (
    <WriterDialogModal labelledBy="writer-versions-title" onClose={onClose} panelClassName="writer-versions-dialog">
      <div className="modal-header"><div><h2 id="writer-versions-title">本稿版本 <span className="writer-optional">{drafts.length}</span></h2><p className="pane-subtitle">先预览、再选择；关闭后继续当前编辑。</p></div><button className="btn compact" onClick={onClose} type="button">返回编辑</button></div>
      <div className="writer-versions-body">
        <nav className="writer-version-list" aria-label="本稿已保存版本">
          {drafts.map((draft) => (
            <button type="button" className={`writer-version-item ${draft.id === selectedId ? "active" : ""}`} key={draft.id} aria-pressed={draft.id === selectedId} disabled={opening} onClick={() => setSelectedId(draft.id)}>
              <span><History size={14} aria-hidden="true" />V{draft.version?.revision || 1}{draft.id === currentId ? <small>当前</small> : null}</span>
              <strong>{draft.version?.instruction || (draft.version?.origin === "manual_edit" ? "手动编辑" : draft.version?.origin === "revision" ? "继续修改" : "首次生成")}</strong>
              <time>{formatDate(draft.createdAt)}</time>
            </button>
          ))}
        </nav>
        <section className="writer-version-preview" aria-busy={loading}>
          <div className="writer-version-preview-head"><strong>V{selected?.version?.revision || 1} · 已保存版本</strong><button type="button" className="btn compact" aria-pressed={comparing} onClick={() => setComparing((value) => !value)}><Columns2 size={15} aria-hidden="true" />{comparing ? "关闭对照" : "与当前稿对照"}</button></div>
          {loading ? <p role="status" className="subtle">正在读取版本…</p> : error ? <div className="error" role="alert">{error}<button className="btn compact" onClick={() => setRetry((value) => value + 1)} type="button">重试</button></div> : (
            <div className={`writer-version-comparison ${comparing ? "is-comparing" : ""}`}>
              <div><span className="writer-version-caption">V{preview?.version?.revision || 1} · 只读预览</span><pre>{preview?.content}</pre></div>
              {comparing ? <div><span className="writer-version-caption">当前编辑内容{hasUnsavedChanges ? " · 含未保存修改" : ""}</span><pre>{currentContent}</pre></div> : null}
            </div>
          )}
          <div className="writer-version-preview-footer"><span>选择旧版不会删除后续版本。</span><button type="button" className="btn primary compact" disabled={disabled || opening || loading || !preview || !selected || selectedId === currentId} onClick={async () => {
            if (!selected) return;
            setOpening(true);
            try {
              if (await onContinue(selected)) onClose();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "打开版本失败，请重试。");
            } finally { setOpening(false); }
          }}>{opening ? "打开中…" : "以此版本继续"}<ArrowRight size={14} aria-hidden="true" /></button></div>
        </section>
      </div>
    </WriterDialogModal>
  );
}
