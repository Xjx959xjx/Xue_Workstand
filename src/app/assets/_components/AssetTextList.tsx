"use client";

import type { ReactNode } from "react";
import { Copy, FileUp } from "lucide-react";

type AssetTextListProps = {
  title: string;
  items: string[];
  empty: string;
  onCopy: () => void;
  leadingActions?: ReactNode;
  onPublish?: () => void;
  publishDisabled?: boolean;
  publishing?: boolean;
};

export function AssetTextList({
  title,
  items,
  empty,
  onCopy,
  leadingActions,
  onPublish,
  publishDisabled,
  publishing
}: AssetTextListProps) {
  return (
    <div className="asset-list-block">
      <div className="section-title-row">
        <h3>{title}</h3>
        <div className="button-row">
          {leadingActions}
          <button
            aria-label={`复制${title}`}
            className="btn compact icon-only"
            disabled={!items.length}
            onClick={onCopy}
            title={`复制${title}`}
            type="button"
          >
            <Copy aria-hidden="true" size={16} />
          </button>
          {onPublish ? (
            <button
              aria-busy={publishing}
              aria-label={publishing ? `正在导出${title}到飞书` : `导出${title}到飞书`}
              className="btn compact icon-only"
              disabled={!items.length || publishDisabled}
              onClick={onPublish}
              title={publishing ? "正在导出到飞书" : "导出到飞书"}
              type="button"
            >
              <FileUp aria-hidden="true" size={16} />
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
