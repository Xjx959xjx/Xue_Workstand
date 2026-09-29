"use client";

import { memo } from "react";
import { Download, ExternalLink, FileText, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { formatDate } from "@/components/Formatters";
import type { AccountDetail, VideoListItem } from "@/lib/types";

type LibraryDetailPaneProps = {
  busy: string;
  hasAccounts: boolean;
  hasVisibleAccounts: boolean;
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
  onTranscribe: () => void;
};

export const LibraryDetailPane = memo(function LibraryDetailPane({
  busy,
  hasAccounts,
  hasVisibleAccounts,
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

  if (!loading && !selectedAccount) {
    return <aside className="pane library-detail-pane">
      <div className="pane-header library-detail-header"><div><h2>详情</h2><p className="pane-subtitle">等待选择</p></div></div>
      <div className="pane-body"><div className="library-detail-empty"><strong>{!hasAccounts ? "从采集开始" : hasVisibleAccounts ? "先选择一个账号" : "当前筛选没有账号"}</strong><p>{!hasAccounts ? "在上方输入账号名或主页链接，采集完成后可查看视频、转写和风格。" : hasVisibleAccounts ? "在左侧选择账号，再查看视频原稿和账号风格。" : "清除左侧筛选，或换个关键词查找账号。"}</p></div></div>
    </aside>;
  }

  return (
    <aside className="pane library-detail-pane">
      <div className="pane-header library-detail-header">
        <div>
          <h2>详情</h2>
          <p className="pane-subtitle">
            {loading ? "正在读取" : selectedAccount?.name || "未选择账号"}
          </p>
          {selectedAccount?.lastCollectedAt ? <span className="detail-freshness">最近采集 {formatDate(selectedAccount.lastCollectedAt)}</span> : null}
        </div>
      </div>
      <div className="pane-body detail-stack">
        <div className="detail-section selected-video-section">
          <div className="detail-module-heading">
            <h3>转写稿</h3>
            <p className="pane-subtitle detail-video-title" title={selectedVideo?.title}>{selectedVideo?.title || "选择视频后生成可编辑原稿"}</p>
          </div>
          <p className="detail-preview-text detail-transcript-preview">
            {busy === "transcribe" ? transcribeStage || "正在转写视频" : transcriptPreviewText}
          </p>
          <div className="detail-action-grid">
            <button
              className={`btn ${selectedVideoHasTranscript ? "" : "primary"} detail-action-primary`}
              disabled={!selectedVideo || transcriptLoading || busy === "transcribe"}
              onClick={selectedVideoHasTranscript ? onOpenTranscriptModal : onTranscribe}
              type="button"
            >
              {selectedVideoHasTranscript ? <FileText aria-hidden="true" size={16} /> : <WandSparkles aria-hidden="true" size={16} />}
              {transcriptLoading ? "读取中…" : busy === "transcribe" ? "转写中…" : selectedVideoHasTranscript ? "查看 / 编辑原稿" : "开始转写"}
            </button>
            {selectedVideoHasTranscript ? (
              <button className="btn detail-action-secondary" disabled={!selectedVideo || busy === "transcribe"} onClick={onTranscribe} type="button">
                <RefreshCw aria-hidden="true" size={16} />
                {busy === "transcribe" ? "转写中…" : "重新转写"}
              </button>
            ) : null}
            {selectedVideoOpenUrl ? (
              <a className="btn detail-action-secondary detail-action-link" href={selectedVideoOpenUrl} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={16} />查看原视频
              </a>
            ) : null}
          </div>
        </div>

        <div className="detail-section automation-section">
          <div className="detail-module-heading">
            <h3>账号风格</h3>
            <p className="pane-subtitle">{styleLoaded ? "风格卡已生成" : missingTranscriptCount ? `${missingTranscriptCount} 条待转写` : "可根据现有稿总结"}</p>
          </div>
          <p className="detail-preview-text detail-style-preview">{stylePreviewText}</p>
          <div className="detail-action-grid account-style-actions">
            <button
              className="btn detail-action-primary"
              disabled={!selectedAccount || styleLoading || busy === "style"}
              onClick={onOpenStyleModal}
              type="button"
            >
              <FileText aria-hidden="true" size={16} />
              {styleLoading ? "读取中…" : "查看 / 编辑风格卡"}
            </button>
            <button
              aria-busy={busy === "style"}
              className="btn detail-action-secondary progress-button"
              disabled={!selectedAccount || styleLoading || busy === "style"}
              onClick={onGenerateStyle}
              type="button"
            >
              <span className="progress-button-fill" style={{ transform: `scaleX(${busy === "style" ? styleProgress / 100 : 0})` }} />
              <span className="progress-button-content">
                <Sparkles aria-hidden="true" size={16} />
                {busy === "style" ? "总结中…" : styleLoaded ? "重新总结" : "按现有稿总结"}
              </span>
            </button>
            <button
              aria-busy={busy === "export-transcripts"}
              className="btn detail-action-secondary"
              disabled={!selectedAccount || !selectedAccount.transcriptCount || busy === "export-transcripts"}
              onClick={onExportTranscripts}
              type="button"
            >
              <Download aria-hidden="true" size={16} />{busy === "export-transcripts" ? "导出中…" : "导出全部转写"}
            </button>
            {missingTranscriptCount ? (
              <>
                <button className="btn detail-action-secondary" disabled={!selectedAccount || busy === "batch"} onClick={onBatchTranscribe} type="button">
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
              </>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
});
