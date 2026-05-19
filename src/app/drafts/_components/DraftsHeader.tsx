"use client";

import { RefreshCw } from "lucide-react";

type DraftsHeaderProps = {
  count?: number;
  showActions?: boolean;
  onRefresh?: () => Promise<void>;
};

export function DraftsHeader({ count = 0, showActions, onRefresh }: DraftsHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">Drafts</p>
        <h1 className="title-with-emoji">
          <span aria-hidden="true" className="title-emoji">
            📝
          </span>
          <span>草稿管理</span>
        </h1>
        <p className="subtle">{showActions ? "所有草稿来自本地账号目录，可按引用账号回溯风格来源。" : "写作台保存后的内容会沉淀到这里。"}</p>
      </div>
      {showActions && onRefresh ? (
        <div className="button-row">
          <span className="stat-pill">{count} 个草稿</span>
          <button className="btn" onClick={onRefresh} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            刷新
          </button>
        </div>
      ) : null}
    </header>
  );
}
