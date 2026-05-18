"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, MessageSquarePlus, PenLine, RefreshCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { formatDate, formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { deleteDrafts } from "@/lib/client";
import { Draft } from "@/lib/types";

export default function DraftsPage() {
  const { library, loading, error, refresh } = useLibrary();
  const { notify } = useFeedback();
  const [selectedId, setSelectedId] = useState("");
  const [draftManageMode, setDraftManageMode] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const drafts = useMemo(() => library?.drafts || [], [library?.drafts]);

  const selectedDraft = useMemo(() => {
    return drafts.find((draft) => draft.id === selectedId) || drafts[0] || null;
  }, [drafts, selectedId]);
  const messageIsError = message.includes("失败") || message.includes("没有") || message.includes("不合法");

  useEffect(() => {
    if (!message) return;
    notify({ tone: messageIsError ? "error" : "success", message });
  }, [message, messageIsError, notify]);

  async function handleCopy() {
    if (!selectedDraft) return;
    await navigator.clipboard.writeText(selectedDraft.content);
  }

  function toggleManagedDraft(draftId: string) {
    setSelectedDraftIds((current) =>
      current.includes(draftId) ? current.filter((id) => id !== draftId) : [...current, draftId]
    );
  }

  function selectDraft(draftId: string) {
    if (draftManageMode) {
      toggleManagedDraft(draftId);
      return;
    }
    setSelectedId(draftId);
  }

  async function handleDeleteSelectedDrafts() {
    if (!selectedDraftIds.length) return;
    setBusy("draft-delete");
    setMessage("");
    try {
      const result = await deleteDrafts(selectedDraftIds);
      if (selectedDraft && selectedDraftIds.includes(selectedDraft.id)) {
        setSelectedId("");
      }
      setSelectedDraftIds([]);
      setDraftManageMode(false);
      setDeleteConfirmOpen(false);
      setMessage(`已删除 ${result.deleted.length} 个草稿。`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除草稿失败");
    } finally {
      setBusy("");
    }
  }

  if (!loading && !drafts.length) {
    return (
      <div className="page drafts-page">
        <header className="page-header workbench-header">
          <div>
            <p className="eyebrow">Drafts</p>
            <h1>草稿管理</h1>
            <p className="subtle">写作台保存后的内容会沉淀到这里。</p>
          </div>
        </header>
        <EmptyState title="还没有草稿" body="在对话写作页生成结果后，内容会自动写入对应账号或项目的 drafts 目录。" action={{ href: "/writer", label: "去写作台" }} />
      </div>
    );
  }

  return (
    <div className="page drafts-page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Drafts</p>
          <h1>草稿管理</h1>
          <p className="subtle">所有草稿来自本地账号目录，可按引用账号回溯风格来源。</p>
        </div>
        <div className="button-row">
          <span className="stat-pill">{drafts.length} 个草稿</span>
          <button className="btn" onClick={refresh} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            刷新
          </button>
        </div>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      <section className="panel three-pane drafts-workspace">
        <aside className={`pane ${draftManageMode ? "selection-mode" : ""}`}>
          <div className="pane-header">
            <h2>草稿</h2>
            <button
              className={`btn icon-btn ${draftManageMode ? "primary" : ""}`}
              aria-label={draftManageMode ? "完成草稿管理" : "管理草稿"}
              onClick={() => {
                setDraftManageMode((current) => !current);
                setSelectedDraftIds([]);
              }}
              title="管理草稿"
              type="button"
            >
              {draftManageMode ? "完成" : "管理"}
            </button>
          </div>
          {draftManageMode ? (
            <div className="selection-toolbar" role="toolbar" aria-label="草稿批量操作">
              <div className="selection-copy">
                <strong>草稿选择</strong>
                <span>已选 {selectedDraftIds.length} 个</span>
              </div>
              <button
                className="btn danger"
                disabled={!selectedDraftIds.length || busy === "draft-delete"}
                onClick={() => setDeleteConfirmOpen(true)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
                {busy === "draft-delete" ? "删除中…" : "删除草稿"}
              </button>
            </div>
          ) : null}
          <div className="pane-body">
            <div className="status-summary">
              <span>{drafts.length} 个草稿</span>
              <span>按保存时间排序</span>
            </div>
            {drafts.map((draft) => (
              <button
                aria-current={!draftManageMode && selectedDraft?.id === draft.id ? "true" : undefined}
                aria-pressed={draftManageMode ? selectedDraftIds.includes(draft.id) : undefined}
                className={`list-button ${selectedDraft?.id === draft.id ? "active" : ""} ${
                  draftManageMode && selectedDraftIds.includes(draft.id) ? "checked" : ""
                }`}
                key={draft.id}
                onClick={() => selectDraft(draft.id)}
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
            ))}
          </div>
        </aside>

        <section className="pane">
          <div className="pane-header">
            <h2>{selectedDraft?.title || "草稿详情"}</h2>
            <div className="button-row">
              {selectedDraft ? (
                <Link className="btn" href={buildRewriteHref(selectedDraft)} title="带入对话写作继续改写">
                  <PenLine aria-hidden="true" size={16} />
                  改写
                </Link>
              ) : null}
              {selectedDraft ? (
                <Link className="btn" href={`/assets?draftId=${encodeURIComponent(selectedDraft.id)}`} title="基于这篇草稿生成评论和弹幕">
                  <MessageSquarePlus size={16} />
                  评论生成
                </Link>
              ) : null}
              <button className="btn" disabled={!selectedDraft} onClick={handleCopy} type="button">
                <Copy aria-hidden="true" size={16} />
                复制
              </button>
            </div>
          </div>
          <div className="pane-body detail-stack">
            {selectedDraft ? (
              <>
                <div className="stat-row">
                  <span className="stat-pill">{selectedDraft.targetType === "project" ? "项目" : formatPlatform(selectedDraft.platform)}</span>
                  <span className="stat-pill">参考 {getDraftReferenceLabel(selectedDraft)}</span>
                  <span className="stat-pill">{formatDate(selectedDraft.createdAt)}</span>
                </div>
                <div>
                  <h3>需求</h3>
                  <div className="code-box">{selectedDraft.prompt}</div>
                </div>
                {selectedDraft.input ? (
                  <div>
                    <h3>原文</h3>
                    <div className="code-box">{selectedDraft.input}</div>
                  </div>
                ) : null}
                <div>
                  <h3>生成结果</h3>
                  <article className="markdown-box draft-document">{selectedDraft.content}</article>
                </div>
              </>
            ) : (
              <p className="subtle">选择一个草稿查看内容。</p>
            )}
          </div>
        </section>
      </section>
      {deleteConfirmOpen ? (
        <ConfirmDialog
          title="删除草稿"
          body={`将删除 ${selectedDraftIds.length} 个草稿及对应素材文件，此操作无法撤销。`}
          busy={busy === "draft-delete"}
          confirmLabel="删除草稿"
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={handleDeleteSelectedDrafts}
        />
      ) : null}
    </div>
  );
}

function getDraftReferenceLabel(draft: Draft) {
  return draft.targetType === "project" ? `项目 ${draft.projectName}` : draft.accountName;
}

function buildRewriteHref(draft: Draft) {
  const params = new URLSearchParams({
    mode: "rewrite",
    draftId: draft.id
  });

  if (draft.targetType === "project") {
    params.set("targetType", "project");
    params.set("projectId", draft.projectId);
  } else {
    params.set("targetType", "account");
    params.set("accountId", draft.accountId);
  }

  return `/writer?${params.toString()}`;
}
