"use client";

import { MessageSquareText, Send, Zap } from "lucide-react";
import type { BusyState } from "./asset-view-utils";
import { SourceInput } from "./SourceInput";
import type { EngagementGenerationMode } from "@/lib/types";

const COMMENT_COUNT_PRESETS = [30, 50, 100];

type EngagementGeneratorPaneProps = {
  busy: BusyState;
  canGenerate: boolean;
  commentCount: number;
  danmakuCount: number;
  includeComments: boolean;
  includeDanmaku: boolean;
  generationMode: EngagementGenerationMode;
  generationProgress: {
    stage: string;
    message: string;
    progress: number;
  } | null;
  sourceInput: string;
  onCommentCountChange: (count: number) => void;
  onDanmakuCountChange: (count: number) => void;
  onGenerate: () => void;
  onGenerationModeChange: (mode: EngagementGenerationMode) => void;
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
  generationMode,
  generationProgress,
  sourceInput,
  onCommentCountChange,
  onDanmakuCountChange,
  onGenerate,
  onGenerationModeChange,
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
              <Send aria-hidden="true" size={16} />
              {busy === "generate" ? "正在生成" : "生成"}
            </button>
          </div>
          <div className="engagement-mode-row">
            <span className="field-label">生成模式</span>
            <div aria-label="选择评论生成模式" className="segmented engagement-mode-segmented" role="group">
              <button
                className={generationMode === "quick" ? "active" : ""}
                disabled={busy === "generate"}
                onClick={() => onGenerationModeChange("quick")}
                title="直接根据当前素材生成"
                type="button"
              >
                <Zap aria-hidden="true" size={14} />
                快速自然
              </button>
              <button
                className={generationMode === "reference" ? "active" : ""}
                disabled={busy === "generate"}
                onClick={() => onGenerationModeChange("reference")}
                title="额外读取一组同类热评参考"
                type="button"
              >
                <MessageSquareText aria-hidden="true" size={14} />
                参考热评
              </button>
            </div>
          </div>
          <div className="engagement-option-grid">
            <label className={`engagement-option ${includeComments ? "active" : ""}`}>
              <input checked={includeComments} name="includeComments" type="checkbox" onChange={(event) => onIncludeCommentsChange(event.target.checked)} />
              <span>
                <strong>评论</strong>
                <small>默认生成评论</small>
              </span>
              <input
                aria-label="评论条数"
                autoComplete="off"
                disabled={!includeComments}
                max={200}
                min={1}
                name="commentCount"
                type="number"
                value={commentCount}
                onChange={(event) => updateBoundedNumber(event.target.value, 1, 200, onCommentCountChange)}
              />
            </label>
            <label className={`engagement-option ${includeDanmaku ? "active" : ""}`}>
              <input checked={includeDanmaku} name="includeDanmaku" type="checkbox" onChange={(event) => onIncludeDanmakuChange(event.target.checked)} />
              <span>
                <strong>弹幕</strong>
                <small>按正文节奏生成时间点</small>
              </span>
              <input
                aria-label="弹幕条数"
                autoComplete="off"
                disabled={!includeDanmaku}
                max={300}
                min={1}
                name="danmakuCount"
                type="number"
                value={danmakuCount}
                onChange={(event) => updateBoundedNumber(event.target.value, 1, 300, onDanmakuCountChange)}
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
          <div
            aria-live="polite"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={generationProgress?.progress || 0}
            className="project-progress"
            role="progressbar"
          >
            <div className="project-progress-copy">
              <span>{generationProgress?.message || "任务正在排队"}</span>
              <strong>{generationProgress ? `${generationProgress.progress}%` : "等待中"}</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${generationProgress?.progress || 3}%` }} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function updateBoundedNumber(value: string, min: number, max: number, onChange: (value: number) => void) {
  if (!value.trim()) return;
  const next = Number(value);
  if (!Number.isFinite(next)) return;
  onChange(Math.min(Math.max(Math.trunc(next), min), max));
}
