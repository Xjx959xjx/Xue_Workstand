"use client";

import { Eye } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem, ProjectListItem } from "@/lib/types";

type WriterStylePanelProps = {
  activeStyle?: string;
  activeTitle?: string;
  selectedAccount: AccountListItem | null;
  selectedProject: ProjectListItem | null;
  targetType: "account" | "project";
  onOpenStyle: () => void;
};

export function WriterStylePanel({
  activeStyle,
  activeTitle,
  selectedAccount,
  selectedProject,
  targetType,
  onOpenStyle
}: WriterStylePanelProps) {
  return (
    <aside className="panel writer-style-panel">
      <div className="panel-inner detail-stack">
        <details className="style-reference" open>
          <summary>
            <span className="style-reference-heading">
              <span className="style-reference-title">引用风格</span>
              <small>{activeTitle || "未选择风格"}</small>
            </span>
          </summary>
          <div className="stat-row">
            {targetType === "project" && selectedProject ? (
              <>
                <span className="stat-pill">项目</span>
                <span className="stat-pill">{selectedProject.sourceAccounts.length} 个账号</span>
              </>
            ) : selectedAccount ? (
              <>
                <span className="stat-pill">{formatPlatform(selectedAccount.platform)}</span>
                <span className="stat-pill">{selectedAccount.transcriptCount} 份转写</span>
              </>
            ) : null}
          </div>
        </details>

        <div className="style-summary-card">
          <h3>{activeTitle || "未选择风格"}</h3>
          <p>{makeStylePreview(activeStyle)}</p>
          <button className="btn" disabled={!activeStyle} onClick={onOpenStyle} type="button">
            <Eye aria-hidden="true" size={16} />
            查看风格卡
          </button>
        </div>

        {targetType === "project" && selectedProject ? (
          <div>
            <h3>参考账号</h3>
            <div className="stat-row">
              {selectedProject.sourceAccounts.map((account) => (
                <span className="stat-pill" key={account.id}>
                  {formatPlatform(account.platform)} / {account.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function makeStylePreview(style?: string) {
  const text = (style || "").replace(/[#*_>`-]/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 180) : "暂无风格卡";
}
