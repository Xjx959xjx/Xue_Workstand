"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDate, formatPlatform } from "@/components/Formatters";
import type { Draft } from "@/lib/types";

type WriterHistoryPanelProps = {
  drafts: Draft[];
  loading: boolean;
  selectedDraftId: string;
  onSelectDraft: (draft: Draft) => void;
  onRenameDraft: (draft: Draft, title: string) => Promise<void>;
  onDeleteDraft: (draft: Draft) => Promise<void>;
  onDeleteDrafts: (drafts: Draft[]) => Promise<void>;
};

type DraftContextMenu = {
  draft: Draft;
  x: number;
  y: number;
};

export function WriterHistoryPanel({
  drafts,
  loading,
  selectedDraftId,
  onSelectDraft,
  onRenameDraft,
  onDeleteDraft,
  onDeleteDrafts
}: WriterHistoryPanelProps) {
  const [editingDraftId, setEditingDraftId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<DraftContextMenu | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Draft | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const skipBlurSubmitRef = useRef(false);

  useEffect(() => {
    if (!editingDraftId) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingDraftId]);

  useEffect(() => {
    if (!drafts.length) {
      setManageMode(false);
      setSelectedDraftIds([]);
      return;
    }

    setSelectedDraftIds((current) => current.filter((id) => drafts.some((draft) => draft.id === id)));
  }, [drafts]);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };

    const handleScroll = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const contextMenuStyle = useMemo(() => {
    if (!contextMenu) return undefined;
    const menuWidth = 172;
    const menuHeight = 52;
    const viewportWidth = typeof window === "undefined" ? contextMenu.x + menuWidth : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? contextMenu.y + menuHeight : window.innerHeight;
    return {
      left: Math.max(8, Math.min(contextMenu.x, viewportWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(contextMenu.y, viewportHeight - menuHeight - 8))
    };
  }, [contextMenu]);

  const handleStartRename = (draft: Draft) => {
    if (renameBusy) return;
    skipBlurSubmitRef.current = false;
    setContextMenu(null);
    setEditingDraftId(draft.id);
    setEditingTitle(draft.title);
  };

  const handleCancelRename = () => {
    if (renameBusy) return;
    skipBlurSubmitRef.current = true;
    setEditingDraftId("");
    setEditingTitle("");
  };

  const handleSubmitRename = async (draft: Draft) => {
    if (renameBusy) return;
    const nextTitle = editingTitle.replace(/\s+/g, " ").trim();

    if (!nextTitle || nextTitle === draft.title) {
      setEditingDraftId("");
      setEditingTitle("");
      return;
    }

    setRenameBusy(true);
    try {
      await onRenameDraft(draft, nextTitle);
      setEditingDraftId("");
      setEditingTitle("");
    } catch {
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    } finally {
      setRenameBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await onDeleteDraft(deleteTarget);
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const selectedDrafts = useMemo(
    () => drafts.filter((draft) => selectedDraftIds.includes(draft.id)),
    [drafts, selectedDraftIds]
  );
  const allDraftsSelected = Boolean(drafts.length) && selectedDraftIds.length === drafts.length;

  const toggleManageMode = () => {
    setContextMenu(null);
    setEditingDraftId("");
    setEditingTitle("");
    setManageMode((current) => {
      const next = !current;
      if (!next) setSelectedDraftIds([]);
      return next;
    });
  };

  const toggleDraftSelection = (draftId: string) => {
    setSelectedDraftIds((current) =>
      current.includes(draftId) ? current.filter((id) => id !== draftId) : [...current, draftId]
    );
  };

  const toggleSelectAll = () => {
    setSelectedDraftIds(allDraftsSelected ? [] : drafts.map((draft) => draft.id));
  };

  const handleConfirmBulkDelete = async () => {
    if (!selectedDrafts.length || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await onDeleteDrafts(selectedDrafts);
      setBulkDeleteOpen(false);
      setManageMode(false);
      setSelectedDraftIds([]);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <aside className="panel writer-history-panel">
        <div className="writer-history-shell">
          <div className="writer-history-header">
            <div>
              <h2>历史记录</h2>
              <p className="pane-subtitle">全部账号和项目</p>
            </div>
            <div className="writer-history-header-actions">
              <span className="stat-pill">{drafts.length} 条</span>
              <button className="btn compact" disabled={!drafts.length || loading} onClick={toggleManageMode} type="button">
                {manageMode ? "取消" : "批量"}
              </button>
            </div>
          </div>

          <div className="writer-history-body">
            {manageMode ? (
              <div className="writer-history-toolbar" role="toolbar" aria-label="历史记录批量操作">
                <button className="btn compact" onClick={toggleSelectAll} type="button">
                  {allDraftsSelected ? "取消全选" : "全选"}
                </button>
                <span>{selectedDraftIds.length} 已选</span>
                <button
                  className="btn danger compact"
                  disabled={!selectedDraftIds.length}
                  onClick={() => setBulkDeleteOpen(true)}
                  type="button"
                >
                  删除
                </button>
              </div>
            ) : null}

            {loading ? (
              <p className="subtle">正在读取历史记录。</p>
            ) : drafts.length ? (
              <div className="writer-history-list">
                {drafts.map((draft) => {
                  const active = selectedDraftId === draft.id;
                  const editing = editingDraftId === draft.id;
                  return editing ? (
                    <div
                      aria-current={active ? "true" : undefined}
                      className={`list-button writer-history-editing ${active ? "active" : ""}`}
                      key={draft.id}
                    >
                      <span className="writer-history-copy">
                        <input
                          aria-label="草稿名称"
                          className="writer-history-title-input"
                          disabled={renameBusy}
                          maxLength={40}
                          onBlur={() => {
                            if (skipBlurSubmitRef.current) {
                              skipBlurSubmitRef.current = false;
                              return;
                            }
                            void handleSubmitRename(draft);
                          }}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleSubmitRename(draft);
                              return;
                            }

                            if (event.key === "Escape") {
                              event.preventDefault();
                              handleCancelRename();
                            }
                          }}
                          ref={inputRef}
                          value={editingTitle}
                        />
                        <span className="list-meta">
                          {getDraftReferenceLabel(draft)} · {formatDate(draft.createdAt)}
                        </span>
                      </span>
                      <span className="status-pill done">{renameBusy ? "保存中" : draft.mode === "topic" ? "主题" : "改写"}</span>
                    </div>
                  ) : (
                    <button
                      aria-current={active ? "true" : undefined}
                      aria-pressed={manageMode ? selectedDraftIds.includes(draft.id) : undefined}
                      className={`list-button ${active ? "active" : ""} ${manageMode && selectedDraftIds.includes(draft.id) ? "checked" : ""}`}
                      key={draft.id}
                      onClick={() => {
                        if (manageMode) {
                          toggleDraftSelection(draft.id);
                          return;
                        }

                        onSelectDraft(draft);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (manageMode) return;
                        setContextMenu(null);
                        setContextMenu({
                          draft,
                          x: event.clientX,
                          y: event.clientY
                        });
                      }}
                      type="button"
                    >
                      {manageMode ? (
                        <span className="writer-history-check" aria-hidden="true">
                          {selectedDraftIds.includes(draft.id) ? "✓" : ""}
                        </span>
                      ) : null}
                      <span
                        className="writer-history-copy"
                        onDoubleClick={(event) => {
                          if (manageMode) return;
                          event.preventDefault();
                          handleStartRename(draft);
                        }}
                        title="双击重命名草稿，右键可删除"
                      >
                        <span className="list-title">{draft.title}</span>
                        <span className="list-meta">
                          {getDraftReferenceLabel(draft)} · {formatDate(draft.createdAt)}
                        </span>
                      </span>
                      <span className="status-pill done">{draft.mode === "topic" ? "主题" : "改写"}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="subtle">还没有历史记录。生成后的内容会保存在这里。</p>
            )}
          </div>
        </div>
      </aside>

      {contextMenu ? (
        <div
          className="history-context-menu"
          ref={contextMenuRef}
          role="menu"
          style={contextMenuStyle}
        >
          <button
            className="history-context-menu-item danger"
            onClick={() => {
              setDeleteTarget(contextMenu.draft);
              setContextMenu(null);
            }}
            type="button"
          >
            删除草稿
          </button>
        </div>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          body={`删除后这条历史记录会从本地移除，无法恢复。确认删除“${deleteTarget.title}”吗？`}
          busy={deleteBusy}
          confirmLabel="删除"
          title="删除草稿"
          onCancel={() => {
            if (!deleteBusy) setDeleteTarget(null);
          }}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}

      {bulkDeleteOpen ? (
        <ConfirmDialog
          body={`将从本地移除 ${selectedDrafts.length} 条历史记录，删除后无法恢复。确认继续吗？`}
          busy={deleteBusy}
          confirmLabel="删除"
          title="批量删除草稿"
          onCancel={() => {
            if (!deleteBusy) setBulkDeleteOpen(false);
          }}
          onConfirm={() => void handleConfirmBulkDelete()}
        />
      ) : null}
    </>
  );
}

function getDraftReferenceLabel(draft: Draft) {
  return draft.targetType === "project"
    ? `项目 / ${draft.projectName}`
    : `${formatPlatform(draft.platform)} / ${draft.accountName}`;
}
