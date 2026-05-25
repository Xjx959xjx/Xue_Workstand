"use client";

import { useEffect, useMemo, useState, type CSSProperties, type WheelEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
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
import { useFeedback } from "@/components/FeedbackProvider";
import {
  deleteGrossMarginMonitorRecord,
  getGrossMarginLibrary,
  refreshGrossMarginMonitorRecord,
  refreshGrossMarginMonitorRecords,
  updateGrossMarginMonitorPlayTarget
} from "@/lib/client";
import type { GrossMarginLibrary, GrossMarginMonitorMetric, GrossMarginMonitorRecord } from "@/lib/types";

export default function GrossMarginMonitorPage() {
  const { notify } = useFeedback();
  const [library, setLibrary] = useState<GrossMarginLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const records = useMemo(() => library?.monitorRecords || [], [library]);
  const sortedRecords = useMemo(
    () =>
      [...records].sort((left, right) => {
        const rightGap = getOverallGap(right).percent;
        const leftGap = getOverallGap(left).percent;
        if (rightGap !== leftGap) return rightGap - leftGap;
        return +new Date(right.updatedAt) - +new Date(left.updatedAt);
      }),
    [records]
  );

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
    setBusy("refresh-all");
    try {
      const result = await refreshGrossMarginMonitorRecords();
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
      notify({ tone: "success", message: "播放量目标已更新" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "更新播放量目标失败" });
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
          <span className="stat-pill">{records.length} 条记录</span>
          <span className="stat-pill">{sortedRecords.filter((record) => record.status === "failed").length} 条异常</span>
        </div>
        <div className="button-row">
          <Link className="btn" href="/gross-margin">
            <ArrowLeft aria-hidden="true" size={15} />
            返回数据维护
          </Link>
          <button className="btn primary" disabled={busy === "refresh-all" || !records.length} onClick={() => void handleRefreshAll()} type="button">
            <RefreshCw aria-hidden="true" size={15} />
            {busy === "refresh-all" ? "刷新中" : "刷新全部"}
          </button>
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
                onDelete={handleDelete}
                onCopy={handleCopyDifference}
                onRefresh={handleRefreshOne}
                onUpdatePlayTarget={handleUpdatePlayTarget}
              />
            ))}
          </div>
        ) : (
          <div className="gross-monitor-empty">
            <p>还没有监控记录。先回到数据维护页导出审核文案，系统会自动保存维护目标。</p>
            <Link className="btn primary" href="/gross-margin">
              返回数据维护
            </Link>
          </div>
        )}
      </section>
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
  onUpdatePlayTarget
}: {
  busy: string;
  record: GrossMarginMonitorRecord;
  onDelete: (recordId: string) => Promise<void>;
  onCopy: (record: GrossMarginMonitorRecord) => Promise<void>;
  onRefresh: (recordId: string) => Promise<void>;
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
  const [playDraft, setPlayDraft] = useState(playMetric ? formatEditablePlayTarget(playMetric.target, record.platform) : "");

  useEffect(() => {
    if (!editingPlay && playMetric) {
      setPlayDraft(formatEditablePlayTarget(playMetric.target, record.platform));
    }
  }, [editingPlay, playMetric, record.platform]);

  async function submitPlayTarget() {
    if (!playMetric) return;
    const parsed = parseMetricInput(playDraft);
    if (!parsed || parsed <= 0) {
      throw new Error("请输入有效的播放量目标");
    }
    if (parsed === playMetric.target) {
      setEditingPlay(false);
      return;
    }
    await onUpdatePlayTarget(record.id, parsed);
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
          className={`gross-monitor-risk-dial ${overallGapTone}`}
          style={{ "--risk-fill": `${overallGap.percent * 100}%` } as CSSProperties}
        >
          <strong>{formatOverallGap(overallGap, record.status)}</strong>
          <small>整体差额</small>
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
            <button className="btn compact" onClick={() => void onCopy(record)} type="button">
              <Copy aria-hidden="true" size={14} />
              复制
            </button>
            <button className="btn compact" disabled={busy === `refresh-${record.id}`} onClick={() => void onRefresh(record.id)} type="button">
              <RefreshCw aria-hidden="true" size={14} />
              {busy === `refresh-${record.id}` ? "刷新中" : "刷新"}
            </button>
            <button
              aria-label="删除监控记录"
              className="btn danger icon-btn icon-only"
              disabled={busy === `delete-${record.id}`}
              onClick={() => void onDelete(record.id)}
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
              aria-label={`${metric.label}，目标 ${formatMetric(metric.target, record.platform)}，当前 ${formatMetricCurrentValue(metric, record.platform)}，差额比例 ${formatMetricPercent(metric)}${deltaLabel}`}
              className={`gross-monitor-metric-cell ${metric.highRisk ? "danger" : ""}`}
              key={metric.service}
              title={`${metric.label} | 目标 ${formatMetric(metric.target, record.platform)} | 当前 ${formatMetricCurrentValue(metric, record.platform)} | ${formatMetricPercent(metric)}${refreshDelta === null ? "" : ` | 本次刷新 ${formatMetricRefreshDelta(refreshDelta, metric.service, record.platform)}`}`}
            >
              <span className="gross-monitor-metric-cell-head">
                {renderMetricIcon(metric.service)}
                <strong>{metric.label}</strong>
                <b className={metric.highRisk ? "risk-text" : ""}>{formatMetricPercent(metric)}</b>
              </span>
              <span className="gross-monitor-metric-bar" aria-hidden="true">
                <span style={{ width: `${getMetricProgress(metric)}%` }} />
              </span>
              <span className="gross-monitor-metric-cell-values">
                <span className="gross-monitor-metric-cell-value-main">
                  {metric.service === "play" && record.platform === "bilibili" ? (
                    <em
                      className={`gross-monitor-play-edit ${editingPlay ? "editing" : ""}`}
                      onDoubleClick={() => setEditingPlay(true)}
                      title="双击修改播放量目标"
                    >
                      {editingPlay ? (
                        <input
                          autoFocus
                          className="gross-monitor-play-input"
                          disabled={busy === `play-target-${record.id}`}
                          onBlur={() => {
                            void submitPlayTarget().catch(() => undefined);
                          }}
                          onChange={(event) => setPlayDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void submitPlayTarget().catch(() => undefined);
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setPlayDraft(formatEditablePlayTarget(metric.target, record.platform));
                              setEditingPlay(false);
                            }
                          }}
                          type="text"
                          value={playDraft}
                        />
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
  return record.metrics.slice(0, 4).map((metric) => `${metric.label}${formatMetric(metric.target, record.platform)}`).join("，") || "无可监控目标";
}

function buildMonitorDifferenceText(record: GrossMarginMonitorRecord) {
  const lines = getDisplayMetrics(record)
    .map((metric) => `${metric.label}：${formatDifferenceMetric(metric.difference, metric.service, record.platform)}`)
    .filter(Boolean);

  return ["@罗月琴 目前差额：", "", ...lines].join("\n");
}

function isBlueLinkFetchWarning(warning: string) {
  return warning.includes("蓝链点击目前没有稳定公开抓取来源");
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

function formatDifferenceMetric(value: number, service: GrossMarginMonitorMetric["service"], platform: GrossMarginMonitorRecord["platform"]) {
  if (service === "play" && value >= 10000) {
    return `${stripZeros((value / 10000).toFixed(2))}${platform === "bilibili" ? "W" : "万"}`;
  }
  return String(Math.round(value));
}

function formatMetricRefreshDelta(value: number, service: GrossMarginMonitorMetric["service"], platform: GrossMarginMonitorRecord["platform"]) {
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "-";
  const absolute = Math.abs(value);
  return `${sign}${formatDifferenceMetric(absolute, service, platform)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatEditablePlayTarget(value: number, platform: GrossMarginMonitorRecord["platform"]) {
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
