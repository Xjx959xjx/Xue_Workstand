"use client";

import { memo } from "react";
import { Download, ExternalLink, FileText, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { formatDate, formatNumber } from "@/components/Formatters";
import { StatusPill } from "@/components/StatusPill";
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
  styleProgress: number;
  stylePreview: string;
  transcriptLoading: boolean;
  transcriptPreview: string;
  transcribeProgress: number;
  transcribeStage: string;
  onBatchTranscribe: () => void;
  onExportTranscripts: () => void;
  onGenerateBatchStyle: () => void;
  onGenerateStyle: () => void;
  onOpenStyleModal: () => void;
  onOpenTranscriptModal: () => void;
  onRecollectAccount: () => void;
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
  styleProgress,
  stylePreview,
  transcriptLoading,
  transcriptPreview,
  transcribeProgress,
  transcribeStage,
  onBatchTranscribe,
  onExportTranscripts,
  onGenerateBatchStyle,
  onGenerateStyle,
  onOpenStyleModal,
  onOpenTranscriptModal,
  onRecollectAccount,
  onTranscribe
}: LibraryDetailPaneProps) {
  const missingTranscriptCount = selectedAccount ? Math.max(0, selectedAccount.videoCount - selectedAccount.transcriptCount) : 0;
  const transcriptPreviewText = transcriptPreview
    || (loading
      ? "正在读取本地风格库。"
      : selectedVideoHasTranscript
        ? "已有转写稿，可打开查看；重新转写前会保留历史版本。"
        : selectedVideo
          ? "当前视频还没有转写稿。"
          : "未选择视频。");
  const stylePreviewText = busy === "batch-style"
    ? transcribeStage || "正在补齐转写并总结风格"
    : loading
      ? "正在读取本地风格库。"
      : stylePreview || (styleLoaded ? "暂无风格卡内容。" : "风格卡待读取。");

  return (
    <aside className="pane library-detail-pane">
      <div className="pane-header library-detail-header">
        <div>
          <h2>详情</h2>
          <p className="pane-subtitle">
            {loading ? "正在读取" : selectedAccount ? `${selectedAccount.name}${selectedVideo ? ` / ${selectedVideo.title}` : ""}` : "未选择账号"}
          </p>
          {selectedAccount?.lastCollectedAt ? <span className="detail-freshness">最近采集 {formatDate(selectedAccount.lastCollectedAt)}</span> : null}
        </div>
        <button className="btn compact" disabled={!selectedAccount || Boolean(busy)} onClick={onRecollectAccount} type="button">
          <RefreshCw aria-hidden="true" size={14} />
          {busy === "recollect" ? "更新中" : "更新账号"}
        </button>
      </div>
      <div className="pane-body detail-stack">
        <div className="detail-section selected-video-section">
          <div className="selected-video-context">
            {selectedVideo?.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" height={54} referrerPolicy="no-referrer" src={selectedVideo.coverUrl} width={96} />
            ) : <span className="selected-video-cover-placeholder"><FileText aria-hidden="true" size={18} /></span>}
            <div>
              <h3 title={selectedVideo?.title}>{selectedVideo?.title || "当前视频"}</h3>
              {selectedVideo ? (
                <p>{formatDate(selectedVideo.publishedAt)} · {selectedVideo.platform === "douyin" ? "热度" : "播放"} {formatNumber(selectedVideo.platform === "douyin" ? selectedVideo.hotScore : selectedVideo.stats.views)}</p>
              ) : <p>从中间列表选择一条视频</p>}
              {selectedVideo ? <StatusPill status={selectedVideo.transcriptStatus} /> : null}
            </div>
          </div>
          <p className="detail-preview-text detail-transcript-preview">
            {busy === "transcribe" ? transcribeStage || "正在转写视频" : transcriptPreviewText}
          </p>
          <div className="detail-action-grid">
            <button className="btn detail-action-primary" disabled={!selectedVideo || busy === "transcribe"} onClick={onTranscribe} type="button">
              <RefreshCw aria-hidden="true" size={16} />
              {busy === "transcribe" ? "转写中…" : selectedVideoHasTranscript ? "重新转写" : "单视频转写"}
            </button>
            <button className="btn detail-action-secondary" disabled={!selectedVideo || transcriptLoading || (!selectedVideoHasTranscript && !activeTranscript)} onClick={onOpenTranscriptModal} type="button">
              <FileText aria-hidden="true" size={16} />
              {transcriptLoading ? "读取中…" : "查看原稿"}
            </button>
            {selectedVideoOpenUrl ? (
              <a className="btn detail-action-secondary detail-action-link" href={selectedVideoOpenUrl} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={16} />原链接
              </a>
            ) : <button className="btn detail-action-secondary detail-action-link" disabled type="button"><ExternalLink aria-hidden="true" size={16} />原链接</button>}
          </div>
        </div>

        <div className="detail-section automation-section">
          <div className="detail-module-heading">
            <h3>账号风格</h3>
            <p className="pane-subtitle">{missingTranscriptCount ? `${missingTranscriptCount} 条待转写` : "转写已齐"}</p>
          </div>
          <p className="detail-preview-text detail-style-preview">{stylePreviewText}</p>
          <div className="detail-action-grid account-style-actions">
            <button className="btn primary progress-button detail-action-primary" disabled={!selectedAccount || busy === "style"} onClick={onGenerateStyle} type="button">
              <span className="progress-button-fill" style={{ transform: `scaleX(${busy === "style" ? styleProgress / 100 : 0})` }} />
              <span className="progress-button-content"><Sparkles aria-hidden="true" size={16} />按现有稿总结</span>
            </button>
            <button className="btn detail-action-secondary" disabled={!selectedAccount || !missingTranscriptCount || busy === "batch"} onClick={onBatchTranscribe} type="button">
              <WandSparkles aria-hidden="true" size={16} />
              {busy === "batch" ? `转写中 ${transcribeProgress}%` : `补齐 ${missingTranscriptCount} 条`}
            </button>
            <button
              aria-busy={busy === "batch-style"}
              className="btn detail-action-secondary progress-button"
              disabled={!selectedAccount || busy === "batch-style"}
              onClick={onGenerateBatchStyle}
              type="button"
            >
              <span className="progress-button-fill" style={{ transform: `scaleX(${busy === "batch-style" ? transcribeProgress / 100 : 0})` }} />
              <span className="progress-button-content"><Sparkles aria-hidden="true" size={16} />{busy === "batch-style" ? `补齐并总结 ${transcribeProgress}%` : "补齐并总结"}</span>
            </button>
            <button className="btn detail-action-secondary" disabled={!selectedAccount || styleLoading} onClick={onOpenStyleModal} type="button">
              <FileText aria-hidden="true" size={16} />{styleLoading ? "读取中…" : "查看风格卡"}
            </button>
            <button className="btn detail-action-secondary" disabled={!selectedAccount || !selectedAccount.transcriptCount || busy === "export-transcripts"} onClick={onExportTranscripts} type="button">
              <Download aria-hidden="true" size={16} />{busy === "export-transcripts" ? "导出中…" : "导出全部转写"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
});
