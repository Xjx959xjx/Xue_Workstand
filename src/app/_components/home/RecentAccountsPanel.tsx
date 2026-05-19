"use client";

import Link from "next/link";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem } from "@/lib/types";

type RecentAccountsPanelProps = {
  loading: boolean;
  recentAccounts: AccountListItem[];
};

export function RecentAccountsPanel({ loading, recentAccounts }: RecentAccountsPanelProps) {
  return (
    <div className="panel">
      <div className="panel-inner">
        <div className="section-title-row">
          <h2>最近账号</h2>
          <Link className="text-link" href="/library">
            进入账号库
          </Link>
        </div>
        {loading ? <p className="subtle">正在读取本地风格库…</p> : null}
        {!loading && !recentAccounts.length ? (
          <div className="empty-action">
            <p className="subtle">还没有参考账号。先在上方输入账号名或主页链接，采集后再整理风格。</p>
            <span className="status-pill pending">等待第一个参考账号</span>
          </div>
        ) : null}
        <div className="detail-stack">
          {recentAccounts.map((account) => (
            <Link className="account-row compact-link-row" href="/library" key={account.id}>
              <div>
                <span className="list-title">{account.name}</span>
                <span className="list-meta">
                  {formatPlatform(account.platform)} · {account.videoCount} 条视频 · {account.transcriptCount} 份转写
                </span>
                <div className="stat-row account-status-row">
                  {account.videoCount === 0 ? <span className="status-pill pending">继续采集</span> : null}
                  {account.videoCount > 0 && account.transcriptCount === 0 ? (
                    <span className="status-pill pending">待转写</span>
                  ) : null}
                  {account.transcriptCount > 0 ? <span className="status-pill done">可参考写作</span> : null}
                </div>
              </div>
              <span className="row-arrow">打开</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
