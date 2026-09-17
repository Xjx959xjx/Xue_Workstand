"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { WriterDialogModal } from "./WriterDialogModal";
import { formatPlatform } from "@/components/Formatters";
import { writeStyleReferenceKey } from "@/lib/write-references";
import type { AccountListItem, ProjectListItem, WriteStyleReferenceInput } from "@/lib/types";

type WriterReferencePickerProps = {
  accounts: AccountListItem[];
  disabled?: boolean;
  onChange: (references: WriteStyleReferenceInput[]) => void;
  projects: ProjectListItem[];
  references: WriteStyleReferenceInput[];
};

type ReferenceOption = {
  key: string;
  label: string;
  meta: string;
  reference: WriteStyleReferenceInput;
};

const MAX_CONCURRENT_STYLES = 8;

export function WriterReferencePicker({
  accounts,
  disabled,
  onChange,
  projects,
  references
}: WriterReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = useMemo<ReferenceOption[]>(() => [
    ...projects.map((project) => ({
      key: writeStyleReferenceKey({ targetType: "project", projectId: project.id }),
      label: project.name,
      meta: `项目 · ${project.sourceAccounts.length} 个参考账号`,
      reference: { targetType: "project" as const, projectId: project.id }
    })),
    ...accounts.map((account) => ({
      key: writeStyleReferenceKey({ targetType: "account", platform: account.platform, accountId: account.id }),
      label: account.name,
      meta: `${formatPlatform(account.platform)}账号`,
      reference: { targetType: "account" as const, platform: account.platform, accountId: account.id }
    }))
  ], [accounts, projects]);
  const selectedKeys = useMemo(() => references.map(writeStyleReferenceKey), [references]);
  const selectedOptions = selectedKeys.flatMap((key) => {
    const option = options.find((item) => item.key === key);
    return option ? [option] : [];
  });
  const summary = selectedOptions.length > 1
    ? `已选 ${selectedOptions.length} 个风格 · 分别生成`
    : selectedOptions[0]?.label || "选择参考风格";

  const toggleReference = (option: ReferenceOption) => {
    const selected = selectedKeys.includes(option.key);
    if (selected && references.length === 1) return;
    if (!selected && references.length >= MAX_CONCURRENT_STYLES) return;
    onChange(selected
      ? references.filter((reference) => writeStyleReferenceKey(reference) !== option.key)
      : [...references, option.reference]);
  };

  const renderGroup = (label: string, group: ReferenceOption[]) => group.length ? (
    <section className="writer-reference-picker-group">
      <strong>{label}</strong>
      {group.map((option) => {
        const selected = selectedKeys.includes(option.key);
        return (
          <div className="writer-picker-option-row" key={option.key}>
          <button
            aria-checked={selected}
            className="writer-reference-option"
            disabled={(selected && references.length === 1) || (!selected && references.length >= MAX_CONCURRENT_STYLES)}
            onClick={() => toggleReference(option)}
            role="checkbox"
            type="button"
          >
            <span className={`writer-reference-check ${selected ? "selected" : ""}`} aria-hidden="true">
              {selected ? <Check size={13} /> : null}
            </span>
            <span className="writer-reference-option-copy">
              <span>{option.label}</span>
              <small>{option.meta}</small>
            </span>
            {selected ? <em>独立成稿</em> : null}
          </button>
          <button className="btn small ghost" type="button" aria-label={`仅用${option.label}风格`} onClick={() => { onChange([option.reference]); setOpen(false); }}>仅用</button>
          </div>
        );
      })}
    </section>
  ) : null;

  return (
    <div className="writer-reference-picker">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="writer-reference-picker-trigger"
        disabled={disabled}
        onClick={() => { setQuery(""); setOpen(true); }}
        type="button"
      >
        <span className="writer-account-avatar" aria-hidden="true">{selectedOptions[0]?.label.slice(0, 1) || "选"}</span>
        <span className="writer-account-trigger-copy"><strong>{summary}</strong><small>{selectedOptions.length > 1 ? "每个风格独立成稿" : selectedOptions[0]?.meta || "账号或项目风格"}</small></span>
        {selectedOptions.length > 1 ? <small>{selectedOptions.length}</small> : null}
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      {open ? (
        <WriterDialogModal labelledBy="writer-picker-title" onClose={() => setOpen(false)} panelClassName="writer-picker-dialog">
          <div className="modal-header"><div><h2 id="writer-picker-title">选择写作风格</h2><p className="pane-subtitle">可多选，每个账号或项目分别生成一篇稿件。</p></div><button className="btn compact" onClick={() => setOpen(false)} type="button">完成 · {selectedOptions.length}</button></div>
          <div className="writer-picker-body">
            <label className="writer-picker-search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜索账号或项目</span><input type="search" aria-label="搜索账号或项目" placeholder="搜索账号、项目或平台" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="writer-picker-selected">已选：{selectedOptions.map((option) => <span key={option.key}>{option.label}</span>)}</div>
            {renderGroup("项目风格", options.filter((option) => option.reference.targetType === "project" && `${option.label} ${option.meta}`.toLowerCase().includes(query.trim().toLowerCase())))}
            {renderGroup("账号风格", options.filter((option) => option.reference.targetType === "account" && `${option.label} ${option.meta}`.toLowerCase().includes(query.trim().toLowerCase())))}
            {!options.some((option) => `${option.label} ${option.meta}`.toLowerCase().includes(query.trim().toLowerCase())) ? <p className="subtle" role="status">没有匹配的账号或项目，试试其他名称。</p> : null}
            <p className="subtle">点“仅用”直接切换；勾选多个风格分别成稿，最多 8 个。</p>
          </div>
        </WriterDialogModal>
      ) : null}
    </div>
  );
}
