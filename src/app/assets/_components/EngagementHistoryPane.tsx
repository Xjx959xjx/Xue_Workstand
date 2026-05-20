"use client";

import { formatDate } from "@/components/Formatters";
import type { EngagementRecord } from "@/lib/types";
import { formatSourceType } from "./asset-view-utils";

type EngagementHistoryPaneProps = {
  records: EngagementRecord[];
  resultRecord: EngagementRecord | null;
  onSelectRecord: (record: EngagementRecord) => void;
};

export function EngagementHistoryPane({ records, resultRecord, onSelectRecord }: EngagementHistoryPaneProps) {
  return (
    <aside className="panel engagement-history-pane">
      <div className="pane-header">
        <div>
          <h2>历史记录</h2>
          <p className="pane-subtitle">链接、粘贴和草稿都会保存</p>
        </div>
      </div>
      <div className="pane-body">
        <div className="status-summary">
          <span>{records.length} 条记录</span>
          <span>点击查看结果</span>
        </div>
        {records.length ? (
          records.map((record) => (
            <button
              aria-current={resultRecord?.id === record.id ? "true" : undefined}
              className={`list-button ${resultRecord?.id === record.id ? "active" : ""}`}
              key={record.id}
              onClick={() => onSelectRecord(record)}
              type="button"
            >
              <span>
                <span className="list-title">{record.title}</span>
                <span className="list-meta">
                  {formatSourceType(record.sourceType)} · {formatDate(record.createdAt)}
                </span>
              </span>
              <span className="status-pill done">{record.comments?.items.length || 0}/{record.danmaku?.items.length || 0}</span>
            </button>
          ))
        ) : (
          <p className="subtle">生成后会在这里保留记录。</p>
        )}
      </div>
    </aside>
  );
}
