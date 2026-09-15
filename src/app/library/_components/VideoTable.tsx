"use client";

import { memo } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Download, Search, Trash2, WandSparkles, X } from "lucide-react";
import { formatNumber } from "@/components/Formatters";
import { StatusPill } from "@/components/StatusPill";
import type { AccountDetail, AccountListItem, VideoListItem } from "@/lib/types";
import type { SortDirection, VideoStatusFilter } from "../_hooks/useLibrarySelection";
import { getPrimaryMetric, getVideoMetaText, isVideoMetricMissing, type VideoSortMode } from "./library-view-utils";

type VideoTableProps = {
  accountDetailLoading: boolean;
  busy: string;
  completedCount: number;
  effectiveSortMode: VideoSortMode;
  failedCount: number;
  loading: boolean;
  maxPrimaryMetric: number;
  pendingCount: number;
  selectedAccount: AccountDetail | null;
  selectedAccountMeta: AccountListItem | null;
  selectedVideoId: string;
  selectedVideoIds: string[];
  sortDirection: SortDirection;
  videoFilter: string;
  videoManageMode: boolean;
  videos: VideoListItem[];
  videoStatusFilter: VideoStatusFilter;
  onBatchTranscribeSelected: () => void;
  onExportSelected: () => void;
  onRequestDeleteVideos: () => void;
  onSelectVideo: (videoId: string) => void;
  onSortModeChange: (mode: VideoSortMode) => void;
  onToggleAllVideos: () => void;
  onToggleVideoManage: () => void;
  onVideoFilterChange: (value: string) => void;
  onVideoStatusFilterChange: (value: VideoStatusFilter) => void;
};

export const VideoTable = memo(function VideoTable({
  accountDetailLoading,
  busy,
  completedCount,
  effectiveSortMode,
  failedCount,
  loading,
  maxPrimaryMetric,
  pendingCount,
  selectedAccount,
  selectedAccountMeta,
  selectedVideoId,
  selectedVideoIds,
  sortDirection,
  videoFilter,
  videoManageMode,
  videos,
  videoStatusFilter,
  onBatchTranscribeSelected,
  onExportSelected,
  onRequestDeleteVideos,
  onSelectVideo,
  onSortModeChange,
  onToggleAllVideos,
  onToggleVideoManage,
  onVideoFilterChange,
  onVideoStatusFilterChange
}: VideoTableProps) {
  const primarySortMode: VideoSortMode = selectedAccount?.platform === "douyin" ? "hot" : "views";
  const primarySortLabel = selectedAccount?.platform === "douyin" ? "热度" : "播放";
  const sortableHeaders: Array<{ label: string; mode: VideoSortMode }> = [
    { label: "标题", mode: "title" },
    { label: "发布日期", mode: "latest" },
    { label: primarySortLabel, mode: primarySortMode },
    { label: "点赞", mode: "likes" },
    { label: "评论", mode: "comments" },
    { label: "收藏", mode: "favorites" }
  ];
  const allVisibleSelected = Boolean(videos.length && videos.every((video) => selectedVideoIds.includes(video.id)));
  const selectedVisibleVideos = videos.filter((video) => selectedVideoIds.includes(video.id));
  const selectedPendingCount = selectedVisibleVideos.filter((video) => video.transcriptStatus !== "completed").length;
  const selectedCompletedCount = selectedVisibleVideos.length - selectedPendingCount;

  const renderSortHeader = ({ label, mode }: { label: string; mode: VideoSortMode }) => {
    const active = effectiveSortMode === mode;
    return (
      <th aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : undefined} key={mode === "hot" ? "views" : mode}>
        <button
          aria-label={`按${label}${active && sortDirection === "desc" ? "升序" : "降序"}排列`}
          aria-pressed={active}
          className={`video-sort-button ${active ? "active" : ""}`}
          onClick={() => onSortModeChange(mode)}
          type="button"
        >
          <span>{label}</span>
          {active ? sortDirection === "asc" ? <ArrowUp aria-hidden="true" size={13} /> : <ArrowDown aria-hidden="true" size={13} /> : null}
        </button>
      </th>
    );
  };

  return (
    <section className={`pane ${videoManageMode ? "selection-mode" : ""}`}>
      <div className="pane-header video-pane-header">
        <div className="video-header-copy">
          <h2>视频</h2>
          <p className="pane-subtitle" aria-live="polite">
            {loading || accountDetailLoading
              ? "正在读取"
              : `${videos.length}/${selectedAccount?.videoCount || 0} 条 · 已转写 ${completedCount} · 待处理 ${pendingCount}${failedCount ? ` · 失败 ${failedCount}` : ""}`}
          </p>
        </div>
        <div className="video-header-tools">
          <div className="video-filter-search search-control filter-search">
            <Search aria-hidden="true" size={14} />
            <input
              aria-label="搜索视频标题"
              onChange={(event) => onVideoFilterChange(event.target.value)}
              placeholder="搜索视频…"
              type="search"
              value={videoFilter}
            />
          </div>
          <select className="filter-select" aria-label="筛选转写状态" onChange={(event) => onVideoStatusFilterChange(event.target.value as VideoStatusFilter)} value={videoStatusFilter}>
            <option value="all">全部状态</option>
            <option value="pending">待转写</option>
            <option value="completed">已转写</option>
            <option value="failed">失败</option>
          </select>
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
        <div className="selection-toolbar video-selection-toolbar" role="toolbar" aria-label="视频批量操作">
          <button className="btn compact" disabled={!videos.length} onClick={onToggleAllVideos} type="button">
            {allVisibleSelected ? "清空" : "全选当前"}
          </button>
          <div className="selection-copy"><strong>已选 {selectedVideoIds.length} 条</strong></div>
          <button className="btn compact" disabled={!selectedPendingCount || busy === "batch"} onClick={onBatchTranscribeSelected} type="button">
            <WandSparkles aria-hidden="true" size={14} />
            转写 {selectedPendingCount || ""}
          </button>
          <button className="btn compact" disabled={!selectedCompletedCount || busy === "export-transcripts"} onClick={onExportSelected} type="button">
            <Download aria-hidden="true" size={14} />
            导出 {selectedCompletedCount || ""}
          </button>
          <button className="btn danger compact mobile-destructive-action" disabled={!selectedVideoIds.length || busy === "video-delete"} onClick={onRequestDeleteVideos} type="button">
            <Trash2 aria-hidden="true" size={14} />
            {busy === "video-delete" ? "删除中" : "删除"}
          </button>
        </div>
      ) : null}
      <div className="pane-body">
        {loading ? (
          <div className="library-loading-list video" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => <span className="library-loading-row video" key={index} />)}
          </div>
        ) : (
          <table className="video-table">
            <thead>
              <tr>
                {videoManageMode ? <th className="video-select-column"><span className="sr-only">选择</span></th> : null}
                {sortableHeaders.map(renderSortHeader)}
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
                    onClick={() => onSelectVideo(video.id)}
                  >
                    {videoManageMode ? <td className="video-select-cell" aria-hidden="true"><span className={`check-dot ${checked ? "checked" : ""}`} /></td> : null}
                    <td className="video-title-column">
                      <button
                        aria-current={!videoManageMode && selectedVideoId === video.id ? "true" : undefined}
                        aria-pressed={videoManageMode ? checked : undefined}
                        className={`video-row-button ${videoManageMode ? "manage" : ""}`}
                        title={video.title}
                        type="button"
                      >
                        <span className="video-title-cell"><span className="video-title-copy"><span className="video-title-line"><strong>{video.title}</strong></span></span></span>
                      </button>
                    </td>
                    <td className="video-date-cell" data-label="发布日期">{getVideoMetaText(video)}</td>
                    <td className="video-number-cell" data-label={primaryLabel} aria-label={`${primaryLabel} ${formatNumber(primaryValue)}`}>
                      <strong>{formatNumber(primaryValue)}</strong>
                      <span className="metric-bar" aria-hidden="true"><span style={{ transform: `scaleX(${metricWidth / 100})` }} /></span>
                    </td>
                    <td className="video-number-cell" data-label="点赞">{formatNumber(video.stats.likes)}</td>
                    <td className="video-number-cell" data-label="评论">{isVideoMetricMissing(video, "comments") ? "未取到" : formatNumber(video.stats.comments)}</td>
                    <td className="video-number-cell" data-label="收藏">{isVideoMetricMissing(video, "favorites") ? "未取到" : formatNumber(video.stats.favorites)}</td>
                    <td className="video-status-cell" data-label="转写"><StatusPill status={video.transcriptStatus} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && !accountDetailLoading && selectedAccountMeta && !videos.length ? <p className="subtle">当前筛选下没有视频。</p> : null}
      </div>
    </section>
  );
});
