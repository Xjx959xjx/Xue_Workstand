"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDate } from "@/components/Formatters";
import type { EngagementRecord, EngagementRecordSummary } from "@/lib/types";
import { formatSourceType } from "./asset-view-utils";

type EngagementHistoryPaneProps = {
  loading: boolean;
  records: EngagementRecordSummary[];
  resultRecord: EngagementRecord | null;
  openingRecordId: string;
  onDeleteRecord: (record: EngagementRecordSummary) => Promise<void>;
  onExportRecord: (record: EngagementRecordSummary) => void;
  onSelectRecord: (record: EngagementRecordSummary) => Promise<void>;
};

type RecordContextMenu = {
  record: EngagementRecordSummary;
  x: number;
  y: number;
};

export function EngagementHistoryPane({
  loading,
  openingRecordId,
  records,
  resultRecord,
  onDeleteRecord,
  onExportRecord,
  onSelectRecord
}: EngagementHistoryPaneProps) {
  const [contextMenu, setContextMenu] = useState<RecordContextMenu | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EngagementRecordSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const selectedRecordRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!resultRecord?.id) return;
    selectedRecordRef.current?.scrollIntoView({ block: "nearest" });
  }, [records.length, resultRecord?.id]);

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

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await onDeleteRecord(deleteTarget);
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <aside className="panel engagement-history-pane">
        <div className="pane-header">
          <div>
            <h2>历史记录</h2>
            <p className="pane-subtitle">链接和文案都会保存</p>
          </div>
        </div>
        <div className="pane-body">
          <div className="status-summary">
            <span>{loading ? "读取中" : `${records.length} 条记录`}</span>
            <span>{loading ? "历史记录" : "点击查看结果"}</span>
          </div>
          {loading ? (
            <HistoryLoadingRows />
          ) : records.length ? (
            records.map((record) => (
              <button
                aria-current={resultRecord?.id === record.id ? "true" : undefined}
                className={`list-button ${resultRecord?.id === record.id ? "active" : ""}`}
                disabled={Boolean(openingRecordId)}
                key={record.id}
                onClick={() => void onSelectRecord(record)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({
                    record,
                    x: event.clientX,
                    y: event.clientY
                  });
                }}
                ref={resultRecord?.id === record.id ? selectedRecordRef : undefined}
                title="右键可删除这条记录"
                type="button"
              >
                <span>
                  <span className="list-title">{record.title}</span>
                  <span className="list-meta">
                    {formatSourceType(record.sourceType)} · {formatDate(record.createdAt)}
                  </span>
                </span>
                <span className="status-pill done">
                  {openingRecordId === record.id ? "读取中" : `${record.commentCount}/${record.danmakuCount}`}
                </span>
              </button>
            ))
          ) : (
            <p className="subtle">生成后会在这里保留记录。</p>
          )}
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
            className="history-context-menu-item"
            onClick={() => {
              onExportRecord(contextMenu.record);
              setContextMenu(null);
            }}
            type="button"
          >
            导出 Word
          </button>
          <button
            className="history-context-menu-item danger mobile-destructive-action"
            onClick={() => {
              setDeleteTarget(contextMenu.record);
              setContextMenu(null);
            }}
            type="button"
          >
            删除记录
          </button>
        </div>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          body={`删除后这条评论历史会从本地移除，无法恢复。确认删除“${deleteTarget.title}”吗？`}
          busy={deleteBusy}
          confirmLabel="删除"
          title="删除历史记录"
          onCancel={() => {
            if (!deleteBusy) setDeleteTarget(null);
          }}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}
    </>
  );
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
