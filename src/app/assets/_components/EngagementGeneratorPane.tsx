"use client";

import { Send } from "lucide-react";
import type { BusyState } from "./asset-view-utils";
import { SourceInput } from "./SourceInput";

const COMMENT_COUNT_PRESETS = [100, 150, 200];

type EngagementGeneratorPaneProps = {
  busy: BusyState;
  canGenerate: boolean;
  commentCount: number;
  danmakuCount: number;
  includeComments: boolean;
  includeDanmaku: boolean;
  sourceInput: string;
  onCommentCountChange: (count: number) => void;
  onDanmakuCountChange: (count: number) => void;
  onGenerate: () => void;
  onIncludeCommentsChange: (enabled: boolean) => void;
  onIncludeDanmakuChange: (enabled: boolean) => void;
  onSourceInputChange: (value: string) => void;
};

export function EngagementGeneratorPane({
  busy,
  canGenerate,
  commentCount,
  danmakuCount,
  includeComments,
  includeDanmaku,
  sourceInput,
  onCommentCountChange,
  onDanmakuCountChange,
  onGenerate,
  onIncludeCommentsChange,
  onIncludeDanmakuChange,
  onSourceInputChange
}: EngagementGeneratorPaneProps) {
  return (
    <section className="engagement-generator-pane">
      <div className="pane-body detail-stack">
        <SourceInput value={sourceInput} onChange={onSourceInputChange} />

        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h3>生成选项</h3>
              <p className="subtle">评论默认开启，弹幕按需勾选。</p>
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
                <small>按正文节奏生成时间点</small>
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
          <div className="engagement-count-presets" aria-label="评论快捷条数">
            {COMMENT_COUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                className={`btn ghost engagement-count-preset ${commentCount === preset ? "active" : ""}`}
                disabled={!includeComments}
                type="button"
                onClick={() => onCommentCountChange(preset)}
              >
                {preset} 条评论
              </button>
            ))}
          </div>
        </section>

        {busy === "generate" ? (
          <div className="project-progress" role="status" aria-live="polite">
            <div className="project-progress-copy">
              <span>正在读取素材并生成互动内容</span>
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
