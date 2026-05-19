"use client";

import { Copy, FileUp } from "lucide-react";

type AssetTextListProps = {
  title: string;
  items: string[];
  empty: string;
  onCopy: () => void;
  onPublish?: () => void;
  publishDisabled?: boolean;
  publishing?: boolean;
};

export function AssetTextList({
  title,
  items,
  empty,
  onCopy,
  onPublish,
  publishDisabled,
  publishing
}: AssetTextListProps) {
  return (
    <div className="asset-list-block">
      <div className="section-title-row">
        <h3>{title}</h3>
        <div className="button-row">
          <button className="btn" disabled={!items.length} onClick={onCopy} type="button">
            <Copy size={16} />
            复制
          </button>
          {onPublish ? (
            <button className="btn" disabled={!items.length || publishDisabled} onClick={onPublish} type="button">
              <FileUp size={16} />
              {publishing ? "导出中..." : "飞书文档"}
            </button>
          ) : null}
        </div>
      </div>
      <div className={`asset-text-list ${items.length ? "" : "empty"}`}>
        {items.length ? items.map((item, index) => <p key={`${index}-${item}`}>{item}</p>) : empty}
      </div>
    </div>
  );
}
