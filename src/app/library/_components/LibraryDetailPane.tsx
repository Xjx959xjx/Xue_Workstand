"use client";

import { memo } from "react";
import { Download, ExternalLink, FileText, RefreshCw, Sparkles } from "lucide-react";
import type { AccountDetail, VideoListItem } from "@/lib/types";

type LibraryDetailPaneProps = {
  activeTranscript: string;
  busy: string;
  loading: boolean;
  selectedAccount: AccountDetail | null;
  selectedVideo: VideoListItem | null;
  selectedVideoHasTranscript: boolean;
  selectedVideoOpenUrl: string;
  styleLoaded: boolean;
  styleLoading: boolean;
  stylePreview: string;
  transcriptLoading: boolean;
  transcriptPreview: string;
  transcribeProgress: number;
  transcribeStage: string;
  onExportTranscripts: () => void;
  onGenerateBatchStyle: () => void;
  onOpenStyleModal: () => void;
  onOpenTranscriptModal: () => void;
  onTranscribe: () => void;
};

export const LibraryDetailPane = memo(function LibraryDetailPane({
  activeTranscript,
  busy,
  loading,
  selectedAccount,
  selectedVideo,
  selectedVideoHasTranscript,
  selectedVideoOpenUrl,
  styleLoaded,
  styleLoading,
  stylePreview,
  transcriptLoading,
  transcriptPreview,
  transcribeProgress,
  transcribeStage,
  onExportTranscripts,
  onGenerateBatchStyle,
  onOpenStyleModal,
  onOpenTranscriptModal,
  onTranscribe
}: LibraryDetailPaneProps) {
  const transcriptPreviewText = transcriptPreview
    ? transcriptPreview
    : loading
      ? "正在读取本地风格库。"
      : selectedVideoHasTranscript
      ? "已有转写稿，可打开查看或重新转写覆盖。"
      : selectedVideo
        ? "当前视频还没有转写稿。"
        : "未选择视频。";
  const stylePreviewText =
    busy === "batch-style"
      ? transcribeStage || "正在补齐转写并总结风格"
      : loading
        ? "正在读取本地风格库。"
        : stylePreview || (styleLoaded ? "暂无风格卡内容。" : "风格卡待读取。");

  return (
    <aside className="pane library-detail-pane">
      <div className="pane-header">
        <div>
          <h2>详情</h2>
          <p className="pane-subtitle">{loading ? "正在读取" : selectedAccount ? selectedAccount.name : "未选择账号"}</p>
        </div>
      </div>
      <div className="pane-body detail-stack">
        <div className="detail-section selected-video-section">
          <div className="detail-module-heading">
            <h3>当前视频</h3>
            {!selectedVideo ? <p className="pane-subtitle">从中间列表选择一条视频</p> : null}
          </div>
          <p className="detail-preview-text detail-transcript-preview">
            {busy === "transcribe" ? transcribeStage || "正在转写视频" : transcriptPreviewText}
          </p>
          <div className="detail-action-grid">
            <button className="btn detail-action-primary" disabled={!selectedVideo || busy === "transcribe"} onClick={onTranscribe} type="button">
              <RefreshCw aria-hidden="true" size={16} />
              {busy === "transcribe" ? "转写中…" : selectedVideoHasTranscript ? "重新转写" : "单视频转写"}
            </button>
            <button
              className="btn detail-action-secondary"
              disabled={!selectedVideo || transcriptLoading || (!selectedVideoHasTranscript && !activeTranscript)}
              onClick={onOpenTranscriptModal}
              type="button"
            >
              <FileText aria-hidden="true" size={16} />
              {transcriptLoading ? "读取中…" : "查看原稿"}
            </button>
            {selectedVideoOpenUrl ? (
              <a className="btn detail-action-secondary detail-action-link" href={selectedVideoOpenUrl} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={16} />
                原链接
              </a>
            ) : (
              <button className="btn detail-action-secondary detail-action-link" disabled type="button">
                <ExternalLink aria-hidden="true" size={16} />
                原链接
              </button>
            )}
          </div>
        </div>

        <div className="detail-section automation-section">
          <div className="detail-module-heading">
            <h3>账号风格</h3>
          </div>
          <p className="detail-preview-text detail-style-preview">{stylePreviewText}</p>
          <div className="detail-action-grid">
            <button
              className="btn primary progress-button detail-action-primary"
              disabled={!selectedAccount || busy === "batch-style"}
              onClick={onGenerateBatchStyle}
              type="button"
            >
              <span className="progress-button-fill" style={{ transform: `scaleX(${busy === "batch-style" ? transcribeProgress / 100 : 0})` }} />
              <span className="progress-button-content">
                <Sparkles aria-hidden="true" size={16} />
                {busy === "batch-style" ? `总结中 ${transcribeProgress}%` : "总结风格"}
              </span>
            </button>
            <button className="btn detail-action-secondary" disabled={!selectedAccount || styleLoading} onClick={onOpenStyleModal} type="button">
              <FileText aria-hidden="true" size={16} />
              {styleLoading ? "读取中…" : "查看风格卡"}
            </button>
            <button
              className="btn detail-action-secondary"
              disabled={!selectedAccount || !selectedAccount.transcriptCount || busy === "export-transcripts"}
              onClick={onExportTranscripts}
              type="button"
            >
              <Download aria-hidden="true" size={16} />
              {busy === "export-transcripts" ? "导出中…" : "导出转写稿"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
});
