"use client";

import { memo } from "react";
import { CheckSquare, Trash2, X } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem } from "@/lib/types";

type AccountSidebarProps = {
  accountFilter: string;
  accountManageMode: boolean;
  accounts: AccountListItem[];
  allAccountCount: number;
  busy: string;
  selectedAccountId: string;
  selectedAccountIds: string[];
  totalTranscriptCount: number;
  onAccountFilterChange: (value: string) => void;
  onRequestDeleteAccounts: () => void;
  onSelectAccount: (accountId: string) => void;
  onToggleAccountManage: () => void;
  onToggleManagedAccount: (accountId: string) => void;
};

export const AccountSidebar = memo(function AccountSidebar({
  accountFilter,
  accountManageMode,
  accounts,
  allAccountCount,
  busy,
  selectedAccountId,
  selectedAccountIds,
  totalTranscriptCount,
  onAccountFilterChange,
  onRequestDeleteAccounts,
  onSelectAccount,
  onToggleAccountManage,
  onToggleManagedAccount
}: AccountSidebarProps) {
  return (
    <aside className={`pane ${accountManageMode ? "selection-mode" : ""}`}>
      <div className="pane-header">
        <div>
          <h2>{accountManageMode ? "选择账号" : "账号"}</h2>
          <p className="pane-subtitle">
            {accounts.length} / {allAccountCount} · {totalTranscriptCount} 转写
          </p>
        </div>
        <div className="account-manage-actions">
          <button
            className={`btn icon-btn icon-only ${accountManageMode ? "primary" : ""}`}
            aria-label={accountManageMode ? "退出账号选择" : "批量选择账号"}
            onClick={onToggleAccountManage}
            title={accountManageMode ? "退出选择" : "批量选择"}
            type="button"
          >
            {accountManageMode ? <X aria-hidden="true" size={15} /> : <CheckSquare aria-hidden="true" size={15} />}
          </button>
        </div>
      </div>
      {accountManageMode ? (
        <div className="selection-toolbar" role="toolbar" aria-label="账号批量操作">
          <div className="selection-copy">
            <strong>已选 {selectedAccountIds.length} 个</strong>
            <span>删除本地资料</span>
          </div>
          <button
            className="btn danger"
            disabled={!selectedAccountIds.length || busy === "account-delete"}
            onClick={onRequestDeleteAccounts}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
            {busy === "account-delete" ? "删除中" : "删除"}
          </button>
        </div>
      ) : null}
      <div className="pane-search">
        <input
          aria-label="搜索账号"
          autoComplete="off"
          name="accountFilter"
          value={accountFilter}
          onChange={(event) => onAccountFilterChange(event.target.value)}
          placeholder="搜索账号…"
        />
      </div>
      <div className="pane-body">
        {accounts.map((account) => {
          const selected = selectedAccountId === account.id;
          const managed = selectedAccountIds.includes(account.id);
          const completion = account.videoCount ? Math.round((account.transcriptCount / account.videoCount) * 100) : 0;
          return (
            <button
              aria-current={!accountManageMode && selected ? "true" : undefined}
              aria-pressed={accountManageMode ? managed : undefined}
              className={`list-button account-list-button ${selected ? "active" : ""} ${accountManageMode && managed ? "checked" : ""}`}
              key={account.id}
              onClick={() => {
                if (accountManageMode) {
                  onToggleManagedAccount(account.id);
                  return;
                }
                onSelectAccount(account.id);
              }}
              type="button"
            >
              {accountManageMode ? <span className={`check-dot ${managed ? "checked" : ""}`} aria-hidden="true" /> : null}
              <span>
                <span className="list-title">{account.name}</span>
                <span className="list-meta">
                  {formatPlatform(account.platform)} · {account.videoCount} 条 · {account.transcriptCount} 转写
                </span>
                <span className="list-progress" aria-label={`转写覆盖 ${completion}%`}>
                  <span style={{ width: `${completion}%` }} />
                </span>
              </span>
            </button>
          );
        })}
        {!accounts.length ? <p className="subtle">没有匹配的账号。</p> : null}
      </div>
    </aside>
  );
});
