"use client";

import { memo } from "react";
import { ExternalLink, FileText, RefreshCw, Sparkles } from "lucide-react";
import type { AccountDetail, VideoListItem } from "@/lib/types";

type LibraryDetailPaneProps = {
  activeTranscript: string;
  busy: string;
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
  onGenerateBatchStyle: () => void;
  onOpenStyleModal: () => void;
  onOpenTranscriptModal: () => void;
  onTranscribe: () => void;
};

export const LibraryDetailPane = memo(function LibraryDetailPane({
  activeTranscript,
  busy,
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
        <div className="detail-section selected-video-section">
          <div className="detail-module-heading">
            <h3>当前视频</h3>
            <p className="pane-subtitle">
              {selectedVideo ? selectedVideo.title : "从中间列表选择一条视频"}
            </p>
          </div>
          <div className="detail-action-grid">
            <button className="btn" disabled={!selectedVideo || busy === "transcribe"} onClick={onTranscribe} type="button">
              <RefreshCw aria-hidden="true" size={16} />
              {busy === "transcribe" ? "转写中…" : selectedVideoHasTranscript ? "重新转写" : "单视频转写"}
            </button>
            <button
              className="btn"
              disabled={!selectedVideo || transcriptLoading || (!selectedVideoHasTranscript && !activeTranscript)}
              onClick={onOpenTranscriptModal}
              type="button"
            >
              <FileText aria-hidden="true" size={16} />
              {transcriptLoading ? "读取中…" : "查看原稿"}
            </button>
            {selectedVideoOpenUrl ? (
              <a className="btn" href={selectedVideoOpenUrl} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={16} />
                原链接
              </a>
            ) : (
              <button className="btn" disabled type="button">
                <ExternalLink aria-hidden="true" size={16} />
                原链接
              </button>
            )}
          </div>
          {busy === "transcribe" ? (
            <p className="subtle">{transcribeStage || "正在转写视频"}</p>
          ) : (
            <p className="detail-preview-text">
              {transcriptPreview ||
                (selectedVideoHasTranscript
                  ? "已有转写稿，可打开查看或重新转写覆盖。"
                  : selectedVideo
                    ? "当前视频还没有转写稿。"
                    : "未选择视频。")}
            </p>
          )}
        </div>

        <div className="detail-section automation-section">
          <div className="detail-module-heading">
            <h3>账号风格</h3>
            <p className="pane-subtitle">补齐全部视频转写，已有转写自动跳过，再刷新账号风格卡。</p>
          </div>
          <div className="detail-action-grid">
            <button
              className="btn primary progress-button"
              disabled={!selectedAccount || busy === "batch-style"}
              onClick={onGenerateBatchStyle}
              type="button"
            >
              <span className="progress-button-fill" style={{ width: `${busy === "batch-style" ? transcribeProgress : 0}%` }} />
              <span className="progress-button-content">
                <Sparkles aria-hidden="true" size={16} />
                {busy === "batch-style" ? `总结中 ${transcribeProgress}%` : "总结风格"}
              </span>
            </button>
            <button className="btn" disabled={!selectedAccount || styleLoading} onClick={onOpenStyleModal} type="button">
              <FileText aria-hidden="true" size={16} />
              {styleLoading ? "读取中…" : "查看风格卡"}
            </button>
          </div>
          {busy === "batch-style" ? (
            <p className="subtle">{transcribeStage || "正在补齐转写并总结风格"}</p>
          ) : (
            <p className="detail-preview-text">{stylePreview || (styleLoaded ? "暂无风格卡内容。" : "风格卡待读取。")}</p>
          )}
        </div>
      </div>
    </aside>
  );
});
