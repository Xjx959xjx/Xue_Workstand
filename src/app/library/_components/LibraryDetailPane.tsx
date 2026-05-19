"use client";

import { memo } from "react";
import { Eye, RefreshCw, Sparkles } from "lucide-react";
import { formatNumber } from "@/components/Formatters";
import type { AccountDetail, VideoListItem } from "@/lib/types";
import { normalizeBatchLimit, type BatchLimit } from "./library-view-utils";

type LibraryDetailPaneProps = {
  activeTranscript: string;
  batchLimit: BatchLimit;
  busy: string;
  selectedAccount: AccountDetail | null;
  selectedVideo: VideoListItem | null;
  selectedVideoHasTranscript: boolean;
  selectedVideoOpenUrl: string;
  selectedVideoViewCount: number | null;
  styleLoaded: boolean;
  styleLoading: boolean;
  stylePreview: string;
  transcriptLoading: boolean;
  transcriptPreview: string;
  transcribeProgress: number;
  transcribeStage: string;
  onBatchLimitChange: (limit: BatchLimit) => void;
  onGenerateBatchStyle: () => void;
  onOpenStyleModal: () => void;
  onOpenTranscriptModal: () => void;
  onTranscribe: () => void;
};

export const LibraryDetailPane = memo(function LibraryDetailPane({
  activeTranscript,
  batchLimit,
  busy,
  selectedAccount,
  selectedVideo,
  selectedVideoHasTranscript,
  selectedVideoOpenUrl,
  selectedVideoViewCount,
  styleLoaded,
  styleLoading,
  stylePreview,
  transcriptLoading,
  transcriptPreview,
  transcribeProgress,
  transcribeStage,
  onBatchLimitChange,
  onGenerateBatchStyle,
  onOpenStyleModal,
  onOpenTranscriptModal,
  onTranscribe
}: LibraryDetailPaneProps) {
  return (
    <aside className="pane library-detail-pane">
      <div className="pane-header">
        <div>
          <h2>详情</h2>
          <p className="pane-subtitle">{selectedAccount ? selectedAccount.name : "未选择账号"}</p>
        </div>
      </div>
      <div className="pane-body detail-stack">
        {selectedVideo ? (
          <div className="detail-section selected-video-section">
            <h3>{selectedVideo.title}</h3>
            <div className="stat-row">
              {selectedVideoViewCount !== null ? <span className="stat-pill">播放 {formatNumber(selectedVideoViewCount)}</span> : null}
              <span className="stat-pill">点赞 {formatNumber(selectedVideo.stats.likes)}</span>
              <span className="stat-pill">收藏 {formatNumber(selectedVideo.stats.favorites)}</span>
            </div>
            <div className="button-row detail-action-row">
              <button className="btn" disabled={busy === "transcribe"} onClick={onTranscribe} type="button">
                <RefreshCw aria-hidden="true" size={16} />
                {busy === "transcribe" ? "转写中…" : "转写"}
              </button>
              {selectedVideoOpenUrl ? (
                <a className="btn" href={selectedVideoOpenUrl} rel="noreferrer" target="_blank">
                  原链接
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="subtle">选择视频后查看转写和风格。</p>
        )}

        <div className="detail-section automation-section">
          <div className="automation-heading">
            <h3>批量提炼</h3>
            <p className="pane-subtitle">按最近视频补转写，并同步刷新这个账号的风格卡。</p>
          </div>
          <div className={`automation-row compact ${busy === "batch-style" ? "running" : ""}`}>
            <div className="field">
              <label htmlFor="batch-limit">范围</label>
              <select
                id="batch-limit"
                name="batchLimit"
                value={batchLimit}
                onChange={(event) => onBatchLimitChange(normalizeBatchLimit(event.target.value))}
              >
                <option value={3}>前 3 条</option>
                <option value={5}>前 5 条</option>
                <option value={10}>前 10 条</option>
                <option value="all">全部转写</option>
              </select>
            </div>
            <button
              className="btn primary progress-button"
              disabled={!selectedAccount || busy === "batch-style"}
              onClick={onGenerateBatchStyle}
              type="button"
            >
              <span className="progress-button-fill" style={{ width: `${busy === "batch-style" ? transcribeProgress : 0}%` }} />
              <span className="progress-button-content">
                <Sparkles aria-hidden="true" size={16} />
                {busy === "batch-style" ? `更新中 ${transcribeProgress}%` : "转写并更新"}
              </span>
            </button>
          </div>
          {busy === "batch-style" || busy === "transcribe" ? <p className="subtle">{transcribeStage}</p> : null}
        </div>

        <div className="compact-card preview-card">
          <div>
            <h3>转写稿</h3>
            <p>
              {transcriptPreview ||
                (selectedVideoHasTranscript
                  ? "已有转写稿。"
                  : "当前视频还没有转写稿。")}
            </p>
          </div>
          <div className="button-row">
            <button
              className="btn"
              disabled={!selectedVideo || transcriptLoading || (!selectedVideoHasTranscript && !activeTranscript)}
              onClick={onOpenTranscriptModal}
              type="button"
            >
              <Eye aria-hidden="true" size={16} />
              {transcriptLoading ? "读取中…" : "全文"}
            </button>
          </div>
        </div>

        <div className="compact-card preview-card">
          <div>
            <h3>风格卡</h3>
            <p>{stylePreview || (styleLoaded ? "暂无风格卡" : "风格卡待读取")}</p>
          </div>
          <div className="button-row">
            <button className="btn" disabled={!selectedAccount || styleLoading} onClick={onOpenStyleModal} type="button">
              <Eye aria-hidden="true" size={16} />
              {styleLoading ? "读取中…" : "编辑"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
});
