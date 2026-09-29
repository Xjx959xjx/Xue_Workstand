"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarRange,
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
  Search,
  Star,
  ThumbsUp,
  Trash2,
  UserRound,
  Video,
  XCircle
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useFeedback } from "@/components/FeedbackProvider";
import { useScopedTasks } from "@/components/TaskProvider";
import {
  deleteGrossMarginMonitorRecord,
  getGrossMarginLibrary,
  refreshGrossMarginLibraryCache,
  refreshGrossMarginMonitorRecord,
  updateGrossMarginMonitorPlayCurrent,
  updateGrossMarginMonitorPlayTarget
} from "@/lib/client";
import type { GrossMarginLibrary, GrossMarginMonitorMetric, GrossMarginMonitorRecord } from "@/lib/types";

export default function GrossMarginMonitorPage() {
  return (
    <Suspense fallback={<GrossMarginMonitorFallback />}>
      <GrossMarginMonitorPageContent />
    </Suspense>
  );
}

function GrossMarginMonitorPageContent() {
  const { notify } = useFeedback();
  const { activeJobs, recentJobs, startTask } = useScopedTasks({
    href: "/gross-margin/monitor",
    kinds: ["gross-margin-refresh"]
  });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [library, setLibrary] = useState<GrossMarginLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [accountFilter, setAccountFilter] = useState(() => searchParams.get("q") || "");
  const [platformFilter, setPlatformFilter] = useState<"all" | GrossMarginMonitorRecord["platform"]>(() => parsePlatformFilter(searchParams.get("platform")));
  const [projectFilter, setProjectFilter] = useState(() => searchParams.get("project") || "all");
  const [dateFromFilter, setDateFromFilter] = useState(() => parseDateFilter(searchParams.get("from")));
  const [dateToFilter, setDateToFilter] = useState(() => parseDateFilter(searchParams.get("to")));
  const [deleteTarget, setDeleteTarget] = useState<GrossMarginMonitorRecord | null>(null);
  const [activeRefreshJobId, setActiveRefreshJobId] = useState("");
  const syncedRefreshDataRevisionsRef = useRef<Map<string, number>>(new Map());
  const trackedRefreshJob = useMemo(
    () =>
      (activeRefreshJobId
        ? [...activeJobs, ...recentJobs].find((job) => job.id === activeRefreshJobId)
        : null) || activeJobs.find((job) => job.kind === "gross-margin-refresh") || null,
    [activeJobs, activeRefreshJobId, recentJobs]
  );

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
  const overview = useMemo(() => {
    let highGapCount = 0;
    let refreshIssueCount = 0;

    sortedRecords.forEach((record) => {
      const gap = getOverallGap(record);
      if (getOverallGapTone(gap.percent, record.status) === "danger") highGapCount += 1;
      if (record.status === "failed" || record.status === "partial") refreshIssueCount += 1;
    });

    return { highGapCount, refreshIssueCount };
  }, [sortedRecords]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setOptionalQueryParam(params, "q", accountFilter.trim());
    setOptionalQueryParam(params, "platform", platformFilter === "all" ? "" : platformFilter);
    setOptionalQueryParam(params, "project", projectFilter === "all" ? "" : projectFilter);
    setOptionalQueryParam(params, "from", dateFromFilter);
    setOptionalQueryParam(params, "to", dateToFilter);
    const queryString = params.toString();
    const nextHref = queryString ? `${pathname}?${queryString}` : pathname;
    if (`${window.location.pathname}${window.location.search}` !== nextHref) {
      router.replace(nextHref, { scroll: false });
    }
  }, [accountFilter, dateFromFilter, dateToFilter, pathname, platformFilter, projectFilter, router]);

  useEffect(() => {
    if (!trackedRefreshJob || !["queued", "running"].includes(trackedRefreshJob.status)) return;
    if (!activeRefreshJobId) setActiveRefreshJobId(trackedRefreshJob.id);
    if (!busy) setBusy("refresh-all");
  }, [activeRefreshJobId, busy, trackedRefreshJob]);

  useEffect(() => {
    if (!trackedRefreshJob || trackedRefreshJob.dataChange?.resource !== "gross-margin") return;
    const dataRevision = trackedRefreshJob.dataRevision || 0;
    if (dataRevision <= (syncedRefreshDataRevisionsRef.current.get(trackedRefreshJob.id) || 0)) return;
    syncedRefreshDataRevisionsRef.current.set(trackedRefreshJob.id, dataRevision);
    void refreshGrossMarginLibraryCache()
      .then(setLibrary)
      .catch((error) => notify({ tone: "error", message: error instanceof Error ? error.message : "刷新进度同步失败" }));
  }, [notify, trackedRefreshJob]);

  async function handleRefreshAll() {
    const targetRecordIds = sortedRecords.map((record) => record.id);
    if (!targetRecordIds.length) {
      notify({ tone: "warning", message: "当前筛选下没有可刷新的监控记录" });
      return;
    }
    setBusy("refresh-all");
    try {
      const job = await startTask({
        kind: "gross-margin-refresh",
        href: "/gross-margin/monitor",
        input: { recordIds: targetRecordIds }
      });
      setActiveRefreshJobId(job.id);
      notify({ tone: "info", message: "批量刷新已加入任务中心，可离开页面继续处理" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "刷新全部失败" });
      setBusy("");
    }
  }

  useEffect(() => {
    if (!activeRefreshJobId) return;
    const job = [...activeJobs, ...recentJobs].find((item) => item.id === activeRefreshJobId);
    if (!job || job.status === "queued" || job.status === "running") return;
    setActiveRefreshJobId("");
    setBusy("");
    if (job.status === "completed") {
      void refreshGrossMarginLibraryCache()
        .then(setLibrary)
        .catch((error) => notify({ tone: "error", message: error instanceof Error ? error.message : "刷新结果读取失败" }));
      return;
    }
    notify({ tone: "error", message: job.error || job.message || "批量刷新未完成" });
  }, [activeJobs, activeRefreshJobId, notify, recentJobs]);

  async function handleRefreshOne(recordId: string) {
    setBusy(`refresh-${recordId}`);
    try {
      const result = await refreshGrossMarginMonitorRecord(recordId);
      setLibrary(result.library);
      notify({
        tone: result.record.status === "failed" || result.record.status === "partial" ? "warning" : "success",
        message:
          result.record.status === "failed"
            ? "该记录刷新失败，请查看行内提示"
            : result.record.status === "partial"
              ? "监控记录已部分刷新，请查看行内提示"
              : "监控记录已刷新"
      });
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
      <header className="page-header gross-monitor-page-header"><div className="page-title-group"><span className="page-title-eyebrow">ANALYTICS / 02</span><div className="page-title-copy"><h1>关注每一次关键变化</h1><p className="subtle">对比目标与当前表现，定位值得关注的变化。</p></div></div></header>
      <div className="gross-monitor-topbar">
        <div className="page-header-meta gross-monitor-overview" aria-label="监控概览">
          <span className="stat-pill gross-monitor-stat">
            <strong>{sortedRecords.length}</strong>
            {hasActiveFilters ? `/ ${records.length} 条记录` : "条记录"}
          </span>
          <span className={`stat-pill gross-monitor-stat danger ${overview.highGapCount ? "" : "quiet"}`}>
            <AlertTriangle aria-hidden="true" size={12} />
            <strong>{overview.highGapCount}</strong>
            高缺口
          </span>
          <span className={`stat-pill gross-monitor-stat warning ${overview.refreshIssueCount ? "" : "quiet"}`}>
            <RefreshCw aria-hidden="true" size={12} />
            <strong>{overview.refreshIssueCount}</strong>
            刷新异常
          </span>
        </div>
        <div className="gross-monitor-toolbar">
          <div className="gross-monitor-inline-filters" role="group" aria-label="监控筛选">
            <span className="gross-monitor-search-field">
              <Search aria-hidden="true" size={14} />
              <input
                aria-label="按账号、标题或链接筛选"
                autoComplete="off"
                className="gross-monitor-inline-input"
                id="gross-monitor-account-filter"
                name="grossMonitorAccountFilter"
                onChange={(event) => setAccountFilter(event.target.value)}
                placeholder="账号 / 标题 / 链接"
                type="search"
                value={accountFilter}
              />
            </span>
            <span className="gross-monitor-filter-group">
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
            </span>
            <span className="gross-monitor-date-range">
              <CalendarRange aria-hidden="true" size={14} />
              <input
                aria-label="开始日期"
                autoComplete="off"
                className="gross-monitor-inline-date"
                id="gross-monitor-date-from"
                name="grossMonitorDateFrom"
                onChange={(event) => setDateFromFilter(event.target.value)}
                type="date"
                value={dateFromFilter}
              />
              <span className="gross-monitor-inline-date-separator" aria-hidden="true">
                至
              </span>
              <input
                aria-label="结束日期"
                autoComplete="off"
                className="gross-monitor-inline-date"
                id="gross-monitor-date-to"
                name="grossMonitorDateTo"
                onChange={(event) => setDateToFilter(event.target.value)}
                type="date"
                value={dateToFilter}
              />
            </span>
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
          <div className="button-row gross-monitor-primary-action">
            <button className="btn primary compact" disabled={busy === "refresh-all" || !sortedRecords.length} onClick={() => void handleRefreshAll()} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              {busy === "refresh-all" ? "刷新中" : hasActiveFilters ? "刷新当前" : "刷新全部"}
            </button>
          </div>
        </div>
      </div>

      <div className="gross-monitor-workspace"><section className="gross-monitor-board">
        {loading ? (
          <div className="gross-monitor-empty">
            <RefreshCw aria-hidden="true" size={18} />
            <p>正在读取监控记录。</p>
          </div>
        ) : hasActiveFilters && !sortedRecords.length ? (
          <div className="gross-monitor-empty">
            <p>没有符合当前筛选条件的监控记录，请调整账号、链接、平台、项目或日期范围。</p>
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
        ) : (
          <div className="gross-monitor-empty">
            <p>还没有监控记录。先在数据维护里导出文案，系统会自动保存维护目标。</p>
          </div>
        )}
      </section><aside className="gross-monitor-context" aria-label="监控说明"><span className="page-title-eyebrow">CONTEXT / 当前工作</span><h2>关注偏离目标的项目</h2><p>目标、当前值与差值放在同一条记录里，便于发现需要处理的变化。</p><div className="gross-monitor-context-stat"><strong>{overview.highGapCount}</strong><span>条高缺口记录</span></div><div className="gross-monitor-context-stat"><strong>{overview.refreshIssueCount}</strong><span>条刷新异常</span></div><Link className="btn" href="/gross-margin">返回数据维护</Link></aside></div>
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

function GrossMarginMonitorFallback() {
  return (
    <div className="page gross-margin-page gross-monitor-page">
      <section className="gross-monitor-board">
        <div className="gross-monitor-empty">
          <RefreshCw aria-hidden="true" size={18} />
          <p>正在读取监控记录。</p>
        </div>
      </section>
    </div>
  );
}

function handleHorizontalWheel(event: WheelEvent<HTMLDivElement>) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const target = event.currentTarget;
  if (target.scrollWidth <= target.clientWidth) return;
  target.scrollLeft += event.deltaY;
  event.preventDefault();
}

function parsePlatformFilter(value: string | null): "all" | GrossMarginMonitorRecord["platform"] {
  return value === "bilibili" || value === "douyin" ? value : "all";
}

function parseDateFilter(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function setOptionalQueryParam(params: URLSearchParams, key: string, value: string) {
  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}

function shouldFocusInlineEdit() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
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
  const dailyPlayGain = getDailyPlayGainSummary(record);
  const visibleWarnings = record.warnings.filter((warning) => !isBlueLinkFetchWarning(warning));
  const [editingPlay, setEditingPlay] = useState(false);
  const playMetric = metrics.find((metric) => metric.service === "play");
  const canEditPlayCurrent = record.platform === "douyin";
  const [playTargetDraft, setPlayTargetDraft] = useState(playMetric ? formatEditableMetricValue(playMetric.target, record.platform) : "");
  const [playCurrentDraft, setPlayCurrentDraft] = useState(
    playMetric && typeof playMetric.current === "number" ? formatEditableMetricValue(playMetric.current, record.platform) : ""
  );
  const [playEditError, setPlayEditError] = useState("");
  const playCurrentInputRef = useRef<HTMLInputElement>(null);
  const playTargetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingPlay && playMetric) {
      setPlayTargetDraft(formatEditableMetricValue(playMetric.target, record.platform));
      setPlayCurrentDraft(
        typeof playMetric.current === "number" ? formatEditableMetricValue(playMetric.current, record.platform) : ""
      );
      setPlayEditError("");
    }
  }, [editingPlay, playMetric, record.platform]);

  useEffect(() => {
    if (!editingPlay || !shouldFocusInlineEdit()) return;
    const input = canEditPlayCurrent ? playCurrentInputRef.current : playTargetInputRef.current;
    input?.focus();
    input?.select();
  }, [canEditPlayCurrent, editingPlay]);

  async function submitPlayEdit() {
    if (!playMetric) return;
    setPlayEditError("");
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

  async function handleSubmitPlayEdit() {
    try {
      await submitPlayEdit();
    } catch (error) {
      setPlayEditError(error instanceof Error ? error.message : "播放量保存失败");
    }
  }

  function resetPlayEdit(metric: GrossMarginMonitorMetric) {
    setPlayTargetDraft(formatEditableMetricValue(metric.target, record.platform));
    setPlayCurrentDraft(typeof metric.current === "number" ? formatEditableMetricValue(metric.current, record.platform) : "");
    setPlayEditError("");
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
          aria-label={`整体缺口 ${formatOverallGap(overallGap, record.status)}，${getOverallGapLabel(overallGap, overallGapTone, record.status)}`}
          role="img"
          style={{ "--risk-fill": `${overallGap.percent * 100}%` } as CSSProperties}
        >
          <strong>{formatOverallGap(overallGap, record.status)}</strong>
          <small>整体缺口</small>
        </span>
        <span className="gross-monitor-risk-meta">
          <span className="gross-monitor-risk-status-line">
            <em className={`gross-monitor-gap-level ${overallGapTone}`}>
              {overallGapTone === "danger" || overallGapTone === "warning" ? <AlertTriangle aria-hidden="true" size={11} /> : null}
              {getOverallGapLabel(overallGap, overallGapTone, record.status)}
            </em>
            <em className={`gross-monitor-refresh-state ${record.status}`}>
              {renderStatusIcon(record.status)}
              {formatStatus(record.status)}
            </em>
            <span className="gross-monitor-refresh-time">
              <CalendarClock aria-hidden="true" size={12} />
              {formatDateTime(record.lastRefreshedAt || record.updatedAt)}
            </span>
          </span>
          <span className="gross-monitor-risk-insights">
            {record.status === "completed" ? (
              <em className={`gross-monitor-refresh-summary ${changedMetricCount ? "changed" : "stable"}`}>
                {changedMetricCount ? `${changedMetricCount} 项变化` : "本次无变化"}
              </em>
            ) : null}
            {dailyPlayGain ? (
              <em
                className={`gross-monitor-daily-pill ${dailyPlayGain.state}`}
                title={formatDailyPlayGainTitle(dailyPlayGain, record.platform)}
              >
                <Gauge aria-hidden="true" size={12} />
                当天 {formatDailyPlayGainSummary(dailyPlayGain, record.platform)}
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
          const hasVisibleDelta = refreshDelta !== null && refreshDelta !== 0;
          const deltaTone = refreshDelta === null ? "" : refreshDelta > 0 ? "positive" : refreshDelta < 0 ? "negative" : "neutral";
          const deltaLabel = hasVisibleDelta ? `，本次刷新 ${formatMetricRefreshDelta(refreshDelta, metric.service, record.platform)}` : "";

          return (
            <span
              aria-label={`${getMetricLabel(metric)}，目标 ${formatMetric(metric.target, record.platform)}，当前 ${formatMetricCurrentValue(metric, record.platform)}，缺口比例 ${formatMetricPercent(metric)}${deltaLabel}`}
              className={`gross-monitor-metric-cell ${metric.highRisk ? "danger" : ""}`}
              key={metric.service}
              title={`${getMetricLabel(metric)} | 目标 ${formatMetric(metric.target, record.platform)} | 当前 ${formatMetricCurrentValue(metric, record.platform)} | ${formatMetricPercent(metric)}${hasVisibleDelta ? ` | 本次刷新 ${formatMetricRefreshDelta(refreshDelta, metric.service, record.platform)}` : ""}`}
            >
              <span className="gross-monitor-metric-cell-head">
                {renderMetricIcon(metric.service)}
                <strong>{getMetricLabel(metric)}</strong>
                <b className={metric.highRisk ? "risk-text" : ""}>{formatMetricPercent(metric)}</b>
              </span>
              <span className="gross-monitor-metric-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${getMetricProgress(metric) / 100})` }} />
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
                              autoComplete="off"
                              className="gross-monitor-play-input"
                              disabled={busy === `play-current-${record.id}` || busy === `play-target-${record.id}`}
                              name={`playCurrent-${record.id}`}
                              ref={playCurrentInputRef}
                              onBlur={(event) => {
                                if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
                                void handleSubmitPlayEdit();
                              }}
                              onChange={(event) => {
                                setPlayCurrentDraft(event.target.value);
                                setPlayEditError("");
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleSubmitPlayEdit();
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  resetPlayEdit(metric);
                                }
                              }}
                              placeholder="当前…"
                              type="text"
                              value={playCurrentDraft}
                            />
                          ) : null}
                          <input
                            aria-label="播放目标"
                            autoComplete="off"
                            className="gross-monitor-play-input"
                            disabled={busy === `play-current-${record.id}` || busy === `play-target-${record.id}`}
                            name={`playTarget-${record.id}`}
                            ref={playTargetInputRef}
                            onBlur={(event) => {
                              if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
                              void handleSubmitPlayEdit();
                            }}
                            onChange={(event) => {
                              setPlayTargetDraft(event.target.value);
                              setPlayEditError("");
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleSubmitPlayEdit();
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                resetPlayEdit(metric);
                              }
                            }}
                            placeholder="目标…"
                            type="text"
                            value={playTargetDraft}
                          />
                          {playEditError ? (
                            <span className="gross-monitor-play-error" role="alert">
                              {playEditError}
                            </span>
                          ) : null}
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
                {hasVisibleDelta ? (
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
    .filter((metric) => metric.difference > 0)
    .map((metric) => `${getMetricLabel(metric)}：${formatGapMetric(metric.difference, metric.service, record.platform)}`)
    .filter(Boolean);
  const dailyPlayGain = getDailyPlayGainSummary(record);
  const dailyGainLines =
    dailyPlayGain?.state === "ready"
      ? [`当天新增：${formatDailyPlayGainSummary(dailyPlayGain, record.platform)}`]
      : [];

  return ["目前差额：", ...lines, ...dailyGainLines].join("\n");
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

type DailyPlayGainSummary =
  | {
      state: "ready";
      delta: number;
      sampleCount: number;
      firstValue: number;
      latestValue: number;
      firstCapturedAt: string;
      latestCapturedAt: string;
    }
  | {
      state: "pending";
      sampleCount: number;
      reason: "empty" | "single";
    };

function getDailyPlayGainSummary(record: GrossMarginMonitorRecord): DailyPlayGainSummary | null {
  if (!record.metrics.some((metric) => metric.service === "play")) return null;
  const samples = normalizePlaySamplesForDisplay(record);
  if (!samples.length) return { state: "pending", sampleCount: 0, reason: "empty" };
  const latest = samples[samples.length - 1];
  const sameDaySamples = samples.filter((sample) => isSameLocalDay(sample.capturedAt, latest.capturedAt));
  if (sameDaySamples.length < 2) return { state: "pending", sampleCount: sameDaySamples.length, reason: "single" };

  const first = sameDaySamples[0];
  const latestSameDay = sameDaySamples[sameDaySamples.length - 1];
  const delta = latestSameDay.value - first.value;
  return {
    state: "ready",
    delta,
    sampleCount: sameDaySamples.length,
    firstValue: first.value,
    latestValue: latestSameDay.value,
    firstCapturedAt: first.capturedAt,
    latestCapturedAt: latestSameDay.capturedAt
  };
}

function isSameLocalDay(left: string, right: string) {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(+leftDate) || Number.isNaN(+rightDate)) return false;
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function normalizePlaySamplesForDisplay(record: GrossMarginMonitorRecord) {
  return (record.playSamples || [])
    .map((sample) => ({
      value: Number(sample.value),
      capturedAt: sample.capturedAt
    }))
    .filter((sample) => Number.isFinite(sample.value) && Number.isFinite(+new Date(sample.capturedAt)))
    .sort((left, right) => +new Date(left.capturedAt) - +new Date(right.capturedAt));
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
  if (status === "partial") return "warning";
  if (percent >= 0.75) return "danger";
  if (percent >= 0.45) return "warning";
  if (percent >= 0.0005) return "calm";
  return "neutral";
}

function getOverallGapLabel(
  gap: { percent: number; target: number },
  tone: ReturnType<typeof getOverallGapTone>,
  status: GrossMarginMonitorRecord["status"]
) {
  if (!gap.target) return status === "pending" ? "等待首刷" : "暂无目标";
  if (status === "failed") return "刷新失败";
  if (status === "partial") return "数据不完整";
  if (tone === "danger") return "严重缺口";
  if (tone === "warning") return "较大缺口";
  if (tone === "calm") return "轻微缺口";
  if (gap.percent > 0) return "基本达标";
  return "已达目标";
}

function formatPlatform(platform: GrossMarginMonitorRecord["platform"]) {
  return platform === "bilibili" ? "B站" : "抖音";
}

function formatStatus(status: GrossMarginMonitorRecord["status"]) {
  if (status === "completed") return "已刷新";
  if (status === "partial") return "部分刷新";
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
  if (status === "partial") return <AlertTriangle aria-hidden="true" size={13} />;
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

function formatDailyPlayGainSummary(summary: DailyPlayGainSummary, platform: GrossMarginMonitorRecord["platform"]) {
  if (summary.state === "pending") {
    return summary.reason === "single" ? "待二次采样" : "待采样";
  }
  return formatMetricRefreshDelta(summary.delta, "play", platform);
}

function formatDailyPlayGainTitle(summary: DailyPlayGainSummary, platform: GrossMarginMonitorRecord["platform"]) {
  if (summary.state === "pending") {
    return summary.sampleCount ? "当天需要至少两次播放量采样后计算实际新增。" : "刷新或手动填写当前播放量后开始积累播放采样。";
  }

  return `按最新采样当天内第一条与最新一条计算：${formatMetric(summary.firstValue, platform)} 到 ${formatMetric(summary.latestValue, platform)}，${summary.sampleCount} 次采样。`;
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
