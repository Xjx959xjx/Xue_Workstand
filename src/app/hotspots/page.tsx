"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Eye,
  Flame,
  Gamepad2,
  Loader2,
  Newspaper,
  RadioTower,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trophy,
  Users,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ModalBackdrop } from "@/components/ModalBackdrop";
import { getHotspotRadar, refreshHotspotRadar } from "@/lib/client";
import type {
  HotspotEvent,
  HotspotMonitorType,
  HotspotRadarResponse,
  HotspotSignal,
  HotspotSourceType,
  HotspotStatus
} from "@/lib/types";

type PriorityFilter = "all" | HotspotStatus;
type DetailAction = "verified" | "watch" | "brief" | "ignore";

type MonitorOption = {
  value: HotspotMonitorType;
  label: string;
  description: string;
  objectLabel: string;
  icon: LucideIcon;
};

type StatusCounts = Record<HotspotStatus, number>;

type MonitorStat = StatusCounts & {
  total: number;
  topScore: number;
};

type SubjectGroup = {
  subject: string;
  hotspots: HotspotEvent[];
  counts: StatusCounts;
  topScore: number;
  sourceCount: number;
};

type DistributionStyle = CSSProperties & {
  "--risk-size": string;
  "--ready-size": string;
  "--watch-size": string;
};

const monitorOptions: MonitorOption[] = [
  {
    value: "esports",
    label: "赛事电竞",
    description: "赛程、赛果与战队动态",
    objectLabel: "游戏名",
    icon: Trophy
  },
  {
    value: "official",
    label: "官方官宣",
    description: "版本、新游与官方节点",
    objectLabel: "游戏 / 产品",
    icon: RadioTower
  },
  {
    value: "operations",
    label: "突发运营",
    description: "事故、争议与官方回应",
    objectLabel: "游戏名",
    icon: ShieldAlert
  },
  {
    value: "breakout",
    label: "娱乐破圈",
    description: "跨平台扩散与内容机会",
    objectLabel: "IP / 话题",
    icon: Flame
  }
];

const statusMeta: Record<HotspotStatus, { label: string; shortLabel: string; action: string; icon: LucideIcon }> = {
  risk: { label: "P0 立即核验", shortLabel: "P0", action: "先核验风险与影响范围", icon: ShieldAlert },
  ready: { label: "P1 可跟进", shortLabel: "P1", action: "进入选题判断", icon: CheckCircle2 },
  watch: { label: "持续观察", shortLabel: "观察", action: "继续看增速和扩散", icon: Eye }
};

const priorityOptions: Array<{ value: PriorityFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "risk", label: "P0" },
  { value: "ready", label: "P1" },
  { value: "watch", label: "观察" }
];

const sourceMeta: Record<HotspotSourceType, { label: string; icon: LucideIcon }> = {
  official: { label: "官方", icon: RadioTower },
  news: { label: "媒体", icon: Newspaper },
  video: { label: "视频", icon: Sparkles },
  community: { label: "社区", icon: Users },
  social: { label: "社交", icon: Flame }
};

const detailActionLabels: Record<DetailAction, string> = {
  verified: "标记已核验",
  watch: "继续观察",
  brief: "加入选题",
  ignore: "忽略"
};

const priorityWeight: Record<HotspotStatus, number> = {
  risk: 3,
  ready: 2,
  watch: 1
};

const EMPTY_HOTSPOTS: HotspotEvent[] = [];
const EMPTY_SIGNALS: HotspotSignal[] = [];
const numberFormatter = new Intl.NumberFormat("zh-CN");
const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

export default function HotspotsPage() {
  const [snapshot, setSnapshot] = useState<HotspotRadarResponse | null>(null);
  const [activeMonitor, setActiveMonitor] = useState<HotspotMonitorType>("esports");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [selectedHotspot, setSelectedHotspot] = useState<HotspotEvent | null>(null);
  const [busy, setBusy] = useState<"" | "load" | "refresh">("load");
  const [error, setError] = useState("");
  const [decisions, setDecisions] = useState<Record<string, DetailAction>>({});
  const [detailNotice, setDetailNotice] = useState("");
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  const loadSnapshot = useCallback(async () => {
    setBusy((current) => current || "load");
    setError("");
    try {
      setSnapshot(await getHotspotRadar());
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取热点雷达失败");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const hotspots = snapshot?.hotspots || EMPTY_HOTSPOTS;
  const signals = snapshot?.signals || EMPTY_SIGNALS;
  const signalsByHotspot = useMemo(() => buildSignalsByHotspot(hotspots, signals), [hotspots, signals]);
  const monitorStats = useMemo(() => buildMonitorStats(hotspots), [hotspots]);
  const subjectGroups = useMemo(
    () => buildSubjectGroups(hotspots, activeMonitor, signalsByHotspot),
    [activeMonitor, hotspots, signalsByHotspot]
  );

  useEffect(() => {
    if (subjectGroups.some((group) => group.subject === selectedSubject)) return;
    setSelectedSubject(subjectGroups[0]?.subject || "");
  }, [selectedSubject, subjectGroups]);

  const activeOption = getMonitorOption(activeMonitor);
  const activeGroup = subjectGroups.find((group) => group.subject === selectedSubject) || subjectGroups[0];
  const visibleHotspots = (activeGroup?.hotspots || []).filter(
    (hotspot) => priorityFilter === "all" || hotspot.status === priorityFilter
  );
  const selectedSignals = selectedHotspot
    ? (signalsByHotspot.get(selectedHotspot.id) || []).slice().sort(compareSignalTimeDesc)
    : [];
  const completedSources = snapshot?.summary.completedSourceCount ?? 0;
  const sourceCount = snapshot?.summary.sourceCount ?? 0;
  const failedSources = snapshot?.summary.failedSourceCount ?? 0;
  const hasSnapshot = Boolean(snapshot?.generatedAt);
  const lastUpdated = snapshot?.generatedAt ? formatDateTime(snapshot.generatedAt) : "未刷新";
  const sourceStatusLabel = hasSnapshot ? `${completedSources}/${sourceCount || "—"} 来源在线` : "尚无热点快照";
  const sourceStatusDetail = hasSnapshot
    ? failedSources ? `${failedSources} 个来源异常` : `更新于 ${lastUpdated}`
    : "首次使用请刷新信号";
  const initialLoading = busy === "load" && !snapshot;

  async function handleRefresh() {
    if (busy) return;
    setBusy("refresh");
    setError("");
    try {
      setSnapshot(await refreshHotspotRadar());
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新热点雷达失败");
    } finally {
      setBusy("");
    }
  }

  function handleMonitorChange(value: HotspotMonitorType) {
    setActiveMonitor(value);
    setSelectedSubject("");
    setPriorityFilter("all");
  }

  function handleDetailAction(action: DetailAction) {
    if (!selectedHotspot) return;
    setDecisions((current) => ({ ...current, [selectedHotspot.id]: action }));
    setDetailNotice(`本次会话已记录：${detailActionLabels[action]}`);
  }

  return (
    <div className="page hotspots-page workbench-frame-page">
      <header className="hotspots-header">
        <div className="hotspots-title-block">
          <span className="hotspots-title-icon" aria-hidden="true"><BarChart3 size={20} /></span>
          <div>
            <h1>游戏热点雷达</h1>
            <p>左侧选游戏，右侧直接看事件摘要和来源延伸</p>
          </div>
        </div>

        <div className="hotspots-header-health" aria-label="来源健康">
          <span className={failedSources ? "has-error" : hasSnapshot ? "is-healthy" : "is-idle"} aria-hidden="true" />
          <div>
            <strong>{sourceStatusLabel}</strong>
            <em>{sourceStatusDetail}</em>
          </div>
        </div>

        <button className="btn primary hotspots-refresh" disabled={Boolean(busy)} onClick={handleRefresh} type="button">
          {busy ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <RefreshCw aria-hidden="true" size={16} />}
          {busy === "refresh" ? "刷新中" : busy === "load" ? "读取中" : "刷新信号"}
        </button>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}

      <section className="hotspots-monitor-strip" aria-label="监测类型">
        {monitorOptions.map((option) => {
          const Icon = option.icon;
          const stat = monitorStats[option.value];
          const active = activeMonitor === option.value;
          return (
            <button
              aria-pressed={active}
              className={`hotspots-monitor-option monitor-${option.value} ${active ? "active" : ""}`}
              key={option.value}
              onClick={() => handleMonitorChange(option.value)}
              type="button"
            >
              <span className="hotspots-monitor-icon" aria-hidden="true"><Icon size={18} /></span>
              <span className="hotspots-monitor-copy">
                <strong>{option.label}</strong>
                <em>{option.description}</em>
              </span>
              <span className="hotspots-monitor-count">{numberFormatter.format(stat.total)}</span>
              <StatusDistribution counts={stat} />
              <span className="hotspots-monitor-summary">
                <b>{stat.risk ? `${stat.risk} 个 P0` : "无 P0"}</b>
                <em>{stat.ready} 个可跟进</em>
              </span>
            </button>
          );
        })}
      </section>

      <main className="hotspots-browser" aria-busy={initialLoading}>
        <aside className="hotspots-subject-pane" aria-label={`${activeOption.label}${activeOption.objectLabel}列表`}>
          <div className="hotspots-subject-head">
            <div>
              <span>{activeOption.label}</span>
              <h2>{activeOption.objectLabel}</h2>
            </div>
            <strong>{subjectGroups.length}</strong>
          </div>

          <div className="hotspots-subject-list">
            {initialLoading ? <SubjectLoading /> : null}
            {!initialLoading && !subjectGroups.length ? (
              <div className="hotspots-subject-empty">当前类型暂无对象</div>
            ) : null}
            {subjectGroups.map((group) => {
              const active = group.subject === activeGroup?.subject;
              return (
                <button
                  aria-pressed={active}
                  className={active ? "active" : ""}
                  key={group.subject}
                  onClick={() => setSelectedSubject(group.subject)}
                  type="button"
                >
                  <span className={`hotspots-subject-avatar monitor-${activeMonitor}`} aria-hidden="true">
                    {getSubjectInitial(group.subject)}
                  </span>
                  <span className="hotspots-subject-copy">
                    <strong>{group.subject}</strong>
                    <em>{group.hotspots.length} 个事件 · {group.sourceCount} 个来源</em>
                    <span className="hotspots-subject-meter"><i style={{ width: `${group.topScore}%` }} /></span>
                  </span>
                  <span className={`hotspots-subject-priority priority-${getGroupStatus(group)}`}>
                    {statusMeta[getGroupStatus(group)].shortLabel}
                  </span>
                  <ChevronRight aria-hidden="true" size={15} />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="hotspots-event-pane" aria-label="事件列表">
          {activeGroup ? (
            <>
              <div className="hotspots-event-overview">
                <div className="hotspots-event-heading">
                  <span className={`hotspots-event-heading-icon monitor-${activeMonitor}`} aria-hidden="true">
                    <Gamepad2 size={19} />
                  </span>
                  <div>
                    <span>{activeOption.label} / {activeOption.objectLabel}</span>
                    <h2>{activeGroup.subject}</h2>
                    <p>{activeGroup.hotspots.length} 个事件摘要，点开看相同事件 / 延伸来源</p>
                  </div>
                </div>

                <div className="hotspots-event-pulse" aria-label="事件优先级分布">
                  <div>
                    <span>当前最高热度</span>
                    <strong>{activeGroup.topScore}</strong>
                  </div>
                  <StatusDistribution counts={activeGroup.counts} expanded />
                </div>
              </div>

              <div className="hotspots-event-toolbar">
                <div className="hotspots-priority-filter" role="group" aria-label="优先级筛选">
                  {priorityOptions.map((option) => (
                    <button
                      aria-pressed={priorityFilter === option.value}
                      className={priorityFilter === option.value ? "active" : ""}
                      key={option.value}
                      onClick={() => setPriorityFilter(option.value)}
                      type="button"
                    >
                      {option.label}
                      {option.value === "all" ? activeGroup.hotspots.length : activeGroup.counts[option.value]}
                    </button>
                  ))}
                </div>
                <span>按优先级、热度和来源数排序，点击摘要查看详情</span>
              </div>

              <div className="hotspots-event-table">
                <div className="hotspots-event-list">
                  {visibleHotspots.map((hotspot) => (
                    <EventRow
                      decision={decisions[hotspot.id]}
                      hotspot={hotspot}
                      key={hotspot.id}
                      signals={signalsByHotspot.get(hotspot.id) || []}
                      onOpen={(trigger) => {
                        setSelectedHotspot(hotspot);
                        setDetailNotice("");
                        detailTriggerRef.current = trigger;
                      }}
                    />
                  ))}
                  {!visibleHotspots.length ? (
                    <div className="hotspots-event-empty">
                      <Eye aria-hidden="true" size={20} />
                      <strong>当前优先级下暂无事件</strong>
                      <span>切换到“全部”查看这个对象的完整事件。</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="hotspots-browser-empty">
              <Trophy aria-hidden="true" size={24} />
              <strong>{initialLoading ? "正在读取热点" : `${activeOption.label}暂无可展示事件`}</strong>
              <span>{initialLoading ? "正在整理对象和事件层级。" : "刷新信号后会按对象自动归组。"}</span>
            </div>
          )}
        </section>
      </main>

      <HotspotDetailModal
        decision={selectedHotspot ? decisions[selectedHotspot.id] : undefined}
        hotspot={selectedHotspot}
        notice={detailNotice}
        signals={selectedSignals}
        triggerRef={detailTriggerRef}
        onAction={handleDetailAction}
        onClose={() => setSelectedHotspot(null)}
      />
    </div>
  );
}

function StatusDistribution({ counts, expanded = false }: { counts: StatusCounts; expanded?: boolean }) {
  const total = Math.max(1, counts.risk + counts.ready + counts.watch);
  const style: DistributionStyle = {
    "--risk-size": `${counts.risk / total * 100}%`,
    "--ready-size": `${counts.ready / total * 100}%`,
    "--watch-size": `${counts.watch / total * 100}%`
  };

  return (
    <div className={`hotspots-status-distribution ${expanded ? "expanded" : ""}`}>
      <span className="hotspots-status-track" aria-hidden="true" style={style}>
        {counts.risk ? <i className="risk" /> : null}
        {counts.ready ? <i className="ready" /> : null}
        {counts.watch ? <i className="watch" /> : null}
      </span>
      {expanded ? (
        <span className="hotspots-status-legend">
          <em className="risk">P0 {counts.risk}</em>
          <em className="ready">P1 {counts.ready}</em>
          <em className="watch">观察 {counts.watch}</em>
        </span>
      ) : null}
    </div>
  );
}

function EventRow({
  hotspot,
  signals,
  decision,
  onOpen
}: {
  hotspot: HotspotEvent;
  signals: HotspotSignal[];
  decision?: DetailAction;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const StatusIcon = statusMeta[hotspot.status].icon;
  const previewSignals = signals.slice(0, 2);
  const sourceCount = signals.length || hotspot.sources;

  return (
    <button
      className={`hotspots-event-row priority-${hotspot.status} ${decision ? "has-decision" : ""}`}
      aria-label={`查看${hotspot.displayInfo.headline}的来源详情`}
      onClick={(event) => onOpen(event.currentTarget)}
      type="button"
    >
      <span className="hotspots-event-card-head">
        <span className={`hotspots-event-status-mark priority-${hotspot.status}`} aria-hidden="true"><StatusIcon size={14} /></span>
        <span className="hotspots-event-labels">
          <b>{hotspot.priorityLabel}</b>
          <em>{hotspot.monitorLabel}</em>
        </span>
        <span className="hotspots-event-time">
          <Clock3 aria-hidden="true" size={13} />
          <strong>{hotspot.displayInfo.timeLabel}</strong>
        </span>
      </span>

      <span className="hotspots-event-summary">
        <strong>{hotspot.displayInfo.headline}</strong>
        <em>{hotspot.summary}</em>
      </span>

      <span className="hotspots-event-meta">
        <span><RadioTower aria-hidden="true" size={13} />{sourceCount} 条来源</span>
        <span><BarChart3 aria-hidden="true" size={13} />热度 {hotspot.score}</span>
        <span>{hotspot.displayInfo.statusLine}</span>
      </span>

      <span className="hotspots-event-source-preview">
        {previewSignals.length ? previewSignals.map((signal) => (
          <i key={signal.id}>{signal.sourceName}：{signal.title}</i>
        )) : <i>暂无原始来源，刷新后补齐证据链</i>}
      </span>

      <span className="hotspots-event-open" aria-hidden="true">
        {decision ? <CheckCircle2 size={15} /> : <ArrowUpRight size={15} />}
      </span>
    </button>
  );
}

function HotspotDetailModal({
  hotspot,
  signals,
  decision,
  notice,
  triggerRef,
  onClose,
  onAction
}: {
  hotspot: HotspotEvent | null;
  signals: HotspotSignal[];
  decision?: DetailAction;
  notice: string;
  triggerRef: { current: HTMLElement | null };
  onClose: () => void;
  onAction: (action: DetailAction) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hotspot) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [hotspot, triggerRef]);

  if (!hotspot) return null;

  const StatusIcon = statusMeta[hotspot.status].icon;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <ModalBackdrop closeLabel="关闭热点详情" onClose={onClose} onKeyDown={handleKeyDown}>
      <div
        aria-labelledby="hotspot-detail-title"
        aria-modal="true"
        className={`modal-panel hotspots-detail-modal priority-${hotspot.status}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="hotspots-detail-head">
          <div>
            <span>{hotspot.monitorLabel} / {hotspot.displayInfo.subject}</span>
            <h2 id="hotspot-detail-title">{hotspot.displayInfo.headline}</h2>
          </div>
          <button aria-label="关闭热点详情" className="btn icon-btn" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="hotspots-detail-body">
          <section className="hotspots-detail-brief">
            <div>
              <span className={`hotspots-detail-priority priority-${hotspot.status}`}>
                <StatusIcon aria-hidden="true" size={14} />
                {statusMeta[hotspot.status].label}
              </span>
              <strong>{hotspot.displayInfo.primaryAction || statusMeta[hotspot.status].action}</strong>
              <p>{hotspot.summary}</p>
              <em>{hotspot.whyNow}</em>
              <em>{hotspot.displayInfo.timeLabel} · {hotspot.displayInfo.sourceLine}</em>
            </div>
            <div className="hotspots-detail-score" aria-label={`信号强度 ${hotspot.score}`}>
              <span>信号强度</span>
              <strong>{hotspot.score}</strong>
              <em>{hotspot.sources} 个来源</em>
              <i><b style={{ width: `${hotspot.score}%` }} /></i>
            </div>
          </section>

          <section className="hotspots-detail-facts" aria-label="关键事实">
            {hotspot.displayInfo.facts.slice(0, 6).map((fact) => <FactItem fact={fact} key={fact} />)}
          </section>

          <section className="hotspots-detail-section hotspots-detail-sources">
            <div className="hotspots-detail-section-title">
              <RadioTower aria-hidden="true" size={16} />
              <h3>相同事件 / 延伸来源</h3>
              <span>{signals.length} 条</span>
            </div>
            <div className="hotspots-detail-source-list">
              {signals.map((signal) => <SignalItem key={signal.id} signal={signal} />)}
              {!signals.length ? <p>暂无关联原始信号，刷新后会补齐来源证据。</p> : null}
            </div>
          </section>

          <div className="hotspots-detail-columns">
            <section className="hotspots-detail-section hotspots-detail-summary">
              <div className="hotspots-detail-section-title">
                <Newspaper aria-hidden="true" size={16} />
                <h3>事件判断</h3>
              </div>
              <p>{hotspot.whyNow}</p>
              {hotspot.evidence.length ? (
                <ul>{hotspot.evidence.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
              ) : null}
            </section>

            <section className="hotspots-detail-section hotspots-detail-angles">
              <div className="hotspots-detail-section-title">
                <Sparkles aria-hidden="true" size={16} />
                <h3>内容切入角度</h3>
              </div>
              <ol>{hotspot.angles.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ol>
            </section>
          </div>

          <div className="hotspots-detail-columns compact">
            <section className="hotspots-detail-section">
              <div className="hotspots-detail-section-title">
                <ShieldAlert aria-hidden="true" size={16} />
                <h3>风险提醒</h3>
              </div>
              <TagList items={hotspot.risks} tone="risk" />
            </section>
            <section className="hotspots-detail-section">
              <div className="hotspots-detail-section-title">
                <Eye aria-hidden="true" size={16} />
                <h3>待核资料</h3>
              </div>
              <TagList items={hotspot.research} />
            </section>
          </div>
        </div>

        <footer className="hotspots-detail-actions">
          <span role="status">{notice || "选择处理动作，仅记录在本次会话"}</span>
          <div>
            {(Object.keys(detailActionLabels) as DetailAction[]).map((action) => (
              <button
                className={`${action === "brief" ? "btn primary" : "btn secondary"} ${decision === action ? "active" : ""}`}
                key={action}
                onClick={() => onAction(action)}
                type="button"
              >
                {detailActionLabels[action]}
              </button>
            ))}
          </div>
        </footer>
      </div>
    </ModalBackdrop>
  );
}

function FactItem({ fact }: { fact: string }) {
  const [label, ...rest] = fact.split("：");
  return (
    <span>
      <em>{rest.length ? label : "事实"}</em>
      <strong>{rest.length ? rest.join("：") : fact}</strong>
    </span>
  );
}

function SignalItem({ signal }: { signal: HotspotSignal }) {
  const meta = sourceMeta[signal.sourceType];
  const Icon = meta.icon;
  const content = (
    <>
      <span className={`hotspots-detail-source-icon source-${signal.sourceType}`} aria-hidden="true"><Icon size={14} /></span>
      <span className="hotspots-detail-source-copy">
        <strong>{signal.title}</strong>
        {signal.summary ? <small>{signal.summary}</small> : null}
        <em>{signal.sourceName} · {meta.label} · {formatDateTime(signal.publishedAt || signal.capturedAt)}</em>
      </span>
      <span className="hotspots-detail-source-heat">
        <b>{signal.heat}</b>
        <em>{signal.trend || "热度"}</em>
      </span>
      {signal.url ? <ExternalLink aria-hidden="true" size={14} /> : null}
    </>
  );

  return signal.url ? (
    <a href={signal.url} rel="noreferrer" target="_blank">{content}</a>
  ) : (
    <div>{content}</div>
  );
}

function TagList({ items, tone = "default" }: { items: string[]; tone?: "default" | "risk" }) {
  const visibleItems = items.filter(Boolean).slice(0, 6);
  if (!visibleItems.length) return <p>暂无明确相关项。</p>;
  return <div className={`hotspots-tag-list tone-${tone}`}>{visibleItems.map((item) => <span key={item}>{item}</span>)}</div>;
}

function SubjectLoading() {
  return (
    <div className="hotspots-subject-loading" aria-label="正在读取对象列表">
      {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
    </div>
  );
}

function buildMonitorStats(hotspots: HotspotEvent[]) {
  const result = monitorOptions.reduce<Record<HotspotMonitorType, MonitorStat>>((stats, option) => {
    stats[option.value] = { total: 0, risk: 0, ready: 0, watch: 0, topScore: 0 };
    return stats;
  }, {} as Record<HotspotMonitorType, MonitorStat>);

  for (const hotspot of hotspots) {
    const stat = result[hotspot.monitorType];
    stat.total += 1;
    stat[hotspot.status] += 1;
    stat.topScore = Math.max(stat.topScore, hotspot.score);
  }

  return result;
}

function buildSubjectGroups(
  hotspots: HotspotEvent[],
  monitorType: HotspotMonitorType,
  signalsByHotspot: Map<string, HotspotSignal[]>
) {
  const groups = new Map<string, HotspotEvent[]>();

  for (const hotspot of hotspots) {
    if (hotspot.monitorType !== monitorType) continue;
    const subject = hotspot.displayInfo.subject.trim() || hotspot.game.trim() || "未识别对象";
    groups.set(subject, [...(groups.get(subject) || []), hotspot]);
  }

  return [...groups.entries()]
    .map<SubjectGroup>(([subject, groupHotspots]) => {
      const sortedHotspots = groupHotspots.slice().sort(compareHotspotPriority);
      const sourceIds = new Set(
        sortedHotspots.flatMap((hotspot) => (signalsByHotspot.get(hotspot.id) || []).map((signal) => signal.sourceId))
      );
      return {
        subject,
        hotspots: sortedHotspots,
        counts: countStatuses(sortedHotspots),
        topScore: Math.max(...sortedHotspots.map((hotspot) => hotspot.score), 0),
        sourceCount: sourceIds.size || Math.max(...sortedHotspots.map((hotspot) => hotspot.sources), 0)
      };
    })
    .sort((left, right) => {
      const statusDifference = priorityWeight[getGroupStatus(right)] - priorityWeight[getGroupStatus(left)];
      return statusDifference || right.topScore - left.topScore || left.subject.localeCompare(right.subject, "zh-CN");
    });
}

function buildSignalsByHotspot(hotspots: HotspotEvent[], signals: HotspotSignal[]) {
  const signalMap = new Map(signals.map((signal) => [signal.id, signal]));
  const result = new Map<string, HotspotSignal[]>();
  for (const hotspot of hotspots) {
    result.set(
      hotspot.id,
      hotspot.signalIds
        .map((signalId) => signalMap.get(signalId))
        .filter((signal): signal is HotspotSignal => Boolean(signal))
    );
  }
  return result;
}

function countStatuses(hotspots: HotspotEvent[]): StatusCounts {
  return hotspots.reduce<StatusCounts>((counts, hotspot) => {
    counts[hotspot.status] += 1;
    return counts;
  }, { risk: 0, ready: 0, watch: 0 });
}

function getMonitorOption(type: HotspotMonitorType) {
  return monitorOptions.find((option) => option.value === type) || monitorOptions[0];
}

function getGroupStatus(group: SubjectGroup): HotspotStatus {
  if (group.counts.risk) return "risk";
  if (group.counts.ready) return "ready";
  return "watch";
}

function getSubjectInitial(subject: string) {
  const compact = subject.replace(/\s+/g, "");
  if (/^[a-z0-9]/i.test(compact)) return compact.slice(0, 2).toUpperCase();
  return Array.from(compact).slice(0, 1).join("") || "—";
}

function compareHotspotPriority(left: HotspotEvent, right: HotspotEvent) {
  return (
    priorityWeight[right.status] - priorityWeight[left.status]
    || right.score - left.score
    || right.sources - left.sources
  );
}

function compareSignalTimeDesc(left: HotspotSignal, right: HotspotSignal) {
  return getSignalTime(right) - getSignalTime(left);
}

function getSignalTime(signal: HotspotSignal) {
  const parsed = Date.parse(signal.publishedAt || signal.capturedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateTime(input: string) {
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? "未知时间" : dateTimeFormatter.format(date);
}
