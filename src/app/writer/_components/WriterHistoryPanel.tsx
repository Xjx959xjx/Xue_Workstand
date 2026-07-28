"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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

type DraftSession = {
  id: string;
  drafts: Draft[];
  latest: Draft;
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
  const [expandedSessionIds, setExpandedSessionIds] = useState<string[]>([]);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const skipBlurSubmitRef = useRef(false);
  const sessions = useMemo(() => groupDraftSessions(drafts), [drafts]);
  const selectedSessionId = useMemo(
    () => sessions.find((session) => session.drafts.some((draft) => draft.id === selectedDraftId))?.id || "",
    [selectedDraftId, sessions]
  );

  useEffect(() => {
    if (!editingDraftId) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingDraftId]);

  useEffect(() => {
    if (!drafts.length) {
      setManageMode(false);
      setSelectedDraftIds([]);
      setExpandedSessionIds([]);
      return;
    }

    setSelectedDraftIds((current) => current.filter((id) => drafts.some((draft) => draft.id === id)));
    setExpandedSessionIds((current) => current.filter((id) => sessions.some((session) => session.id === id)));
  }, [drafts, sessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setExpandedSessionIds((current) => current.includes(selectedSessionId) ? current : [...current, selectedSessionId]);
  }, [selectedSessionId]);

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

  const toggleSession = (sessionId: string) => {
    setExpandedSessionIds((current) =>
      current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId]
    );
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

  const renderDraftRow = (draft: Draft, nested: boolean) => {
    const active = selectedDraftId === draft.id;
    const editing = editingDraftId === draft.id;
    const versionLabel = `V${draft.version?.revision || 1}`;
    const versionDetail = draft.version?.instruction || (draft.version?.origin === "manual_edit" ? "手动编辑" : "初稿");
    const meta = nested
      ? `${versionDetail} · ${formatDate(draft.createdAt)}`
      : `${getDraftReferenceLabel(draft)} · ${formatDate(draft.createdAt)}`;

    if (editing) {
      return (
        <div
          aria-current={active ? "true" : undefined}
          className={`list-button writer-history-editing ${nested ? "nested" : ""} ${active ? "active" : ""}`}
          key={draft.id}
        >
          <span className="writer-history-copy">
            <input
              aria-label="草稿名称"
              autoComplete="off"
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
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  handleCancelRename();
                }
              }}
              ref={inputRef}
              value={editingTitle}
            />
            <span className="list-meta">{meta}</span>
          </span>
          <span className="status-pill done">{renameBusy ? "保存中" : versionLabel}</span>
        </div>
      );
    }

    return (
      <button
        aria-current={active ? "true" : undefined}
        aria-pressed={manageMode ? selectedDraftIds.includes(draft.id) : undefined}
        className={`list-button ${nested ? "nested" : ""} ${active ? "active" : ""} ${manageMode && selectedDraftIds.includes(draft.id) ? "checked" : ""}`}
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
          setContextMenu({ draft, x: event.clientX, y: event.clientY });
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
          title="双击重命名，右键删除此版本"
        >
          <span className="list-title">{draft.title}</span>
          <span className="list-meta">{meta}</span>
        </span>
        <span className="status-pill done">{versionLabel}</span>
      </button>
    );
  };

  return (
    <>
      <aside className="panel writer-history-panel">
        <div className="writer-history-shell">
          <div className="writer-history-header">
            <div>
              <h2>写作会话</h2>
              <p className="pane-subtitle">按会话查看版本</p>
            </div>
            <div className="writer-history-header-actions">
              <span className="stat-pill">{loading ? "读取中" : `${sessions.length} 组 · ${drafts.length} 版`}</span>
              <button className="btn compact" disabled={!drafts.length || loading} onClick={toggleManageMode} type="button">
                {manageMode ? "取消" : "批量"}
              </button>
            </div>
          </div>

          <div className="writer-history-body">
            {manageMode ? (
              <div className="writer-history-toolbar" role="toolbar" aria-label="历史版本批量操作">
                <button className="btn compact" onClick={toggleSelectAll} type="button">
                  {allDraftsSelected ? "取消全选" : "全选"}
                </button>
                <span>{selectedDraftIds.length} 已选</span>
                <button className="btn danger compact" disabled={!selectedDraftIds.length} onClick={() => setBulkDeleteOpen(true)} type="button">
                  删除
                </button>
              </div>
            ) : null}

            {loading ? (
              <HistoryLoadingRows />
            ) : sessions.length ? (
              <div className="writer-history-list">
                {sessions.map((session) => {
                  if (session.drafts.length === 1) return renderDraftRow(session.latest, false);
                  const expanded = expandedSessionIds.includes(session.id);
                  return (
                    <section className={`writer-history-session ${selectedSessionId === session.id ? "active" : ""}`} key={session.id}>
                      <button
                        aria-expanded={expanded}
                        className="writer-history-session-toggle"
                        onClick={() => toggleSession(session.id)}
                        type="button"
                      >
                        {expanded ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
                        <span>
                          <strong>{session.latest.title}</strong>
                          <small>{getDraftReferenceLabel(session.latest)} · {session.drafts.length} 个版本</small>
                        </span>
                      </button>
                      {expanded ? (
                        <div className="writer-history-revisions">
                          {session.drafts.map((draft) => renderDraftRow(draft, true))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : (
              <p className="subtle">还没有写作会话。首稿和后续修改会按版本保存在这里。</p>
            )}
          </div>
        </div>
      </aside>

      {contextMenu ? (
        <div className="history-context-menu" ref={contextMenuRef} role="menu" style={contextMenuStyle}>
          <button
            className="history-context-menu-item danger"
            onClick={() => {
              setDeleteTarget(contextMenu.draft);
              setContextMenu(null);
            }}
            type="button"
          >
            删除此版本
          </button>
        </div>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          body={`删除后这个版本会从本地移除，无法恢复；同一会话里的其他版本会保留。确认删除“${deleteTarget.title}”吗？`}
          busy={deleteBusy}
          confirmLabel="删除"
          title="删除版本"
          onCancel={() => {
            if (!deleteBusy) setDeleteTarget(null);
          }}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}

      {bulkDeleteOpen ? (
        <ConfirmDialog
          body={`将从本地移除 ${selectedDrafts.length} 个版本，删除后无法恢复。确认继续吗？`}
          busy={deleteBusy}
          confirmLabel="删除"
          title="批量删除版本"
          onCancel={() => {
            if (!deleteBusy) setBulkDeleteOpen(false);
          }}
          onConfirm={() => void handleConfirmBulkDelete()}
        />
      ) : null}
    </>
  );
}

function groupDraftSessions(drafts: Draft[]): DraftSession[] {
  const grouped = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const sessionId = draft.version?.sessionId || draft.id;
    const sessionDrafts = grouped.get(sessionId) || [];
    sessionDrafts.push(draft);
    grouped.set(sessionId, sessionDrafts);
  }

  return [...grouped.entries()]
    .map(([id, sessionDrafts]) => {
      const ordered = [...sessionDrafts].sort((left, right) => {
        const revisionDelta = (right.version?.revision || 1) - (left.version?.revision || 1);
        return revisionDelta || +new Date(right.createdAt) - +new Date(left.createdAt);
      });
      return { id, drafts: ordered, latest: ordered[0] };
    })
    .sort((left, right) => +new Date(right.latest.createdAt) - +new Date(left.latest.createdAt));
}

function HistoryLoadingRows() {
  return (
    <div className="history-loading-list" aria-busy="true" aria-label="正在读取历史记录">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="history-placeholder-row" key={index}>
          <span className="history-placeholder-copy">
            <span />
            <small />
          </span>
          <em />
        </div>
      ))}
    </div>
  );
}

function getDraftReferenceLabel(draft: Draft) {
  return draft.targetType === "project"
    ? `项目 / ${draft.projectName}`
    : `${formatPlatform(draft.platform)} / ${draft.accountName}`;
}
