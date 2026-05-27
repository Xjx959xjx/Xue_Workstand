"use client";

import { useEffect, useMemo, useState, type CSSProperties, type WheelEvent } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Copy,
  CircleDollarSign,
  Clock3,
  Eye,
  Forward,
  Gauge,
  Link2,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Star,
  ThumbsUp,
  Trash2,
  UserRound,
  Video,
  XCircle
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useFeedback } from "@/components/FeedbackProvider";
import {
  deleteGrossMarginMonitorRecord,
  getGrossMarginLibrary,
  refreshGrossMarginMonitorRecord,
  refreshGrossMarginMonitorRecords,
  updateGrossMarginMonitorPlayCurrent,
  updateGrossMarginMonitorPlayTarget
} from "@/lib/client";
import type { GrossMarginLibrary, GrossMarginMonitorMetric, GrossMarginMonitorRecord } from "@/lib/types";

export default function GrossMarginMonitorPage() {
  const { notify } = useFeedback();
  const [library, setLibrary] = useState<GrossMarginLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"all" | GrossMarginMonitorRecord["platform"]>("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<GrossMarginMonitorRecord | null>(null);

  const records = useMemo(() => library?.monitorRecords || [], [library]);
  const filteredRecords = useMemo(() => {
    const keyword = accountFilter.trim().toLowerCase();
    const fromTime = getDayBoundaryTime(dateFromFilter, "start");
    const toTime = getDayBoundaryTime(dateToFilter, "end");

    return records.filter((record) => {
      if (platformFilter !== "all" && record.platform !== platformFilter) return false;
      if (projectFilter !== "all" && record.projectId !== projectFilter) return false;
      if (keyword) {
        const haystack = `${record.accountName || ""} ${record.title || ""} ${record.videoUrl || ""} ${record.videoKey || ""}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }

      if (fromTime !== null || toTime !== null) {
        const publishedTime = getSortTime(record.publishedAt);
        if (!Number.isFinite(publishedTime)) return false;
        if (fromTime !== null && publishedTime < fromTime) return false;
        if (toTime !== null && publishedTime > toTime) return false;
      }

      return true;
    });
  }, [accountFilter, dateFromFilter, dateToFilter, platformFilter, projectFilter, records]);
  const sortedRecords = useMemo(
    () =>
      [...filteredRecords].sort((left, right) => {
        const publishedTimeDiff = getSortTime(right.publishedAt) - getSortTime(left.publishedAt);
        if (publishedTimeDiff !== 0) return publishedTimeDiff;
        return getSortTime(right.updatedAt) - getSortTime(left.updatedAt);
      }),
    [filteredRecords]
  );
  const monitorProjects = useMemo(() => library?.monitorProjects || [], [library]);
  const hasActiveFilters = Boolean(accountFilter.trim() || platformFilter !== "all" || projectFilter !== "all" || dateFromFilter || dateToFilter);

  useEffect(() => {
    let ignore = false;
    getGrossMarginLibrary()
      .then((result) => {
        if (!ignore) setLibrary(result);
      })
      .catch((error) => {
        if (!ignore) notify({ tone: "error", message: error instanceof Error ? error.message : "读取维护监控失败" });
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [notify]);

  async function handleRefreshAll() {
    const targetRecordIds = sortedRecords.map((record) => record.id);
    if (!targetRecordIds.length) {
      notify({ tone: "warning", message: "当前筛选下没有可刷新的监控记录" });
      return;
    }
    setBusy("refresh-all");
    try {
      const result = await refreshGrossMarginMonitorRecords(targetRecordIds);
      setLibrary(result.library);
      notify({ tone: "success", message: `已刷新 ${result.records.length} 条监控记录` });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "刷新全部失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleRefreshOne(recordId: string) {
    setBusy(`refresh-${recordId}`);
    try {
      const result = await refreshGrossMarginMonitorRecord(recordId);
      setLibrary(result.library);
      notify({ tone: result.record.status === "failed" ? "warning" : "success", message: result.record.status === "failed" ? "该记录刷新失败，请查看行内提示" : "监控记录已刷新" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "刷新监控记录失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleDelete(recordId: string) {
    setBusy(`delete-${recordId}`);
    try {
      const result = await deleteGrossMarginMonitorRecord(recordId);
      setLibrary(result.library);
      setDeleteTarget((current) => (current?.id === recordId ? null : current));
      notify({ tone: "success", message: "监控记录已删除" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "删除监控记录失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleUpdatePlayTarget(recordId: string, target: number) {
    setBusy(`play-target-${recordId}`);
    try {
      const result = await updateGrossMarginMonitorPlayTarget(recordId, target);
      setLibrary(result.library);
      notify({ tone: "success", message: "播放目标已更新" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "更新播放目标失败" });
      throw error;
    } finally {
      setBusy("");
    }
  }

  async function handleUpdatePlayCurrent(recordId: string, current: number) {
    setBusy(`play-current-${recordId}`);
    try {
      const result = await updateGrossMarginMonitorPlayCurrent(recordId, current);
      setLibrary(result.library);
      notify({ tone: "success", message: "当前播放量已更新" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "更新当前播放量失败" });
      throw error;
    } finally {
      setBusy("");
    }
  }

  async function handleCopyDifference(record: GrossMarginMonitorRecord) {
    try {
      await navigator.clipboard.writeText(buildMonitorDifferenceText(record));
      notify({ tone: "success", message: "差额文案已复制" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "复制失败" });
    }
  }

  return (
    <div className="page gross-margin-page gross-monitor-page">
      <div className="gross-monitor-topbar">
        <div className="page-header-meta">
          <span className="stat-pill">{hasActiveFilters ? `${sortedRecords.length} / ${records.length} 条记录` : `${records.length} 条记录`}</span>
          <span className="stat-pill">{sortedRecords.filter((record) => record.status === "failed").length} 条异常</span>
        </div>
        <div className="gross-monitor-toolbar">
          <div className="gross-monitor-inline-filters" role="group" aria-label="监控筛选">
            <input
              aria-label="按账号、标题或链接筛选"
              autoComplete="off"
              className="gross-monitor-inline-input"
              id="gross-monitor-account-filter"
              onChange={(event) => setAccountFilter(event.target.value)}
              placeholder="账号 / 标题 / 链接"
              type="text"
              value={accountFilter}
            />
            <select
              aria-label="按平台筛选"
              className="gross-monitor-inline-select"
              id="gross-monitor-platform-filter"
              onChange={(event) => setPlatformFilter(event.target.value as "all" | GrossMarginMonitorRecord["platform"])}
              value={platformFilter}
            >
              <option value="all">全部平台</option>
              <option value="bilibili">B站</option>
              <option value="douyin">抖音</option>
            </select>
            <select
              aria-label="按项目筛选"
              className="gross-monitor-inline-select gross-monitor-project-select"
              id="gross-monitor-project-filter"
              onChange={(event) => setProjectFilter(event.target.value)}
              value={projectFilter}
            >
              <option value="all">全部项目</option>
              {monitorProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}（{project.count}）
                </option>
              ))}
            </select>
            <input
              aria-label="开始日期"
              className="gross-monitor-inline-date"
              id="gross-monitor-date-from"
              onChange={(event) => setDateFromFilter(event.target.value)}
              type="date"
              value={dateFromFilter}
            />
            <span className="gross-monitor-inline-date-separator" aria-hidden="true">
              至
            </span>
            <input
              aria-label="结束日期"
              className="gross-monitor-inline-date"
              id="gross-monitor-date-to"
              onChange={(event) => setDateToFilter(event.target.value)}
              type="date"
              value={dateToFilter}
            />
            {hasActiveFilters ? (
              <button
                className="btn subtle compact"
                onClick={() => {
                  setAccountFilter("");
                  setPlatformFilter("all");
                  setProjectFilter("all");
                  setDateFromFilter("");
                  setDateToFilter("");
                }}
                type="button"
              >
                清空
              </button>
            ) : null}
          </div>
          <div className="button-row">
            <button className="btn primary" disabled={busy === "refresh-all" || !sortedRecords.length} onClick={() => void handleRefreshAll()} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              {busy === "refresh-all" ? "刷新中" : hasActiveFilters ? "刷新当前" : "刷新全部"}
            </button>
          </div>
        </div>
      </div>

      <section className="gross-monitor-board">
        {loading ? (
          <div className="gross-monitor-empty">
            <RefreshCw aria-hidden="true" size={18} />
            <p>正在读取监控记录。</p>
          </div>
        ) : records.length ? (
          <div className="gross-monitor-card-grid" onWheel={handleHorizontalWheel}>
            {sortedRecords.map((record) => (
              <MonitorCard
                busy={busy}
                key={record.id}
                record={record}
                onDelete={setDeleteTarget}
                onCopy={handleCopyDifference}
                onRefresh={handleRefreshOne}
                onUpdatePlayCurrent={handleUpdatePlayCurrent}
                onUpdatePlayTarget={handleUpdatePlayTarget}
              />
            ))}
          </div>
        ) : hasActiveFilters ? (
          <div className="gross-monitor-empty">
            <p>没有符合当前筛选条件的监控记录，请调整账号、链接、平台、项目或日期范围。</p>
          </div>
        ) : (
          <div className="gross-monitor-empty">
            <p>还没有监控记录。先在数据维护里导出文案，系统会自动保存维护目标。</p>
          </div>
        )}
      </section>
      {deleteTarget ? (
        <ConfirmDialog
          body={`会删除监控记录“${deleteTarget.title || deleteTarget.videoUrl}”，删除后无法恢复。`}
          busy={busy === `delete-${deleteTarget.id}`}
          confirmLabel="删除记录"
          title="确认删除监控记录？"
          onCancel={() => {
            if (busy !== `delete-${deleteTarget.id}`) setDeleteTarget(null);
          }}
          onConfirm={() => void handleDelete(deleteTarget.id)}
        />
      ) : null}
    </div>
  );
}

function handleHorizontalWheel(event: WheelEvent<HTMLDivElement>) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.currentTarget.scrollLeft += event.deltaY;
  event.preventDefault();
}

function MonitorCard({
  busy,
  record,
  onDelete,
  onCopy,
  onRefresh,
  onUpdatePlayCurrent,
  onUpdatePlayTarget
}: {
  busy: string;
  record: GrossMarginMonitorRecord;
  onDelete: (record: GrossMarginMonitorRecord) => void;
  onCopy: (record: GrossMarginMonitorRecord) => Promise<void>;
  onRefresh: (recordId: string) => Promise<void>;
  onUpdatePlayCurrent: (recordId: string, current: number) => Promise<void>;
  onUpdatePlayTarget: (recordId: string, target: number) => Promise<void>;
}) {
  const title = record.title || record.videoUrl;
  const metrics = getDisplayMetrics(record);
  const overallGap = getOverallGap(record);
  const overallGapTone = getOverallGapTone(overallGap.percent, record.status);
  const changedMetricCount = metrics.filter((metric) => {
    const delta = getMetricRefreshDelta(record, metric.service);
    return delta !== null && delta !== 0;
  }).length;
  const visibleWarnings = record.warnings.filter((warning) => !isBlueLinkFetchWarning(warning));
  const [editingPlay, setEditingPlay] = useState(false);
  const playMetric = metrics.find((metric) => metric.service === "play");
  const canEditPlayCurrent = record.platform === "douyin";
  const [playTargetDraft, setPlayTargetDraft] = useState(playMetric ? formatEditableMetricValue(playMetric.target, record.platform) : "");
  const [playCurrentDraft, setPlayCurrentDraft] = useState(
    playMetric && typeof playMetric.current === "number" ? formatEditableMetricValue(playMetric.current, record.platform) : ""
  );

  useEffect(() => {
    if (!editingPlay && playMetric) {
      setPlayTargetDraft(formatEditableMetricValue(playMetric.target, record.platform));
      setPlayCurrentDraft(
        typeof playMetric.current === "number" ? formatEditableMetricValue(playMetric.current, record.platform) : ""
      );
    }
  }, [editingPlay, playMetric, record.platform]);

  async function submitPlayEdit() {
    if (!playMetric) return;
    const nextTarget = parseMetricInput(playTargetDraft);
    if (!nextTarget || nextTarget <= 0) {
      throw new Error("请输入有效的播放目标");
    }

    const nextCurrent =
      canEditPlayCurrent && playCurrentDraft.trim()
        ? parseMetricInput(playCurrentDraft)
        : typeof playMetric.current === "number"
          ? playMetric.current
          : null;
    if (canEditPlayCurrent && (nextCurrent === null || nextCurrent < 0)) {
      throw new Error("请输入有效的当前播放量");
    }

    if (nextTarget !== playMetric.target) {
      await onUpdatePlayTarget(record.id, nextTarget);
    }
    if (canEditPlayCurrent && nextCurrent !== null && nextCurrent !== playMetric.current) {
      await onUpdatePlayCurrent(record.id, nextCurrent);
    }
    if (nextTarget === playMetric.target && (!canEditPlayCurrent || nextCurrent === playMetric.current)) {
      setEditingPlay(false);
      return;
    }
    setEditingPlay(false);
  }

  return (
    <article className={`gross-monitor-card ${overallGapTone === "danger" ? "high-risk" : overallGapTone === "warning" ? "mid-risk" : ""}`}>
      <div className="gross-monitor-card-main">
        <div className="gross-monitor-card-title">
          <span className="gross-monitor-card-copy">
            <span className="gross-monitor-eyebrow">
              <UserRound aria-hidden="true" size={13} />
              {record.accountName || "未命名账号"}
              <em>{formatPlatform(record.platform)}</em>
              <em className="gross-monitor-publish-date">{formatMonthDay(record.publishedAt)}</em>
            </span>
            <strong>{title}</strong>
          </span>
        </div>
      </div>

      <div className="gross-monitor-risk-line">
        <span
          className={`gross-monitor-risk-dial ${overallGapTone} ${record.platform}`}
          style={{ "--risk-fill": `${overallGap.percent * 100}%` } as CSSProperties}
        >
          <strong>{formatOverallGap(overallGap, record.status)}</strong>
          <small>整体缺口</small>
        </span>
        <span className="gross-monitor-risk-meta">
          <span>
            {renderStatusIcon(record.status)}
            {formatStatus(record.status)}
            <CalendarClock aria-hidden="true" size={12} />
            {formatDateTime(record.lastRefreshedAt || record.updatedAt)}
            {record.status === "completed" ? (
              <em className={`gross-monitor-refresh-summary ${changedMetricCount ? "changed" : "stable"}`}>
                {changedMetricCount ? `${changedMetricCount} 项变化` : "本次无变化"}
              </em>
            ) : null}
          </span>
          <span className="gross-monitor-card-actions">
            {record.videoUrl ? (
              <a aria-label="打开视频链接" className="btn icon-btn icon-only" href={record.videoUrl} rel="noreferrer" target="_blank">
                <Link2 aria-hidden="true" size={14} />
              </a>
            ) : null}
            <button aria-label="复制差额文案" className="btn compact" onClick={() => void onCopy(record)} type="button">
              <Copy aria-hidden="true" size={14} />
              差额
            </button>
            <button className="btn compact" disabled={busy === `refresh-${record.id}`} onClick={() => void onRefresh(record.id)} type="button">
              <RefreshCw aria-hidden="true" size={14} />
              {busy === `refresh-${record.id}` ? "刷新中" : "刷新"}
            </button>
            <button
              aria-label="删除监控记录"
              className="btn danger icon-btn icon-only"
              disabled={busy === `delete-${record.id}`}
              onClick={() => onDelete(record)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          </span>
        </span>
      </div>

      <div className="gross-monitor-metric-list" aria-label={formatTargetSummary(record)}>
        {metrics.map((metric) => {
          const refreshDelta = getMetricRefreshDelta(record, metric.service);
          const deltaTone = refreshDelta === null ? "" : refreshDelta > 0 ? "positive" : refreshDelta < 0 ? "negative" : "neutral";
          const deltaLabel = refreshDelta === null ? "" : `，本次刷新 ${formatMetricRefreshDelta(refreshDelta, metric.service, record.platform)}`;

          return (
            <span
              aria-label={`${getMetricLabel(metric)}，目标 ${formatMetric(metric.target, record.platform)}，当前 ${formatMetricCurrentValue(metric, record.platform)}，缺口比例 ${formatMetricPercent(metric)}${deltaLabel}`}
              className={`gross-monitor-metric-cell ${metric.highRisk ? "danger" : ""}`}
              key={metric.service}
              title={`${getMetricLabel(metric)} | 目标 ${formatMetric(metric.target, record.platform)} | 当前 ${formatMetricCurrentValue(metric, record.platform)} | ${formatMetricPercent(metric)}${refreshDelta === null ? "" : ` | 本次刷新 ${formatMetricRefreshDelta(refreshDelta, metric.service, record.platform)}`}`}
            >
              <span className="gross-monitor-metric-cell-head">
                {renderMetricIcon(metric.service)}
                <strong>{getMetricLabel(metric)}</strong>
                <b className={metric.highRisk ? "risk-text" : ""}>{formatMetricPercent(metric)}</b>
              </span>
              <span className="gross-monitor-metric-bar" aria-hidden="true">
                <span style={{ width: `${getMetricProgress(metric)}%` }} />
              </span>
              <span className="gross-monitor-metric-cell-values">
                <span className="gross-monitor-metric-cell-value-main">
                  {metric.service === "play" ? (
                    <em
                      className={`gross-monitor-play-edit ${editingPlay ? "editing" : ""}`}
                      onDoubleClick={() => setEditingPlay(true)}
                      title="双击修改播放目标"
                    >
                      {editingPlay ? (
                        <span className="gross-monitor-play-edit-fields">
                          {canEditPlayCurrent ? (
                            <input
                              aria-label="当前播放量"
                              autoFocus
                              className="gross-monitor-play-input"
                              disabled={busy === `play-current-${record.id}` || busy === `play-target-${record.id}`}
                              onBlur={(event) => {
                                if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
                                void submitPlayEdit().catch(() => undefined);
                              }}
                              onChange={(event) => setPlayCurrentDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void submitPlayEdit().catch(() => undefined);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setPlayTargetDraft(formatEditableMetricValue(metric.target, record.platform));
                                  setPlayCurrentDraft(
                                    typeof metric.current === "number" ? formatEditableMetricValue(metric.current, record.platform) : ""
                                  );
                                  setEditingPlay(false);
                                }
                              }}
                              placeholder="当前"
                              type="text"
                              value={playCurrentDraft}
                            />
                          ) : null}
                          <input
                            aria-label="播放目标"
                            autoFocus={!canEditPlayCurrent}
                            className="gross-monitor-play-input"
                            disabled={busy === `play-current-${record.id}` || busy === `play-target-${record.id}`}
                            onBlur={(event) => {
                              if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
                              void submitPlayEdit().catch(() => undefined);
                            }}
                            onChange={(event) => setPlayTargetDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void submitPlayEdit().catch(() => undefined);
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setPlayTargetDraft(formatEditableMetricValue(metric.target, record.platform));
                                setPlayCurrentDraft(
                                  typeof metric.current === "number" ? formatEditableMetricValue(metric.current, record.platform) : ""
                                );
                                setEditingPlay(false);
                              }
                            }}
                            placeholder="目标"
                            type="text"
                            value={playTargetDraft}
                          />
                        </span>
                      ) : (
                        <>
                          {formatMetricCurrentValue(metric, record.platform)} / {formatMetric(metric.target, record.platform)}
                        </>
                      )}
                    </em>
                  ) : (
                    <em>{formatMetricCurrentValue(metric, record.platform)} / {formatMetric(metric.target, record.platform)}</em>
                  )}
                </span>
                {refreshDelta !== null ? (
                  <span className={`gross-monitor-metric-delta ${deltaTone}`}>
                    {formatMetricRefreshDelta(refreshDelta, metric.service, record.platform)}
                  </span>
                ) : null}
              </span>
            </span>
          );
        })}
        {!record.metrics.length ? <span className="gross-monitor-more-metrics muted">无可监控目标</span> : null}
      </div>

      {visibleWarnings.length ? (
        <p className="gross-monitor-warning">
          <AlertTriangle aria-hidden="true" size={13} />
          {visibleWarnings[0]}
        </p>
      ) : null}

    </article>
  );
}

function formatTargetSummary(record: GrossMarginMonitorRecord) {
  return record.metrics
    .slice(0, 4)
    .map((metric) => `${getMetricLabel(metric)}${formatMetric(metric.target, record.platform)}`)
    .join("，") || "无可监控目标";
}

function buildMonitorDifferenceText(record: GrossMarginMonitorRecord) {
  const lines = getDisplayMetrics(record)
    .map((metric) => `${getMetricLabel(metric)}：${formatGapMetric(metric.difference, metric.service, record.platform)}`)
    .filter(Boolean);

  return ["@罗月琴 目前差额：", "", ...lines].join("\n");
}

function isBlueLinkFetchWarning(warning: string) {
  return warning.includes("蓝链点击目前没有稳定公开抓取来源");
}

function getMetricLabel(metric: GrossMarginMonitorMetric) {
  if (metric.service === "play") return "播放";
  return metric.label;
}

function getDisplayMetrics(record: GrossMarginMonitorRecord) {
  const order: GrossMarginMonitorMetric["service"][] = ["play", "danmaku", "comment", "like", "favorite", "coin", "share", "blueLink"];
  const index = new Map(order.map((service, position) => [service, position]));
  return [...record.metrics].sort((left, right) => (index.get(left.service) ?? 999) - (index.get(right.service) ?? 999));
}

function getOverallGap(record: GrossMarginMonitorRecord) {
  const refreshedMetrics = record.metrics.filter((metric) => typeof metric.current === "number" && metric.target > 0);
  const target = refreshedMetrics.reduce((sum, metric) => sum + metric.target, 0);
  const difference = refreshedMetrics.reduce((sum, metric) => sum + metric.difference, 0);
  return {
    difference,
    percent: target > 0 ? difference / target : 0,
    target
  };
}

function getOverallGapTone(percent: number, status: GrossMarginMonitorRecord["status"]) {
  if (status === "pending") return "neutral";
  if (percent >= 0.75) return "danger";
  if (percent >= 0.45) return "warning";
  if (percent > 0) return "calm";
  return "neutral";
}

function formatPlatform(platform: GrossMarginMonitorRecord["platform"]) {
  return platform === "bilibili" ? "B站" : "抖音";
}

function formatStatus(status: GrossMarginMonitorRecord["status"]) {
  if (status === "completed") return "已刷新";
  if (status === "failed") return "失败";
  return "待刷新";
}

function formatOverallGap(gap: { percent: number; target: number }, status: GrossMarginMonitorRecord["status"]) {
  if (!gap.target) return status === "pending" ? "待刷新" : "无目标";
  return formatPercent(gap.percent);
}

function formatMetricPercent(metric: GrossMarginMonitorMetric) {
  if (metric.manualOnly) return "/";
  if (typeof metric.current !== "number") return "待刷新";
  return formatPercent(metric.differencePercent);
}

function formatMetricCurrentValue(metric: GrossMarginMonitorMetric, platform: GrossMarginMonitorRecord["platform"]) {
  if (metric.manualOnly && typeof metric.current !== "number") return "手动确认";
  if (typeof metric.current !== "number") return "未刷新";
  return formatMetric(metric.current, platform);
}

function getMetricProgress(metric: GrossMarginMonitorMetric) {
  if (typeof metric.current !== "number") return 0;
  return Math.min(100, Math.max(0, (metric.current / metric.target) * 100));
}

function getMetricRefreshDelta(record: GrossMarginMonitorRecord, service: GrossMarginMonitorMetric["service"]) {
  const current = record.currentStats?.[service];
  if (typeof current !== "number") return null;
  const previous = record.previousStats?.[service];
  return current - (typeof previous === "number" ? previous : 0);
}

function renderStatusIcon(status: GrossMarginMonitorRecord["status"]) {
  if (status === "completed") return <CheckCircle2 aria-hidden="true" size={13} />;
  if (status === "failed") return <XCircle aria-hidden="true" size={13} />;
  return <Clock3 aria-hidden="true" size={13} />;
}

function renderMetricIcon(service: GrossMarginMonitorMetric["service"]) {
  if (service === "play") return <Eye aria-hidden="true" size={13} />;
  if (service === "like") return <ThumbsUp aria-hidden="true" size={13} />;
  if (service === "coin" || service === "douPlus") return <CircleDollarSign aria-hidden="true" size={13} />;
  if (service === "favorite") return <Star aria-hidden="true" size={13} />;
  if (service === "comment") return <MessageCircle aria-hidden="true" size={13} />;
  if (service === "share") return <Forward aria-hidden="true" size={13} />;
  if (service === "danmaku") return <Video aria-hidden="true" size={13} />;
  if (service === "blueLink") return <MousePointerClick aria-hidden="true" size={13} />;
  return <Gauge aria-hidden="true" size={13} />;
}

function formatMetric(value: number, platform: GrossMarginMonitorRecord["platform"]) {
  if (value >= 10000) return `${stripZeros((value / 10000).toFixed(2))}${platform === "bilibili" ? "W" : "万"}`;
  return String(Math.round(value));
}

function formatGapMetric(value: number, service: GrossMarginMonitorMetric["service"], platform: GrossMarginMonitorRecord["platform"]) {
  if (service === "play" && value >= 10000) {
    return `${stripZeros((value / 10000).toFixed(2))}${platform === "bilibili" ? "W" : "万"}`;
  }
  return String(Math.round(value));
}

function formatMetricRefreshDelta(value: number, service: GrossMarginMonitorMetric["service"], platform: GrossMarginMonitorRecord["platform"]) {
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "-";
  const absolute = Math.abs(value);
  return `${sign}${formatGapMetric(absolute, service, platform)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatEditableMetricValue(value: number, platform: GrossMarginMonitorRecord["platform"]) {
  if (value >= 10000) {
    return `${stripZeros((value / 10000).toFixed(2))}${platform === "bilibili" ? "W" : "万"}`;
  }
  return String(Math.round(value));
}

function parseMetricInput(value: string) {
  const normalized = value.trim().replace(/,/g, "").toLowerCase();
  if (!normalized) return 0;
  const wanMatch = normalized.match(/^(\d+(?:\.\d+)?)(w|万)$/i);
  if (wanMatch) {
    return Math.round(Number(wanMatch[1]) * 10000);
  }
  const plain = Number(normalized);
  if (!Number.isFinite(plain)) return 0;
  return Math.round(plain);
}

function stripZeros(value: string) {
  return value.replace(/\.?0+$/, "");
}

function formatDateTime(value?: string) {
  if (!value) return "尚未刷新";
  const date = new Date(value);
  if (Number.isNaN(+date)) return "时间无效";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatMonthDay(value?: string) {
  if (!value) return "--/--";
  const date = new Date(value);
  if (Number.isNaN(+date)) return "--/--";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  });
}

function getSortTime(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = +new Date(value);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function getDayBoundaryTime(value: string, mode: "start" | "end") {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return mode === "start"
    ? new Date(year, month, day, 0, 0, 0, 0).getTime()
    : new Date(year, month, day, 23, 59, 59, 999).getTime();
}
