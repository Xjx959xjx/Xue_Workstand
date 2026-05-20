"use client";

import { Check, ChevronDown, FolderKanban, Plus, Trash2, UsersRound } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import type { AccountListItem, CopySource, ProjectListItem } from "@/lib/types";
import { SourceRow } from "./SourceRow";

type CasePipelinePanelProps = {
  accounts: AccountListItem[];
  isDirty: boolean;
  managedSourceIds: string[];
  projectDescription: string;
  projectName: string;
  projectSources: CopySource[];
  selectedAccounts: AccountListItem[];
  selectedProjectMeta: ProjectListItem | null;
  sourcePoolManage: boolean;
  deletingSourcePool: boolean;
  onDeleteSelectedPoolSources: () => void;
  onOpenAccountPicker: () => void;
  onOpenSourceAddModal: () => void;
  onOpenProjectModal: () => void;
  onOpenSourcePreview: (source: CopySource) => void;
  onToggleAccount: (accountId: string) => void;
  onToggleManagedSource: (sourceId: string) => void;
  onToggleSourcePoolManage: () => void;
};

export function CasePipelinePanel({
  accounts,
  isDirty,
  managedSourceIds,
  projectDescription,
  projectName,
  projectSources,
  selectedAccounts,
  selectedProjectMeta,
  sourcePoolManage,
  deletingSourcePool,
  onDeleteSelectedPoolSources,
  onOpenAccountPicker,
  onOpenSourceAddModal,
  onOpenProjectModal,
  onOpenSourcePreview,
  onToggleAccount,
  onToggleManagedSource,
  onToggleSourcePoolManage
}: CasePipelinePanelProps) {
  const title = projectName.trim() || selectedProjectMeta?.name || "未命名项目";
  const saveState = selectedProjectMeta ? (isDirty ? "未保存" : "已保存") : projectName.trim() ? "待保存" : "未命名";
  const emptyAccountHint = accounts.length ? "未选择时，仅用素材池生成风格卡。" : "暂无账号，可只用素材池生成。";
  const contextSummary = projectSources.length
    ? `${projectSources.length} 份案例素材将参与风格提炼`
    : "先放入 1-3 个高质量案例，风格卡会更稳。";

  return (
    <aside className="project-workbench-section project-context-panel" aria-label="项目上下文">
      <button className="project-context-summary project-context-summary-button" onClick={onOpenProjectModal} type="button">
        <span className="project-context-icon">
          <FolderKanban aria-hidden="true" size={15} />
        </span>
          <span className="project-context-summary-copy">
            <span className="project-context-title-row">
              <strong>{title}</strong>
              <span className={`project-save-state ${isDirty || !selectedProjectMeta ? "pending" : "done"}`}>{saveState}</span>
            </span>
            <small>{projectDescription.trim() || "填写项目说明"}</small>
          </span>
          <ChevronDown aria-hidden="true" size={15} />
      </button>

      <div className="project-context-readiness" aria-label="当前输入">
        <div>
          <strong>{projectSources.length}</strong>
          <span>案例素材</span>
        </div>
        <div>
          <strong>{selectedAccounts.length}</strong>
          <span>参考账号</span>
        </div>
      </div>
      <p className="project-context-note">{contextSummary}</p>

      <div className="project-context-block">
        <div className="project-context-block-head">
          <div>
            <h3>素材池</h3>
            <small>{projectSources.length} 份案例素材</small>
          </div>
          {projectSources.length ? (
            <div className="project-context-actions">
              {sourcePoolManage ? (
                <button className="btn compact danger" disabled={!managedSourceIds.length || deletingSourcePool} onClick={onDeleteSelectedPoolSources} type="button">
                  <Trash2 aria-hidden="true" size={14} />
                  删除
                </button>
              ) : (
                <button className="btn compact" onClick={onOpenSourceAddModal} type="button">
                  <Plus aria-hidden="true" size={14} />
                  添加
                </button>
              )}
              <button className="btn compact" onClick={onToggleSourcePoolManage} type="button">
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
          <button className="project-workbench-empty action" onClick={onOpenSourceAddModal} type="button">
            添加素材
          </button>
        )}
      </div>

      <div className="project-context-block project-account-supplement">
        <div className="project-context-block-head">
          <div>
            <h3>参考账号</h3>
            <small>{selectedAccounts.length ? `${selectedAccounts.length} 个已选` : "可选补充长期口吻"}</small>
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
