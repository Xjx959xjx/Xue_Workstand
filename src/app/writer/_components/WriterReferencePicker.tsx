"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
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
  const rootRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggleReference = (option: ReferenceOption) => {
    const accountReferences = references.filter((reference) => reference.targetType === "account");
    const selected = selectedKeys.includes(option.key);
    if (selected && accountReferences.length === 1) return;
    if (!selected && accountReferences.length >= MAX_CONCURRENT_STYLES) return;
    onChange(selected
      ? accountReferences.filter((reference) => writeStyleReferenceKey(reference) !== option.key)
      : [...accountReferences, option.reference]);
  };

  const renderGroup = (label: string, group: ReferenceOption[]) => group.length ? (
    <section className="writer-reference-picker-group">
      <strong>{label}</strong>
      {group.map((option) => {
        const selected = selectedKeys.includes(option.key);
        return (
          <button
            aria-selected={selected}
            className="writer-reference-option"
            disabled={!selected && references.filter((reference) => reference.targetType === "account").length >= MAX_CONCURRENT_STYLES}
            key={option.key}
            onClick={() => toggleReference(option)}
            role="option"
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
        );
      })}
    </section>
  ) : null;

  return (
    <div className="writer-reference-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="writer-reference-picker-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{summary}</span>
        {selectedOptions.length > 1 ? <small>{selectedOptions.length}</small> : null}
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      {open ? (
        <div aria-label="选择参考风格" aria-multiselectable="true" className="writer-reference-menu" role="listbox">
          {renderGroup("账号风格", options.filter((option) => option.reference.targetType === "account"))}
          <p>最多选 8 个账号，每个风格单独生成一篇。</p>
        </div>
      ) : null}
    </div>
  );
}
