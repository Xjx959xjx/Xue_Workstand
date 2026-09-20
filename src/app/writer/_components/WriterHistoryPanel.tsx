"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDate, formatPlatform } from "@/components/Formatters";
import type { DraftSummary } from "@/lib/types";

type WriterHistoryPanelProps = {
  drafts: DraftSummary[];
  loading: boolean;
  open: boolean;
  selectedDraftId: string;
  onClose: () => void;
  onSelectDraft: (draft: DraftSummary) => Promise<void>;
  onRenameDraft: (draft: DraftSummary, title: string) => Promise<void>;
  onDeleteDraft: (draft: DraftSummary) => Promise<void>;
  onDeleteDrafts: (drafts: DraftSummary[]) => Promise<void>;
};

type DraftContextMenu = {
  draft: DraftSummary;
  x: number;
  y: number;
};

type DraftSession = {
  id: string;
  drafts: DraftSummary[];
  latest: DraftSummary;
};

export const WriterHistoryPanel = memo(function WriterHistoryPanel({
  drafts,
  loading,
  open,
  selectedDraftId,
  onClose,
  onSelectDraft,
  onRenameDraft,
  onDeleteDraft,
  onDeleteDrafts
}: WriterHistoryPanelProps) {
  const [editingDraftId, setEditingDraftId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<DraftContextMenu | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DraftSummary | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [historyView, setHistoryView] = useState<"current" | "all">("current");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [expandedSessionIds, setExpandedSessionIds] = useState<string[]>([]);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [openingDraftId, setOpeningDraftId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const skipBlurSubmitRef = useRef(false);
  const sessions = useMemo(() => groupDraftSessions(drafts), [drafts]);
  const selectedSessionId = useMemo(
    () => sessions.find((session) => session.drafts.some((draft) => draft.id === selectedDraftId))?.id || "",
    [selectedDraftId, sessions]
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [selectedSessionId, sessions]
  );
  const visibleSessions = useMemo(() => {
    if (historyView === "current") return selectedSession ? [selectedSession] : [];
    const query = normalizeHistorySearch(searchQuery);
    if (!query) return sessions;
    return sessions.filter((session) => session.drafts.some((draft) => draftMatchesSearch(draft, query)));
  }, [historyView, searchQuery, selectedSession, sessions]);
  const selectableDraftIds = useMemo(
    () => visibleSessions.flatMap((session) => session.drafts.map((draft) => draft.id)),
    [visibleSessions]
  );
  const selectedDraftIdSet = useMemo(() => new Set(selectedDraftIds), [selectedDraftIds]);
  const selectedDrafts = useMemo(
    () => visibleSessions.flatMap((session) => session.drafts).filter((draft) => selectedDraftIdSet.has(draft.id)),
    [selectedDraftIdSet, visibleSessions]
  );
  const allVisibleDraftsSelected = Boolean(selectableDraftIds.length)
    && selectableDraftIds.every((draftId) => selectedDraftIdSet.has(draftId));

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setHistoryView(selectedSessionId ? "current" : "all");
      setSearchQuery("");
    } else if (!open && wasOpenRef.current) {
      setContextMenu(null);
      setEditingDraftId("");
      setEditingTitle("");
      setManageMode(false);
      setSelectedDraftIds([]);
      setOpeningDraftId("");
    }
    wasOpenRef.current = open;
  }, [open, selectedSessionId]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleteTarget && !bulkDeleteOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [bulkDeleteOpen, deleteTarget, onClose, open]);

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

    const draftIds = new Set(drafts.map((draft) => draft.id));
    const sessionIds = new Set(sessions.map((session) => session.id));
    setSelectedDraftIds((current) => current.filter((id) => draftIds.has(id)));
    setExpandedSessionIds((current) => current.filter((id) => sessionIds.has(id)));
  }, [drafts, sessions]);

  useEffect(() => {
    const selectable = new Set(selectableDraftIds);
    setSelectedDraftIds((current) => current.filter((id) => selectable.has(id)));
  }, [selectableDraftIds]);

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
    const menuHeight = 96;
    const viewportWidth = typeof window === "undefined" ? contextMenu.x + menuWidth : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? contextMenu.y + menuHeight : window.innerHeight;
    return {
      left: Math.max(8, Math.min(contextMenu.x, viewportWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(contextMenu.y, viewportHeight - menuHeight - 8))
    };
  }, [contextMenu]);

  const handleStartRename = (draft: DraftSummary) => {
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

  const handleSubmitRename = async (draft: DraftSummary) => {
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

  const handleHistoryViewChange = (nextView: "current" | "all") => {
    setContextMenu(null);
    setEditingDraftId("");
    setEditingTitle("");
    setSelectedDraftIds([]);
    setHistoryView(nextView);
  };

  const toggleDraftSelection = (draftId: string) => {
    setSelectedDraftIds((current) =>
      current.includes(draftId) ? current.filter((id) => id !== draftId) : [...current, draftId]
    );
  };

  const toggleSelectAll = () => {
    const visibleIds = new Set(selectableDraftIds);
    setSelectedDraftIds((current) => {
      if (allVisibleDraftsSelected) return current.filter((id) => !visibleIds.has(id));
      return [...new Set([...current, ...selectableDraftIds])];
    });
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

  const openDraftMenu = (draft: DraftSummary, target: HTMLButtonElement) => {
    const rect = target.getBoundingClientRect();
    setContextMenu({
      draft,
      x: rect.right - 172,
      y: rect.bottom + 4
    });
  };

  const renderDraftRow = (draft: DraftSummary, nested: boolean) => {
    const active = selectedDraftId === draft.id;
    const editing = editingDraftId === draft.id;
    const checked = selectedDraftIdSet.has(draft.id);
    const versionLabel = `V${draft.version?.revision || 1}`;
    const versionDetail = draft.version?.instruction || (draft.version?.origin === "manual_edit" ? "手动编辑" : "初稿");
    const meta = nested || historyView === "current"
      ? `${versionDetail} · ${formatDate(draft.createdAt)}`
      : `${getDraftReferenceLabel(draft)} · ${formatDate(draft.createdAt)}`;

    if (editing) {
      return (
        <div
          aria-current={active ? "true" : undefined}
          className={`writer-history-row writer-history-editing ${nested ? "nested" : ""} ${active ? "active" : ""}`}
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
      <div
        className={`writer-history-row ${nested ? "nested" : ""} ${active ? "active" : ""} ${manageMode && checked ? "checked" : ""}`}
        key={draft.id}
        onContextMenu={(event) => {
          event.preventDefault();
          if (manageMode) return;
          setContextMenu({ draft, x: event.clientX, y: event.clientY });
        }}
      >
        {manageMode ? (
          <button
            aria-label={`${checked ? "取消选择" : "选择"}${draft.title} ${versionLabel}`}
            aria-pressed={checked}
            className="writer-history-check"
            onClick={() => toggleDraftSelection(draft.id)}
            type="button"
          >
            {checked ? <Check aria-hidden="true" size={12} strokeWidth={3} /> : null}
          </button>
        ) : null}
        <button
          aria-current={active ? "true" : undefined}
          aria-pressed={manageMode ? checked : undefined}
          className="writer-history-row-main"
          disabled={Boolean(openingDraftId)}
          onClick={() => {
            if (manageMode) {
              toggleDraftSelection(draft.id);
              return;
            }
            setOpeningDraftId(draft.id);
            void onSelectDraft(draft)
              .then(onClose)
              .catch(() => undefined)
              .finally(() => setOpeningDraftId(""));
          }}
          type="button"
        >
          <span className="writer-history-copy">
            <span className="list-title">{draft.title}</span>
            <span className="list-meta">{meta}</span>
          </span>
          <span className="status-pill done">{openingDraftId === draft.id ? "读取中" : versionLabel}</span>
        </button>
        {!manageMode ? (
          <button
            aria-label={`管理“${draft.title}”${versionLabel}`}
            aria-haspopup="menu"
            className="btn ghost icon-only small writer-history-more"
            onClick={(event) => openDraftMenu(draft, event.currentTarget)}
            title="版本操作"
            type="button"
          >
            <MoreHorizontal aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {open ? (
        <div
          className="writer-history-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
          role="presentation"
        >
          <aside
            aria-labelledby="writer-history-title"
            aria-modal="true"
            className={`writer-history-panel ${manageMode ? "selection-mode" : ""}`}
            role="dialog"
          >
            <div className="writer-history-shell">
              <div className="writer-history-header">
                <div>
                  <h2 id="writer-history-title">版本历史</h2>
                  <p className="pane-subtitle">从当前任务切换版本，或搜索全部写作会话</p>
                </div>
                <div className="writer-history-header-actions">
                  <button
                    className="btn compact mobile-destructive-action"
                    disabled={!drafts.length || loading}
                    onClick={toggleManageMode}
                    type="button"
                  >
                    {manageMode ? "退出管理" : "批量管理"}
                  </button>
                  <button aria-label="关闭版本历史" className="btn icon-only compact" onClick={onClose} type="button">
                    <X aria-hidden="true" size={16} />
                  </button>
                </div>
              </div>

              <div className="writer-history-controls">
                <div aria-label="历史范围" className="segmented writer-history-tabs" role="group">
                  <button
                    aria-pressed={historyView === "current"}
                    className={historyView === "current" ? "active" : ""}
                    disabled={!selectedSessionId}
                    onClick={() => handleHistoryViewChange("current")}
                    type="button"
                  >
                    当前任务
                    <span className="writer-history-tab-count">{selectedSession?.drafts.length || 0}</span>
                  </button>
                  <button
                    aria-pressed={historyView === "all"}
                    className={historyView === "all" ? "active" : ""}
                    onClick={() => handleHistoryViewChange("all")}
                    type="button"
                  >
                    全部会话
                    <span className="writer-history-tab-count">{sessions.length}</span>
                  </button>
                </div>

                {historyView === "all" ? (
                  <div className="writer-history-search" role="search">
                    <Search aria-hidden="true" size={16} />
                    <input
                      aria-label="搜索写作会话"
                      autoComplete="off"
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="搜索标题、账号或项目"
                      value={searchQuery}
                    />
                    {searchQuery ? (
                      <button aria-label="清空搜索" onClick={() => setSearchQuery("")} type="button">
                        <X aria-hidden="true" size={14} />
                      </button>
                    ) : null}
                  </div>
                ) : selectedSession ? (
                  <div className="writer-history-current-summary">
                    <strong>{selectedSession.latest.title}</strong>
                    <span>{getDraftReferenceLabel(selectedSession.latest)} · {selectedSession.drafts.length} 个版本</span>
                  </div>
                ) : null}
              </div>

              <div className="writer-history-body">

                {loading ? (
                  <HistoryLoadingRows />
                ) : visibleSessions.length ? (
                  <div className="writer-history-list">
                    {historyView === "current" && selectedSession
                      ? selectedSession.drafts.map((draft) => renderDraftRow(draft, false))
                      : visibleSessions.map((session) => {
                      if (session.drafts.length === 1) return renderDraftRow(session.latest, false);
                      const expanded = manageMode || Boolean(searchQuery.trim()) || expandedSessionIds.includes(session.id);
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
                  <div className="writer-history-empty">
                    <strong>{searchQuery ? "没有匹配的写作会话" : sessions.length ? "当前还没有选中的写作任务" : "还没有写作会话"}</strong>
                    <p>{searchQuery ? "换个标题、账号或项目名试试。" : "首稿和后续修改会按版本保存在这里。"}</p>
                  </div>
                )}
              </div>

              {manageMode ? (
                <div className="writer-history-selectionbar" role="toolbar" aria-label="历史版本批量操作">
                  <button className="btn compact" disabled={!selectableDraftIds.length} onClick={toggleSelectAll} type="button">
                    {allVisibleDraftsSelected ? <Check aria-hidden="true" size={14} /> : null}
                    {allVisibleDraftsSelected ? "取消全选" : "全选当前范围"}
                  </button>
                  <span className="writer-history-selection-count">
                    已选 <strong>{selectedDrafts.length}</strong> / {selectableDraftIds.length}
                  </span>
                  <button className="btn compact" onClick={toggleManageMode} type="button">取消</button>
                  <button
                    className="btn danger compact mobile-destructive-action"
                    disabled={!selectedDrafts.length}
                    onClick={() => setBulkDeleteOpen(true)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                    删除{selectedDrafts.length ? ` ${selectedDrafts.length}` : ""}
                  </button>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {contextMenu ? (
        <div className="history-context-menu" ref={contextMenuRef} role="menu" style={contextMenuStyle}>
          <button
            className="history-context-menu-item"
            onClick={() => handleStartRename(contextMenu.draft)}
            role="menuitem"
            type="button"
          >
            <Pencil aria-hidden="true" size={15} />
            重命名
          </button>
          <button
            className="history-context-menu-item danger mobile-destructive-action"
            onClick={() => {
              setDeleteTarget(contextMenu.draft);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} />
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
});

function groupDraftSessions(drafts: DraftSummary[]): DraftSession[] {
  const grouped = new Map<string, DraftSummary[]>();
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

function getDraftReferenceLabel(draft: DraftSummary) {
  return draft.targetType === "project"
    ? `项目 / ${draft.projectName}`
    : `${formatPlatform(draft.platform)} / ${draft.accountName}`;
}

function normalizeHistorySearch(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}

function draftMatchesSearch(draft: DraftSummary, query: string) {
  const searchText = [
    draft.title,
    getDraftReferenceLabel(draft),
    draft.version?.instruction,
    `V${draft.version?.revision || 1}`
  ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
  return searchText.includes(query);
}
