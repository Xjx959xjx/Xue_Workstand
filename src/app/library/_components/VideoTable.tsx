"use client";

import { memo } from "react";
import { CheckCircle2, Trash2, X } from "lucide-react";
import { formatNumber } from "@/components/Formatters";
import { StatusPill } from "@/components/StatusPill";
import type { AccountDetail, AccountListItem, VideoListItem } from "@/lib/types";
import { getPrimaryMetric, getVideoMetaText, type VideoSortMode } from "./library-view-utils";

type SortOption = {
  value: VideoSortMode;
  label: string;
};

type VideoTableProps = {
  accountDetailLoading: boolean;
  availableSortOptions: SortOption[];
  busy: string;
  completedCount: number;
  effectiveSortMode: VideoSortMode;
  loading: boolean;
  maxPrimaryMetric: number;
  pendingCount: number;
  selectedAccount: AccountDetail | null;
  selectedAccountMeta: AccountListItem | null;
  selectedVideoId: string;
  selectedVideoIds: string[];
  videos: VideoListItem[];
  videoManageMode: boolean;
  onRequestDeleteVideos: () => void;
  onSelectVideo: (videoId: string) => void;
  onSortModeChange: (mode: VideoSortMode) => void;
  onToggleVideoManage: () => void;
};

export const VideoTable = memo(function VideoTable({
  accountDetailLoading,
  availableSortOptions,
  busy,
  completedCount,
  effectiveSortMode,
  loading,
  maxPrimaryMetric,
  pendingCount,
  selectedAccount,
  selectedAccountMeta,
  selectedVideoId,
  selectedVideoIds,
  videos,
  videoManageMode,
  onRequestDeleteVideos,
  onSelectVideo,
  onSortModeChange,
  onToggleVideoManage
}: VideoTableProps) {
  return (
    <section className={`pane ${videoManageMode ? "selection-mode" : ""}`}>
      <div className="pane-header video-pane-header">
        <div className="video-header-copy">
          <div className="video-title-row">
            <h2>视频</h2>
          </div>
          <p className="pane-subtitle">
            {loading || accountDetailLoading ? "正在读取" : `${videos.length} 条 · 转写 ${completedCount}/${videos.length || 0}${pendingCount ? ` · 待处理 ${pendingCount}` : ""}`}
          </p>
        </div>
        <div className="video-header-tools">
          <div className="inline-sort-control">
            <label htmlFor="library-video-sort">排序</label>
            <select
              aria-label="视频排序"
              id="library-video-sort"
              name="videoSort"
              value={effectiveSortMode}
              onChange={(event) => onSortModeChange(event.target.value as VideoSortMode)}
            >
              {availableSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            className={`btn icon-btn icon-only ${videoManageMode ? "primary" : ""}`}
            aria-label={videoManageMode ? "退出视频选择" : "批量选择视频"}
            disabled={!selectedAccount}
            onClick={onToggleVideoManage}
            title={videoManageMode ? "退出选择" : "批量选择"}
            type="button"
          >
            {videoManageMode ? <X aria-hidden="true" size={15} /> : <CheckCircle2 aria-hidden="true" size={15} />}
          </button>
        </div>
      </div>
      {videoManageMode ? (
        <div className="selection-toolbar" role="toolbar" aria-label="视频批量操作">
          <div className="selection-copy">
            <strong>已选 {selectedVideoIds.length} 条</strong>
            <span>删除视频和转写稿</span>
          </div>
          <button
            className="btn danger"
            disabled={!selectedVideoIds.length || busy === "video-delete"}
            onClick={onRequestDeleteVideos}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
            {busy === "video-delete" ? "删除中" : "删除"}
          </button>
        </div>
      ) : null}
      <div className="pane-body">
        {loading ? (
          <div className="library-loading-list video" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <span className="library-loading-row video" key={index} />
            ))}
          </div>
        ) : (
          <table className="video-table">
            <thead>
              <tr>
                {videoManageMode ? (
                  <th className="video-select-column">
                    <span className="sr-only">选择</span>
                  </th>
                ) : null}
                <th>标题</th>
                <th>发布日期</th>
                <th>播放</th>
                <th>点赞</th>
                <th>评论</th>
                <th>收藏</th>
                <th>转写</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((video) => {
                const checked = selectedVideoIds.includes(video.id);
                const primaryMetric = getPrimaryMetric(video);
                const primaryLabel = video.platform === "douyin" ? "热度" : "播放";
                const primaryValue = video.platform === "douyin" ? video.hotScore : video.stats.views;
                const metricWidth = maxPrimaryMetric > 0 ? Math.max(4, Math.round((primaryMetric.sortValue / maxPrimaryMetric) * 100)) : 4;
                return (
                  <tr
                    className={videoManageMode ? (checked ? "checked" : "") : selectedVideoId === video.id ? "active" : ""}
                    key={video.id}
                  >
                    {videoManageMode ? (
                      <td className="video-select-cell" aria-hidden="true">
                        <span className={`check-dot ${checked ? "checked" : ""}`} />
                      </td>
                    ) : null}
                    <td className="video-title-column">
                      <button
                        aria-current={!videoManageMode && selectedVideoId === video.id ? "true" : undefined}
                        aria-pressed={videoManageMode ? checked : undefined}
                        className={`video-row-button ${videoManageMode ? "manage" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectVideo(video.id);
                        }}
                        type="button"
                      >
                        <span className="video-title-cell">
                          <span className="video-title-copy">
                            <span className="video-title-line">
                              <strong>{video.title}</strong>
                            </span>
                            <span className="list-meta">{getVideoMetaText(video)}</span>
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="video-date-cell" data-label="发布日期">
                      {getVideoMetaText(video)}
                    </td>
                    <td className="video-number-cell" data-label={primaryLabel} aria-label={`${primaryLabel} ${formatNumber(primaryValue)}`}>
                      <strong>{formatNumber(primaryValue)}</strong>
                      <span className="metric-bar" aria-hidden="true">
                        <span style={{ transform: `scaleX(${metricWidth / 100})` }} />
                      </span>
                    </td>
                    <td className="video-number-cell" data-label="点赞">
                      {formatNumber(video.stats.likes)}
                    </td>
                    <td className="video-number-cell" data-label="评论">
                      {formatNumber(video.stats.comments)}
                    </td>
                    <td className="video-number-cell" data-label="收藏">
                      {formatNumber(video.stats.favorites)}
                    </td>
                    <td className="video-status-cell" data-label="转写">
                      <StatusPill status={video.transcriptStatus} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && !accountDetailLoading && selectedAccountMeta && !videos.length ? <p className="subtle">这个账号还没有视频记录。</p> : null}
      </div>
    </section>
  );
});
