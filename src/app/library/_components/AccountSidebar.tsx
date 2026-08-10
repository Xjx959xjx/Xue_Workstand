"use client";

import { memo } from "react";
import { CheckCircle2, Search, Trash2, X } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem } from "@/lib/types";
import type { AccountPlatformFilter, AccountSortMode, AccountStatusFilter } from "../_hooks/useLibrarySelection";

type AccountSidebarProps = {
  accountFilter: string;
  accountManageMode: boolean;
  accountSort: AccountSortMode;
  accounts: AccountListItem[];
  allAccountCount: number;
  busy: string;
  loading: boolean;
  platformFilter: AccountPlatformFilter;
  selectedAccountId: string;
  selectedAccountIds: string[];
  statusFilter: AccountStatusFilter;
  totalMissingStyleCount: number;
  totalPendingTranscriptCount: number;
  totalTranscriptCount: number;
  onAccountFilterChange: (value: string) => void;
  onAccountSortChange: (value: AccountSortMode) => void;
  onClearFilters: () => void;
  onPlatformFilterChange: (value: AccountPlatformFilter) => void;
  onRequestDeleteAccounts: () => void;
  onSelectAccount: (accountId: string) => void;
  onStatusFilterChange: (value: AccountStatusFilter) => void;
  onToggleAccountManage: () => void;
  onToggleAllAccounts: () => void;
  onToggleManagedAccount: (accountId: string) => void;
};

export const AccountSidebar = memo(function AccountSidebar({
  accountFilter,
  accountManageMode,
  accountSort,
  accounts,
  allAccountCount,
  busy,
  loading,
  platformFilter,
  selectedAccountId,
  selectedAccountIds,
  statusFilter,
  totalMissingStyleCount,
  totalPendingTranscriptCount,
  totalTranscriptCount,
  onAccountFilterChange,
  onAccountSortChange,
  onClearFilters,
  onPlatformFilterChange,
  onRequestDeleteAccounts,
  onSelectAccount,
  onStatusFilterChange,
  onToggleAccountManage,
  onToggleAllAccounts,
  onToggleManagedAccount
}: AccountSidebarProps) {
  const allVisibleSelected = Boolean(accounts.length && accounts.every((account) => selectedAccountIds.includes(account.id)));
  return (
    <aside className={`pane ${accountManageMode ? "selection-mode" : ""}`}>
      <div className="pane-header">
        <div>
          <h2>{accountManageMode ? "选择账号" : "账号"}</h2>
          <p className="pane-subtitle">
            {loading
              ? "正在读取本地库"
              : `${accounts.length}/${allAccountCount} · ${totalPendingTranscriptCount} 待转写 · ${totalMissingStyleCount} 待风格`}
          </p>
          <span className="sr-only">账号库共有 {totalTranscriptCount} 份转写稿</span>
        </div>
        <div className="account-manage-actions">
          <button
            className={`btn icon-btn icon-only mobile-destructive-action ${accountManageMode ? "primary" : ""}`}
            aria-label={accountManageMode ? "退出账号选择" : "批量选择账号"}
            onClick={onToggleAccountManage}
            title={accountManageMode ? "退出选择" : "批量选择"}
            type="button"
          >
            {accountManageMode ? <X aria-hidden="true" size={15} /> : <CheckCircle2 aria-hidden="true" size={15} />}
          </button>
        </div>
      </div>
      {accountManageMode ? (
        <div className="selection-toolbar" role="toolbar" aria-label="账号批量操作">
          <button className="btn compact" disabled={!accounts.length} onClick={onToggleAllAccounts} type="button">
            {allVisibleSelected ? "清空" : "全选当前"}
          </button>
          <div className="selection-copy">
            <strong>已选 {selectedAccountIds.length} 个</strong>
          </div>
          <button
            className="btn danger compact mobile-destructive-action"
            disabled={!selectedAccountIds.length || busy === "account-delete"}
            onClick={onRequestDeleteAccounts}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
            {busy === "account-delete" ? "删除中" : "删除"}
          </button>
        </div>
      ) : null}
      <div className="pane-search account-filter-stack">
        <div className="search-control filter-search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="搜索账号"
            autoComplete="off"
            name="accountFilter"
            value={accountFilter}
            onChange={(event) => onAccountFilterChange(event.target.value)}
            placeholder="搜索账号…"
            type="search"
          />
        </div>
        <div className="account-filter-row">
          <select className="filter-select" aria-label="筛选账号平台" onChange={(event) => onPlatformFilterChange(event.target.value as AccountPlatformFilter)} value={platformFilter}>
            <option value="all">全部平台</option>
            <option value="bilibili">B站</option>
            <option value="douyin">抖音</option>
          </select>
          <select className="filter-select" aria-label="筛选账号状态" onChange={(event) => onStatusFilterChange(event.target.value as AccountStatusFilter)} value={statusFilter}>
            <option value="all">全部状态</option>
            <option value="pending">待转写</option>
            <option value="missing-style">待风格</option>
          </select>
          <select className="filter-select" aria-label="账号排序" onChange={(event) => onAccountSortChange(event.target.value as AccountSortMode)} value={accountSort}>
            <option value="recent">最近采集</option>
            <option value="pending">待转写最多</option>
            <option value="videos">视频最多</option>
            <option value="name">账号名称</option>
          </select>
        </div>
      </div>
      <div className="pane-body">
        {accounts.map((account) => {
          const selected = selectedAccountId === account.id;
          const managed = selectedAccountIds.includes(account.id);
          return (
            <button
              aria-current={!accountManageMode && selected ? "true" : undefined}
              aria-pressed={accountManageMode ? managed : undefined}
              className={`list-button account-list-button ${selected ? "active" : ""} ${accountManageMode && managed ? "checked" : ""}`}
              key={account.id}
              onClick={() => accountManageMode ? onToggleManagedAccount(account.id) : onSelectAccount(account.id)}
              type="button"
            >
              {accountManageMode ? <span className={`check-dot ${managed ? "checked" : ""}`} aria-hidden="true" /> : null}
              <span className={`account-avatar tone-${getAvatarTone(account.id)} ${account.avatarUrl ? "has-image" : ""}`} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {account.avatarUrl ? <img alt="" height={30} referrerPolicy="no-referrer" src={account.avatarUrl} width={30} /> : null}
                {getAccountInitial(account.name)}
              </span>
              <span className="account-list-copy">
                <span className="list-title">{account.name}</span>
                <span className="list-meta">
                  {formatPlatform(account.platform)} · {account.videoCount} 视频 · {account.missingTranscriptCount ? `待转写 ${account.missingTranscriptCount}` : "转写已齐"}
                </span>
                <span className="account-list-flags">
                  {account.styleStatus === "not_generated" ? <span className="status-text warning">待生成风格</span> : null}
                  {account.styleStatus === "fallback" ? <span className="status-text warning">降级风格</span> : null}
                  {account.lastCollectedAt ? <span>采集 {formatShortDate(account.lastCollectedAt)}</span> : <span>尚未采集</span>}
                </span>
              </span>
            </button>
          );
        })}
        {loading ? (
          <div className="library-loading-list" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, index) => <span className="library-loading-row account" key={index} />)}
          </div>
        ) : null}
        {!loading && !accounts.length ? (
          <div className="library-filter-empty">
            <p className="subtle">没有匹配的账号。</p>
            <button className="btn compact" onClick={onClearFilters} type="button">清除筛选</button>
          </div>
        ) : null}
      </div>
    </aside>
  );
});

function getAccountInitial(name: string) {
  return Array.from(name.trim()).at(0)?.toLocaleUpperCase("zh-CN") || "账";
}

function getAvatarTone(id: string) {
  return Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 8;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(+date)) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}
