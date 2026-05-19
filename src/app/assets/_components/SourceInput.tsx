"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { formatDate } from "@/components/Formatters";
import type { Draft, EngagementSourceType } from "@/lib/types";
import { getDraftReferenceLabel } from "./asset-view-utils";

type SourceInputProps = {
  drafts: Draft[];
  loading: boolean;
  selectedDraft: Draft | null;
  selectedId: string;
  sourceType: EngagementSourceType;
  textInput: string;
  textTitle: string;
  urlInput: string;
  onSelectDraft: (id: string) => void;
  onOpenPreview: (draft: Draft) => void;
  onTextInput: (value: string) => void;
  onTextTitle: (value: string) => void;
  onUrlInput: (value: string) => void;
};

export function SourceInput({
  drafts,
  loading,
  selectedDraft,
  selectedId,
  sourceType,
  textInput,
  textTitle,
  urlInput,
  onSelectDraft,
  onOpenPreview,
  onTextInput,
  onTextTitle,
  onUrlInput
}: SourceInputProps) {
  const [draftSearch, setDraftSearch] = useState("");
  const filteredDrafts = useMemo(() => {
    const keyword = draftSearch.trim().toLowerCase();
    if (!keyword) return drafts;
    return drafts.filter((draft) => {
      const haystack = `${draft.title} ${getDraftReferenceLabel(draft)} ${formatDate(draft.createdAt)}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [draftSearch, drafts]);

  if (sourceType === "text") {
    return (
      <section className="detail-section engagement-source-panel">
        <label className="field">
          <span>标题，可不填</span>
          <input placeholder="例如：这篇评论池" value={textTitle} onChange={(event) => onTextTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>文案</span>
          <textarea className="engagement-textarea" placeholder="把要生成评论的文案粘贴到这里。" value={textInput} onChange={(event) => onTextInput(event.target.value)} />
        </label>
      </section>
    );
  }

  if (sourceType === "url") {
    return (
      <section className="detail-section engagement-source-panel">
        <label className="field">
          <span>视频链接</span>
          <input placeholder="粘贴 B站或抖音视频链接" value={urlInput} onChange={(event) => onUrlInput(event.target.value)} />
        </label>
        <p className="subtle">暂只支持 B站 / 抖音视频链接；普通网页文章请改用粘贴文案。</p>
      </section>
    );
  }

  return (
    <section className="detail-section engagement-source-panel">
      <div className="section-title-row">
        <div>
          <h3>选择草稿</h3>
          <p className="subtle">{selectedDraft ? getDraftReferenceLabel(selectedDraft) : loading ? "正在读取草稿" : "暂无草稿"}</p>
        </div>
        <button className="btn" disabled={!selectedDraft} onClick={() => selectedDraft && onOpenPreview(selectedDraft)} type="button">
          <FileText size={16} />
          来源预览
        </button>
      </div>
      <label className="field engagement-draft-search">
        <span>搜索草稿</span>
        <input
          placeholder="按标题、账号或项目筛选"
          value={draftSearch}
          onChange={(event) => setDraftSearch(event.target.value)}
        />
      </label>
      <div className="status-summary engagement-draft-summary">
        <span>{filteredDrafts.length}/{drafts.length} 个草稿</span>
        <span>列表内滚动</span>
      </div>
      <div className="engagement-draft-list" role="listbox" aria-label="草稿列表">
        {filteredDrafts.length ? (
          filteredDrafts.map((draft) => {
            const active = (selectedDraft?.id || selectedId) === draft.id;
            return (
              <button
                aria-current={active ? "true" : undefined}
                aria-selected={active}
                className={`list-button ${active ? "active" : ""}`}
                key={draft.id}
                onClick={() => onSelectDraft(draft.id)}
                role="option"
                title="选择这篇草稿"
                type="button"
              >
                <span>
                  <span className="list-title">{draft.title}</span>
                  <span className="list-meta">
                    {getDraftReferenceLabel(draft)} · {formatDate(draft.createdAt)}
                  </span>
                </span>
                <span className="status-pill done">{draft.assets?.comments || draft.assets?.danmaku ? "有记录" : "草稿"}</span>
              </button>
            );
          })
        ) : drafts.length ? (
          <p className="subtle">没有匹配的草稿，换个关键词试试。</p>
        ) : (
          <p className="subtle">还没有草稿，也可以切换到粘贴文案或视频链接。</p>
        )}
      </div>
    </section>
  );
}
