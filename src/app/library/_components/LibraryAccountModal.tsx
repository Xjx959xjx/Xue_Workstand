"use client";

import { memo, type RefObject } from "react";
import { Plus } from "lucide-react";
import type { Platform } from "@/lib/types";
import { LibraryEditorModal } from "./LibraryEditorModal";

type LibraryAccountModalProps = {
  busy: string;
  newAccountName: string;
  newAccountPlatform: Platform;
  newAccountUidOrUrl: string;
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onCreateAccount: () => void;
  onNewAccountNameChange: (value: string) => void;
  onNewAccountPlatformChange: (platform: Platform) => void;
  onNewAccountUidOrUrlChange: (value: string) => void;
};

export const LibraryAccountModal = memo(function LibraryAccountModal({
  busy,
  newAccountName,
  newAccountPlatform,
  newAccountUidOrUrl,
  panelRef,
  onClose,
  onCreateAccount,
  onNewAccountNameChange,
  onNewAccountPlatformChange,
  onNewAccountUidOrUrlChange
}: LibraryAccountModalProps) {
  return (
    <LibraryEditorModal
      labelledBy="library-account-modal-title"
      panelClassName="account-modal"
      panelRef={panelRef}
      onClose={onClose}
    >
      <div className="modal-header">
        <h2 id="library-account-modal-title">添加账号</h2>
        <button className="btn" onClick={onClose} type="button">
          关闭
        </button>
      </div>
      <div className="modal-editor">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="new-account-platform">平台</label>
            <select
              id="new-account-platform"
              name="platform"
              value={newAccountPlatform}
              onChange={(event) => onNewAccountPlatformChange(event.target.value as Platform)}
            >
              <option value="bilibili">B站</option>
              <option value="douyin">抖音</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-account-name">账号名</label>
            <input
              autoComplete="off"
              id="new-account-name"
              name="accountName"
              value={newAccountName}
              onChange={(event) => onNewAccountNameChange(event.target.value)}
              placeholder="例如：老青椒…"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="new-account-uid-or-url">UID 或主页链接</label>
          <input
            autoComplete="off"
            id="new-account-uid-or-url"
            name="uidOrUrl"
            value={newAccountUidOrUrl}
            onChange={(event) => onNewAccountUidOrUrlChange(event.target.value)}
            placeholder="可留空用 opencli 搜索；也可直接填写 UID / sec_uid / 主页链接…"
          />
        </div>
        <div className="button-row">
          <button className="btn primary" disabled={!newAccountName.trim() || busy === "account-create"} onClick={onCreateAccount} type="button">
            <Plus aria-hidden="true" size={16} />
            {busy === "account-create" ? "添加中…" : "添加账号"}
          </button>
        </div>
      </div>
    </LibraryEditorModal>
  );
});
