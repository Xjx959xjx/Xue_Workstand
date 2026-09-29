"use client";

import { Check, FileText, LinkIcon, Plus, Trash2, UsersRound } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem, CopySource } from "@/lib/types";
import { SourceRow } from "./SourceRow";

type CasePipelinePanelProps = {
  accounts: AccountListItem[];
  availableSourceCount: number;
  managedSourceIds: string[];
  projectSources: CopySource[];
  selectedAccounts: AccountListItem[];
  sourcePoolManage: boolean;
  deletingSourcePool: boolean;
  onDeleteSelectedPoolSources: () => void;
  onOpenAccountPicker: () => void;
  onOpenLinkIntake: () => void;
  onOpenSourcePicker: () => void;
  onOpenSourcePreview: (source: CopySource) => void;
  onToggleAccount: (accountId: string) => void;
  onToggleManagedSource: (sourceId: string) => void;
  onToggleSourcePoolManage: () => void;
};

export function CasePipelinePanel({
  accounts,
  availableSourceCount,
  managedSourceIds,
  projectSources,
  selectedAccounts,
  sourcePoolManage,
  deletingSourcePool,
  onDeleteSelectedPoolSources,
  onOpenAccountPicker,
  onOpenLinkIntake,
  onOpenSourcePicker,
  onOpenSourcePreview,
  onToggleAccount,
  onToggleManagedSource,
  onToggleSourcePoolManage
}: CasePipelinePanelProps) {
  const emptyAccountHint = accounts.length ? "未选择账号，将只按案例素材提炼风格。" : "暂无账号，可只用案例素材生成。";

  return (
    <aside className="project-workbench-section project-context-panel" aria-label="项目上下文">
      <div className="project-context-block">
        <div className="project-context-block-head">
          <div>
            <h2>参考资料</h2>
            <small>{projectSources.length ? `${projectSources.length} 份将参与风格提炼` : availableSourceCount ? "从已有素材或视频链接中加入" : "暂无已有素材，请先转写视频链接"}</small>
          </div>
          {projectSources.length ? (
            <div className="project-context-actions">
              {sourcePoolManage ? (
                <button className="btn compact danger mobile-destructive-action" disabled={!managedSourceIds.length || deletingSourcePool} onClick={onDeleteSelectedPoolSources} type="button">
                  <Trash2 aria-hidden="true" size={14} />
                  删除
                </button>
              ) : (
                <button className="btn compact" onClick={onOpenSourcePicker} type="button">
                  <Plus aria-hidden="true" size={14} />
                  加入
                </button>
              )}
              {!sourcePoolManage ? (
                <button className="btn compact" onClick={onOpenLinkIntake} type="button">
                  <LinkIcon aria-hidden="true" size={14} />
                  链接
                </button>
              ) : null}
              <button className="btn compact mobile-destructive-action" onClick={onToggleSourcePoolManage} type="button">
                {sourcePoolManage ? <Check aria-hidden="true" size={14} /> : null}
                {sourcePoolManage ? "完成" : "管理"}
              </button>
            </div>
          ) : null}
        </div>
        {sourcePoolManage ? <p className="microcopy">已选 {managedSourceIds.length} 份素材。</p> : null}

        {projectSources.length ? (
          <div className="project-workbench-source-list source-pool-scroll">
            {projectSources.map((source) => (
              <SourceRow
                compact
                key={source.id}
                actionLabel="查看"
                selected={sourcePoolManage ? managedSourceIds.includes(source.id) : false}
                selectedLabel="已选"
                source={source}
                managing={sourcePoolManage}
                manageSelected={managedSourceIds.includes(source.id)}
                onManageToggle={() => onToggleManagedSource(source.id)}
                onToggle={() => onOpenSourcePreview(source)}
              />
            ))}
          </div>
        ) : (
          <div className="project-reference-empty">
            <FileText aria-hidden="true" size={18} />
            <p>还没有案例素材</p>
            <div className="button-row">
              {availableSourceCount ? (
                <button className="btn compact" onClick={onOpenSourcePicker} type="button">
                  <Plus aria-hidden="true" size={14} />
                  选已有素材
                </button>
              ) : null}
              <button className="btn compact" onClick={onOpenLinkIntake} type="button">
                <LinkIcon aria-hidden="true" size={14} />
                转写链接
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="project-context-block project-account-supplement">
        <div className="project-context-block-head">
          <div>
            <h2>参考账号 <span>可选</span></h2>
            <small>{selectedAccounts.length ? `${selectedAccounts.length} 个账号将补充长期口吻` : "需要长期口吻时再添加"}</small>
          </div>
          <button className="btn compact" onClick={onOpenAccountPicker} type="button">
            <UsersRound aria-hidden="true" size={14} />
            选择
          </button>
        </div>
        {selectedAccounts.length ? (
          <div className="project-account-chip-list" aria-label="已选账号">
            {selectedAccounts.slice(0, 4).map((account) => (
              <button className="project-account-chip" key={account.id} onClick={() => onToggleAccount(account.id)} type="button" title="移除账号">
                <strong>{account.name}</strong>
                <span>{formatPlatform(account.platform)} · {account.transcriptCount}</span>
              </button>
            ))}
            {selectedAccounts.length > 4 ? <button className="project-account-chip muted" onClick={onOpenAccountPicker} type="button">+{selectedAccounts.length - 4}</button> : null}
          </div>
        ) : (
          <p className="microcopy">{emptyAccountHint}</p>
        )}
      </div>
    </aside>
  );
}
