"use client";

import { FileText, Link as LinkIcon, Send, TextCursorInput } from "lucide-react";
import type { BusyState } from "./asset-view-utils";
import { SourceInput } from "./SourceInput";
import type { Draft, EngagementSourceType } from "@/lib/types";

type EngagementGeneratorPaneProps = {
  busy: BusyState;
  canGenerate: boolean;
  commentCount: number;
  danmakuCount: number;
  drafts: Draft[];
  includeComments: boolean;
  includeDanmaku: boolean;
  loading: boolean;
  selectedDraft: Draft | null;
  selectedId: string;
  sourceType: EngagementSourceType;
  textInput: string;
  textTitle: string;
  urlInput: string;
  onCommentCountChange: (count: number) => void;
  onDanmakuCountChange: (count: number) => void;
  onGenerate: () => void;
  onIncludeCommentsChange: (enabled: boolean) => void;
  onIncludeDanmakuChange: (enabled: boolean) => void;
  onOpenPreview: (draft: Draft) => void;
  onSelectDraft: (id: string) => void;
  onSourceTypeChange: (sourceType: EngagementSourceType) => void;
  onTextInputChange: (value: string) => void;
  onTextTitleChange: (value: string) => void;
  onUrlInputChange: (value: string) => void;
};

export function EngagementGeneratorPane({
  busy,
  canGenerate,
  commentCount,
  danmakuCount,
  drafts,
  includeComments,
  includeDanmaku,
  loading,
  selectedDraft,
  selectedId,
  sourceType,
  textInput,
  textTitle,
  urlInput,
  onCommentCountChange,
  onDanmakuCountChange,
  onGenerate,
  onIncludeCommentsChange,
  onIncludeDanmakuChange,
  onOpenPreview,
  onSelectDraft,
  onSourceTypeChange,
  onTextInputChange,
  onTextTitleChange,
  onUrlInputChange
}: EngagementGeneratorPaneProps) {
  return (
    <section className="engagement-generator-pane">
      <div className="pane-body detail-stack">
        <div className="segmented source-tabs" role="tablist" aria-label="选择来源">
          {sourceTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                aria-selected={sourceType === tab.value}
                className={sourceType === tab.value ? "active" : ""}
                key={tab.value}
                onClick={() => onSourceTypeChange(tab.value)}
                role="tab"
                type="button"
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <SourceInput
          drafts={drafts}
          loading={loading}
          selectedDraft={selectedDraft}
          selectedId={selectedId}
          sourceType={sourceType}
          textInput={textInput}
          textTitle={textTitle}
          urlInput={urlInput}
          onSelectDraft={onSelectDraft}
          onOpenPreview={onOpenPreview}
          onTextInput={onTextInputChange}
          onTextTitle={onTextTitleChange}
          onUrlInput={onUrlInputChange}
        />

        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h3>生成选项</h3>
              <p className="subtle">关闭评论后可以只生成弹幕。</p>
            </div>
            <button className="btn primary engagement-submit" disabled={!canGenerate} onClick={onGenerate} type="button">
              <Send size={16} />
              {busy === "generate" ? "正在生成" : "生成"}
            </button>
          </div>
          <div className="engagement-option-grid">
            <label className={`engagement-option ${includeComments ? "active" : ""}`}>
              <input checked={includeComments} type="checkbox" onChange={(event) => onIncludeCommentsChange(event.target.checked)} />
              <span>
                <strong>评论</strong>
                <small>默认生成评论池</small>
              </span>
              <input
                aria-label="评论条数"
                disabled={!includeComments}
                max={200}
                min={1}
                type="number"
                value={commentCount}
                onChange={(event) => onCommentCountChange(Number(event.target.value))}
              />
            </label>
            <label className={`engagement-option ${includeDanmaku ? "active" : ""}`}>
              <input checked={includeDanmaku} type="checkbox" onChange={(event) => onIncludeDanmakuChange(event.target.checked)} />
              <span>
                <strong>弹幕</strong>
                <small>按口播节奏生成时间点</small>
              </span>
              <input
                aria-label="弹幕条数"
                disabled={!includeDanmaku}
                max={300}
                min={1}
                type="number"
                value={danmakuCount}
                onChange={(event) => onDanmakuCountChange(Number(event.target.value))}
              />
            </label>
          </div>
        </section>

        {busy === "generate" ? (
          <div className="project-progress" role="status" aria-live="polite">
            <div className="project-progress-copy">
              <span>{sourceType === "url" ? "正在读取链接并生成互动素材" : "正在生成互动素材"}</span>
              <strong>处理中</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill indeterminate" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const sourceTabs: Array<{ value: EngagementSourceType; label: string; icon: typeof FileText }> = [
  { value: "draft", label: "选择草稿", icon: FileText },
  { value: "text", label: "粘贴文案", icon: TextCursorInput },
  { value: "url", label: "视频链接", icon: LinkIcon }
];
