"use client";

import { useState } from "react";
import { MessageSquareText, Send, Zap } from "lucide-react";
import type { BusyState } from "./asset-view-utils";
import { SourceInput } from "./SourceInput";
import type { EngagementGenerationMode, Platform } from "@/lib/types";

const COMMENT_COUNT_PRESETS = [30, 50, 100];

type EngagementGeneratorPaneProps = {
  busy: BusyState;
  canGenerate: boolean;
  commentCount: number;
  danmakuCount: number;
  includeComments: boolean;
  includeDanmaku: boolean;
  generationMode: EngagementGenerationMode;
  targetPlatform: Platform;
  supportsDanmaku: boolean;
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
  onTargetPlatformChange: (platform: Platform) => void;
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
  targetPlatform,
  supportsDanmaku,
  generationProgress,
  sourceInput,
  onCommentCountChange,
  onDanmakuCountChange,
  onGenerate,
  onGenerationModeChange,
  onTargetPlatformChange,
  onIncludeCommentsChange,
  onIncludeDanmakuChange,
  onSourceInputChange
}: EngagementGeneratorPaneProps) {
  return (
    <section className="engagement-generator-pane">
      <div className="pane-body engagement-generator-body">
        <SourceInput value={sourceInput} onChange={onSourceInputChange} />

        <section className="engagement-form-section engagement-options-panel">
          <div className="engagement-form-heading">
            <h3>生成设置</h3>
          </div>
          <div className="engagement-mode-row">
            <span className="field-label">生成模式</span>
            <div aria-label="选择评论生成模式" className="segmented engagement-mode-segmented" role="group">
              <button
                aria-pressed={generationMode === "quick"}
                className={generationMode === "quick" ? "active" : ""}
                disabled={busy === "generate"}
                onClick={() => onGenerationModeChange("quick")}
                title="读取本地真实平台语料画像，不联网抓评论"
                type="button"
              >
                <Zap aria-hidden="true" size={14} />
                平台自然
              </button>
              <button
                aria-pressed={generationMode === "reference"}
                className={generationMode === "reference" ? "active" : ""}
                disabled={busy === "generate"}
                onClick={() => onGenerationModeChange("reference")}
                title="额外读取当前视频原评，不搜索其他视频"
                type="button"
              >
                <MessageSquareText aria-hidden="true" size={14} />
                原评增强
              </button>
            </div>
          </div>
          <div className="engagement-mode-row">
            <span className="field-label">目标平台</span>
            <div aria-label="选择粘贴文案的目标平台" className="segmented engagement-mode-segmented engagement-platform-segmented" role="group">
              <button
                aria-pressed={targetPlatform === "douyin"}
                className={targetPlatform === "douyin" ? "active" : ""}
                disabled={busy === "generate"}
                onClick={() => onTargetPlatformChange("douyin")}
                title="视频链接会自动识别；此选项用于粘贴文案"
                type="button"
              >
                抖音
              </button>
              <button
                aria-pressed={targetPlatform === "bilibili"}
                className={targetPlatform === "bilibili" ? "active" : ""}
                disabled={busy === "generate"}
                onClick={() => onTargetPlatformChange("bilibili")}
                title="视频链接会自动识别；此选项用于粘贴文案"
                type="button"
              >
                B站
              </button>
            </div>
          </div>
          <fieldset className="engagement-output-fieldset">
            <legend className="field-label">生成内容</legend>
            <div className="engagement-option-list">
              <label className={`engagement-option ${includeComments ? "active" : ""}`}>
                <input checked={includeComments} name="includeComments" type="checkbox" onChange={(event) => onIncludeCommentsChange(event.target.checked)} />
                <span>
                  <strong>评论</strong>
                  <small>默认生成评论</small>
                </span>
                <BoundedNumberInput
                  ariaLabel="评论条数"
                  disabled={!includeComments}
                  max={200}
                  min={1}
                  name="commentCount"
                  value={commentCount}
                  onChange={onCommentCountChange}
                />
              </label>
              <label className={`engagement-option ${includeDanmaku ? "active" : ""} ${supportsDanmaku ? "" : "is-disabled"}`}>
                <input checked={includeDanmaku} disabled={!supportsDanmaku} name="includeDanmaku" type="checkbox" onChange={(event) => onIncludeDanmakuChange(event.target.checked)} />
                <span>
                  <strong>弹幕</strong>
                  <small>{supportsDanmaku ? "B站 · 按正文节点生成" : "仅支持 B站"}</small>
                </span>
                <BoundedNumberInput
                  ariaLabel="弹幕条数"
                  disabled={!includeDanmaku || !supportsDanmaku}
                  max={300}
                  min={1}
                  name="danmakuCount"
                  value={danmakuCount}
                  onChange={onDanmakuCountChange}
                />
              </label>
            </div>
          </fieldset>
          <div className="engagement-settings-footer">
            <div className="engagement-mode-row engagement-count-row">
              <span className="field-label">常用数量</span>
              <div className="segmented engagement-count-segmented" aria-label="评论快捷条数" role="group">
                {COMMENT_COUNT_PRESETS.map((preset) => (
                  <button
                    aria-pressed={commentCount === preset}
                    key={preset}
                    className={commentCount === preset ? "active" : ""}
                    disabled={!includeComments}
                    type="button"
                    onClick={() => onCommentCountChange(preset)}
                  >
                    {preset} 条
                  </button>
                ))}
              </div>
            </div>
            <button className="btn primary engagement-submit" disabled={!canGenerate} onClick={onGenerate} type="button">
              <Send aria-hidden="true" size={16} />
              {busy === "generate" ? "正在生成" : "生成评论"}
            </button>
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

type BoundedNumberInputProps = {
  ariaLabel: string;
  disabled: boolean;
  max: number;
  min: number;
  name: string;
  value: number;
  onChange: (value: number) => void;
};

function BoundedNumberInput({
  ariaLabel,
  disabled,
  max,
  min,
  name,
  value,
  onChange
}: BoundedNumberInputProps) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const displayedValue = draftValue ?? String(value);

  function commitValue(rawValue: string) {
    const nextValue = normalizeBoundedNumber(rawValue, min, max, value);
    setDraftValue(null);
    if (nextValue !== value) onChange(nextValue);
  }

  return (
    <input
      aria-label={ariaLabel}
      autoComplete="off"
      disabled={disabled}
      inputMode="numeric"
      max={max}
      min={min}
      name={name}
      step={1}
      title={`请输入 ${min}–${max} 之间的整数`}
      type="number"
      value={displayedValue}
      onBlur={(event) => commitValue(event.currentTarget.value)}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraftValue(nextDraft);
        const nextValue = readValidBoundedNumber(nextDraft, min, max);
        if (nextValue !== null && nextValue !== value) onChange(nextValue);
      }}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
    />
  );
}

function readValidBoundedNumber(rawValue: string, min: number, max: number) {
  if (!rawValue.trim()) return null;
  const nextValue = Number(rawValue);
  if (!Number.isInteger(nextValue) || nextValue < min || nextValue > max) return null;
  return nextValue;
}

function normalizeBoundedNumber(rawValue: string, min: number, max: number, fallback: number) {
  if (!rawValue.trim()) return fallback;
  const nextValue = Number(rawValue);
  if (!Number.isFinite(nextValue)) return fallback;
  return Math.min(Math.max(Math.trunc(nextValue), min), max);
}
