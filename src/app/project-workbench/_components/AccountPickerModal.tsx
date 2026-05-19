"use client";

import type { KeyboardEvent } from "react";
import { Check, UsersRound, X } from "lucide-react";
import { isBackdropEvent } from "@/components/dialog-events";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem } from "@/lib/types";

type AccountPickerModalProps = {
  accounts: AccountListItem[];
  selectedAccountIds: string[];
  selectedAccounts: AccountListItem[];
  onClose: () => void;
  onToggleAccount: (accountId: string) => void;
};

export function AccountPickerModal({
  accounts,
  selectedAccountIds,
  selectedAccounts,
  onClose,
  onToggleAccount
}: AccountPickerModalProps) {
  const orderedAccounts = [...accounts].sort((left, right) => {
    const leftSelected = selectedAccountIds.includes(left.id);
    const rightSelected = selectedAccountIds.includes(right.id);
    if (leftSelected === rightSelected) return left.name.localeCompare(right.name, "zh-CN");
    return leftSelected ? -1 : 1;
  });
  const transcriptCount = selectedAccounts.reduce((sum, account) => sum + account.transcriptCount, 0);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (isBackdropEvent(event)) onClose();
      }}
    >
      <div aria-labelledby="account-picker-title" aria-modal="true" className="modal-panel account-picker-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="account-picker-title">补足风格账号</h2>
            <p className="pane-subtitle">选长期口吻相近的账号，素材池仍是主参考。</p>
          </div>
          <button className="btn icon-btn" aria-label="关闭账号选择弹窗" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="account-picker-body">
          <div className="account-picker-summary">
            <span className="project-account-summary-icon">
              <UsersRound aria-hidden="true" size={15} />
            </span>
            <span>
              <strong>已选 {selectedAccounts.length} 个账号</strong>
              <small>{transcriptCount ? `${transcriptCount} 份转写可参与风格补足` : "不选也可以直接用素材池生成"}</small>
            </span>
          </div>

          <div className="account-picker-list" aria-label="账号列表">
            {orderedAccounts.map((account) => {
              const checked = selectedAccountIds.includes(account.id);
              return (
                <label className={`account-picker-row ${checked ? "selected" : ""}`} key={account.id}>
                  <input checked={checked} onChange={() => onToggleAccount(account.id)} type="checkbox" />
                  <span>
                    <strong>{account.name}</strong>
                    <small>{formatPlatform(account.platform)} · {account.transcriptCount} 转写 · {account.videoCount} 视频</small>
                  </span>
                  <span className={`status-pill ${checked ? "done" : ""}`}>{checked ? "已选" : "可选"}</span>
                </label>
              );
            })}
            {!orderedAccounts.length ? <div className="project-workbench-empty compact">暂无账号，可先只用素材池生成。</div> : null}
          </div>
        </div>

        <div className="account-picker-footer">
          <span>{selectedAccounts.length ? `当前会补足 ${selectedAccounts.length} 个账号` : "当前不使用账号补足"}</span>
          <button className="btn primary" onClick={onClose} type="button">
            <Check aria-hidden="true" size={16} />
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
