"use client";

import { Suspense, type CSSProperties, type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Clock3,
  ExternalLink,
  Flame,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap
} from "lucide-react";
import {
  addDouyinHotlistAccount,
  getCachedDouyinHotlist,
  getDouyinHotlist,
  removeDouyinHotlistAccount
} from "@/lib/client";
import { buildDouyinVideoUrl } from "@/lib/platform-links";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ModalBackdrop } from "@/components/ModalBackdrop";
import { useScopedTasks } from "@/components/TaskProvider";
import type {
  DouyinHotlistAccount,
  DouyinHotlistItem,
  DouyinHotlistRefreshAccountResult,
  DouyinHotlistRefreshJobResult,
  DouyinHotlistResponse,
  JobRecord,
  Platform
} from "@/lib/types";

const DEFAULT_WINDOW = "3d";
const REFRESH_LIMIT = 10;
const AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_REFRESH_CHECK_INTERVAL_MS = 60 * 1000;
const AUTO_REFRESH_START_DELAY_MS = AUTO_REFRESH_CHECK_INTERVAL_MS;
const MAX_REFRESH_LOGS = 6;
const MAX_REFRESH_LOG_DETAILS = 6;
const REFRESH_LOG_STORAGE_KEY = "douyin-hotlist-refresh-logs";
const HOTLIST_INITIAL_RENDER_COUNT = 24;
const HOTLIST_RENDER_STEP = 24;

type BusyState = "" | "load" | "add" | `remove:${string}`;
type AccountSelection = "all" | string;
type MetricTone = "views" | "likes" | "comments" | "favorites" | "shares";
type SortMode = "heat" | "likes" | "comments" | "saves" | "recent";
type WindowFilter = "3h" | "6h" | "12h" | "24h" | "3d";
type RefreshLogStatus = "success" | "warning" | "failed" | "skipped";

type RefreshLogEntry = {
  id: string;
  at: string;
  automatic: boolean;
  status: RefreshLogStatus;
  text: string;
  details?: string[];
};

type RefreshHotlistOptions = {
  automatic?: boolean;
};

const sortOptions: { value: SortMode; label: string }[] = [
  { value: "heat", label: "综合热度" },
  { value: "likes", label: "点赞最高" },
  { value: "comments", label: "评论最多" },
  { value: "saves", label: "收藏/转发" },
  { value: "recent", label: "最新发布" }
];

const windowOptions: { value: WindowFilter; label: string; labelText: string }[] = [
  { value: "3h", label: "3h", labelText: "近 3 小时" },
  { value: "6h", label: "6h", labelText: "近 6 小时" },
  { value: "12h", label: "12h", labelText: "近 12 小时" },
  { value: "24h", label: "24h", labelText: "近 24 小时" },
  { value: "3d", label: "3天", labelText: "近 3 天" }
];

const platformLogoSrc: Record<Platform, string> = {
  bilibili: "/platform-logos/bilibili.png",
  douyin: "/platform-logos/douyin.png"
};

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1
});

const scoreFormatter = new Intl.NumberFormat("zh-CN");

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const logTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

export default function DouyinHotlistPage() {
  return (
    <Suspense fallback={<DouyinHotlistFallback />}>
      <DouyinHotlistPageContent />
    </Suspense>
  );
}

function DouyinHotlistPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tasks = useScopedTasks({ href: "/douyin-hotlist", kinds: ["hotlist-refresh"] });
  const initialWindowFilter = parseWindowFilter(searchParams.get("window"));
  const [snapshot, setSnapshot] = useState<DouyinHotlistResponse | null>(() => getCachedDouyinHotlist({ window: initialWindowFilter }));
  const [query, setQuery] = useState("");
  const [accountPlatform, setAccountPlatform] = useState<Platform>("douyin");
  const [selectedAccountId, setSelectedAccountId] = useState<AccountSelection>(() => searchParams.get("account") || "all");
  const [sortMode, setSortMode] = useState<SortMode>(() => parseSortMode(searchParams.get("sort")));
  const [windowFilter, setWindowFilter] = useState<WindowFilter>(() => initialWindowFilter);
  const [busy, setBusy] = useState<BusyState>(() => getCachedDouyinHotlist({ window: initialWindowFilter }) ? "" : "load");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DouyinHotlistAccount | null>(null);
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [refreshLogs, setRefreshLogs] = useState<RefreshLogEntry[]>([]);
  const [refreshLogsReady, setRefreshLogsReady] = useState(false);
  const busyRef = useRef<BusyState>(busy);
  const accountCountRef = useRef(snapshot?.accounts.length ?? 0);
  const lastFullRefreshAttemptAtRef = useRef<string | undefined>(snapshot?.summary.lastFullRefreshAttemptAt);
  const lastAutoRefreshAttemptAtRef = useRef(0);
  const autoRefreshReadyAtRef = useRef(0);
  const activeRefreshJobRef = useRef<JobRecord | null>(null);
  const refreshJobsReadyRef = useRef(false);
  const trackedRefreshJobIdsRef = useRef<Set<string>>(new Set());
  const handledRefreshJobIdsRef = useRef<Set<string>>(new Set());
  const syncedRefreshDataRevisionsRef = useRef<Map<string, number>>(new Map());
  const loadRequestIdRef = useRef(0);
  const refreshHotlistRef = useRef<(options?: RefreshHotlistOptions) => Promise<void>>(async () => {});
  const activeRefreshJob = tasks.activeJobs[0] || null;
  const refreshing = Boolean(activeRefreshJob);

  const appendRefreshLog = useCallback((entry: Omit<RefreshLogEntry, "id" | "at">) => {
    const at = new Date().toISOString();
    setRefreshLogs((current) => [
      {
        ...entry,
        at,
        id: `${at}-${entry.status}-${current.length}`
      },
      ...current
    ].slice(0, MAX_REFRESH_LOGS));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedLogs = parseStoredRefreshLogs(window.localStorage.getItem(REFRESH_LOG_STORAGE_KEY));
    if (storedLogs.length) setRefreshLogs(storedLogs);
    setRefreshLogsReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !refreshLogsReady) return;
    window.localStorage.setItem(REFRESH_LOG_STORAGE_KEY, JSON.stringify(refreshLogs));
  }, [refreshLogs, refreshLogsReady]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    accountCountRef.current = snapshot?.accounts.length ?? 0;
    lastFullRefreshAttemptAtRef.current = snapshot?.summary.lastFullRefreshAttemptAt;
  }, [snapshot?.accounts.length, snapshot?.summary.lastFullRefreshAttemptAt]);

  useEffect(() => {
    activeRefreshJobRef.current = activeRefreshJob;
  }, [activeRefreshJob]);

  const loadHotlist = useCallback(async (options: { force?: boolean } = {}) => {
    const cached = options.force ? null : getCachedDouyinHotlist({ window: windowFilter });
    if (cached) {
      setSnapshot(cached);
      busyRef.current = "";
      setBusy("");
      return;
    }

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    busyRef.current = "load";
    setBusy("load");
    setError("");
    try {
      const next = await getDouyinHotlist({ force: options.force, window: windowFilter });
      if (loadRequestIdRef.current === requestId) setSnapshot(next);
    } catch (err) {
      if (loadRequestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "读取视频热榜失败");
      }
    } finally {
      if (loadRequestIdRef.current === requestId) {
        busyRef.current = "";
        setBusy("");
      }
    }
  }, [windowFilter]);

  useEffect(() => {
    void loadHotlist();
  }, [loadHotlist]);

  useEffect(() => {
    if (!activeRefreshJob || activeRefreshJob.dataChange?.resource !== "douyin-hotlist") return;
    const dataRevision = activeRefreshJob.dataRevision || 0;
    if (dataRevision <= (syncedRefreshDataRevisionsRef.current.get(activeRefreshJob.id) || 0)) return;
    syncedRefreshDataRevisionsRef.current.set(activeRefreshJob.id, dataRevision);
    void loadHotlist({ force: true });
  }, [activeRefreshJob, loadHotlist]);

  useEffect(() => {
    if (!snapshot || selectedAccountId === "all") return;
    if (getSelectionPlatform(selectedAccountId)) return;
    if (snapshot.accounts.some((account) => account.id === selectedAccountId)) return;
    setSelectedAccountId("all");
  }, [selectedAccountId, snapshot]);

  const selectedPlatform = useMemo(() => getSelectionPlatform(selectedAccountId), [selectedAccountId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (selectedAccountId === "all") {
      params.delete("account");
    } else {
      params.set("account", selectedAccountId);
    }
    if (sortMode === "heat") {
      params.delete("sort");
    } else {
      params.set("sort", sortMode);
    }
    if (windowFilter === DEFAULT_WINDOW) {
      params.delete("window");
    } else {
      params.set("window", windowFilter);
    }
    const queryString = params.toString();
    const nextHref = queryString ? `${pathname}?${queryString}` : pathname;
    if (`${window.location.pathname}${window.location.search}` !== nextHref) {
      router.replace(nextHref, { scroll: false });
    }
  }, [pathname, router, selectedAccountId, sortMode, windowFilter]);

  const selectedAccount = useMemo(() => {
    if (!snapshot || selectedAccountId === "all" || selectedPlatform) return null;
    return snapshot.accounts.find((account) => account.id === selectedAccountId) || null;
  }, [selectedAccountId, selectedPlatform, snapshot]);

  const selectedPlatformAccounts = useMemo(() => {
    if (!snapshot || !selectedPlatform) return [];
    return snapshot.accounts.filter((account) => account.platform === selectedPlatform);
  }, [selectedPlatform, snapshot]);

  const visibleItems = useMemo(() => {
    const filtered = (snapshot?.items || []).filter(
      (item) =>
        selectedAccountId === "all" ||
        item.account.id === selectedAccountId ||
        item.account.platform === selectedPlatform
    );
    return [...filtered]
      .sort((left, right) => compareHotlistItems(left, right, sortMode))
      .map((item, index) => ({
        item,
        displayRank: index + 1
      }));
  }, [selectedAccountId, selectedPlatform, snapshot, sortMode]);

  const summary = snapshot?.summary;
  const operationBusy = Boolean(busy) || refreshing;
  const canAdd = Boolean(query.trim()) && !operationBusy;
  const canRefresh = Boolean(selectedPlatform ? selectedPlatformAccounts.length : snapshot?.accounts.length) &&
    !operationBusy;
  const initialLoading = busy === "load" && !snapshot;
  const windowLabel = getWindowLabel(summary?.windowKey || windowFilter);
  const selectedPlatformLabel = selectedPlatform ? getPlatformLabel(selectedPlatform) : "";
  const selectedPlatformRecentVideoCount = selectedPlatformAccounts.reduce((sum, account) => sum + account.recentVideoCount, 0);
  const refreshLabel = selectedAccount ? "抓取当前账号" : selectedPlatform ? `抓取${selectedPlatformLabel}${windowLabel}` : `抓取全部${windowLabel}`;
  const rankTitle = selectedAccount ? selectedAccount.name : selectedPlatform ? `${selectedPlatformLabel}热度榜` : "实时热度榜";
  const activePlatformFilter: Platform | "all" = selectedPlatform || selectedAccount?.platform || "all";
  const lastFullRefreshLabel = summary?.lastFullRefreshAt || summary?.lastFullRefreshAttemptAt;
  const rankSubtitle = selectedAccount
    ? `${getPlatformLabel(selectedAccount.platform)} · ${selectedAccount.recentVideoCount} 条${windowLabel}内容 · 总榜中筛选${
        lastFullRefreshLabel ? ` · 最近全量检查 ${formatDate(lastFullRefreshLabel)}` : ""
      }`
    : selectedPlatform
      ? `${selectedPlatformAccounts.length} 个${selectedPlatformLabel}账号 · ${windowLabel} ${selectedPlatformRecentVideoCount} 条 · 最近刷新 ${
          lastFullRefreshLabel ? formatDate(lastFullRefreshLabel) : "未检查"
        }`
    : summary
      ? `${summary.accountCount} 个账号 · ${windowLabel} ${summary.recentVideoCount} 条 · 最近刷新 ${
          lastFullRefreshLabel ? formatDate(lastFullRefreshLabel) : "未检查"
        }`
      : "跨账号排序，按互动强度和发布时间综合判断。";

  async function handleAddAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAdd) return;

    busyRef.current = "add";
    setBusy("add");
    setMessage("");
    setError("");
    try {
      const next = await addDouyinHotlistAccount({ platform: accountPlatform, query, window: windowFilter });
      setSnapshot(next);
      setQuery("");
      setMessage(`已加入${getPlatformLabel(accountPlatform)}视频热榜账号池。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `添加${getPlatformLabel(accountPlatform)}账号失败`);
    } finally {
      busyRef.current = "";
      setBusy("");
    }
  }

  const refreshHotlist = useCallback(async (options: RefreshHotlistOptions = {}) => {
    const automatic = Boolean(options.automatic);
    if (!snapshot?.accounts.length) {
      if (automatic) {
        appendRefreshLog({
          automatic,
          status: "skipped",
          text: "账号池为空，自动刷新跳过。"
        });
      }
      return;
    }

    if (activeRefreshJobRef.current || busyRef.current) {
      if (automatic) {
        appendRefreshLog({
          automatic,
          status: "skipped",
          text: "已有任务运行中，自动刷新跳过。"
        });
      }
      return;
    }

    setMessage("");
    setError("");
    try {
      const job = await tasks.startTask({
        kind: "hotlist-refresh",
        href: "/douyin-hotlist",
        input: {
          accountIds: automatic
            ? undefined
            : selectedAccount
              ? [selectedAccount.id]
              : selectedPlatform
                ? selectedPlatformAccounts.map((account) => account.id)
                : undefined,
          automatic,
          limit: REFRESH_LIMIT,
          window: windowFilter
        }
      });
      trackedRefreshJobIdsRef.current.add(job.id);
      activeRefreshJobRef.current = job;
      if (!automatic) setMessage("刷新任务已开始，可在任务中心查看进度或停止。");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      const refreshBusy = isRefreshBusyMessage(errorMessage);
      appendRefreshLog({
        automatic,
        status: refreshBusy ? "skipped" : "failed",
        text: `${automatic ? "自动" : "手动"}刷新${refreshBusy ? "跳过" : "失败"}：${errorMessage}`
      });
      if (refreshBusy) {
        if (!automatic) setMessage(errorMessage);
      } else {
        setError(errorMessage);
      }
    }
  }, [appendRefreshLog, selectedAccount, selectedPlatform, selectedPlatformAccounts, snapshot?.accounts.length, tasks, windowFilter]);

  useEffect(() => {
    if (tasks.loading) return;

    if (!refreshJobsReadyRef.current) {
      tasks.activeJobs.forEach((job) => trackedRefreshJobIdsRef.current.add(job.id));
      tasks.jobs.filter(isTerminalRefreshJob).forEach((job) => handledRefreshJobIdsRef.current.add(job.id));
      refreshJobsReadyRef.current = true;
      return;
    }

    tasks.activeJobs.forEach((job) => trackedRefreshJobIdsRef.current.add(job.id));
    const completedJobs = tasks.jobs.filter(
      (job) =>
        isTerminalRefreshJob(job) &&
        trackedRefreshJobIdsRef.current.has(job.id) &&
        !handledRefreshJobIdsRef.current.has(job.id)
    );
    if (!completedJobs.length) return;

    completedJobs.forEach((job) => handledRefreshJobIdsRef.current.add(job.id));
    void (async () => {
      for (const job of completedJobs) {
        await handleRefreshJobSettled(job, {
          appendRefreshLog,
          loadHotlist,
          setError,
          setMessage
        });
      }
    })();
  }, [appendRefreshLog, loadHotlist, tasks.activeJobs, tasks.jobs, tasks.loading]);

  useEffect(() => {
    refreshHotlistRef.current = refreshHotlist;
  }, [refreshHotlist]);

  const runAutoRefreshIfDue = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!accountCountRef.current || busyRef.current) return;

    const now = Date.now();
    if (autoRefreshReadyAtRef.current && now < autoRefreshReadyAtRef.current) return;

    const lastCompletedRefreshAt = getTimeValue(lastFullRefreshAttemptAtRef.current);
    const lastAutoRefreshAttemptAt = lastAutoRefreshAttemptAtRef.current;
    const lastAutoRefreshBaseline = Math.max(lastCompletedRefreshAt, lastAutoRefreshAttemptAt);
    if (lastAutoRefreshBaseline && now - lastAutoRefreshBaseline < AUTO_REFRESH_INTERVAL_MS) return;

    lastAutoRefreshAttemptAtRef.current = now;
    void refreshHotlistRef.current({ automatic: true });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    autoRefreshReadyAtRef.current = Date.now() + AUTO_REFRESH_START_DELAY_MS;
    const timer = window.setInterval(runAutoRefreshIfDue, AUTO_REFRESH_CHECK_INTERVAL_MS);
    const handlePageAvailable = () => runAutoRefreshIfDue();

    window.addEventListener("focus", handlePageAvailable);
    document.addEventListener("visibilitychange", handlePageAvailable);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handlePageAvailable);
      document.removeEventListener("visibilitychange", handlePageAvailable);
    };
  }, [runAutoRefreshIfDue]);

  async function handleRefresh() {
    if (!canRefresh) return;
    await refreshHotlist();
  }

  async function handleRemoveAccount(accountId: string) {
    busyRef.current = `remove:${accountId}`;
    setBusy(`remove:${accountId}`);
    setMessage("");
    setError("");
    try {
      setSnapshot(await removeDouyinHotlistAccount(accountId, { window: windowFilter }));
      setRemoveTarget(null);
      if (selectedAccountId === accountId) {
        setSelectedAccountId("all");
      }
      setMessage("已从热榜账号池移除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除视频热榜账号失败");
    } finally {
      busyRef.current = "";
      setBusy("");
    }
  }

  return (
    <div className="page douyin-hotlist-page workbench-frame-page">
      <header className="page-header">
        <div className="page-title-group">
          <span className="page-title-eyebrow">对标内容</span>
          <div className="page-title-row">
            <span className="page-title-mark" aria-hidden="true">
              <Flame size={20} strokeWidth={2.1} />
            </span>
            <div className="page-title-copy">
              <h1>视频热榜</h1>
              <p className="subtle">维护抖音 / B站独立对标池，抓取{windowLabel}值得拆解的内容。</p>
            </div>
          </div>
        </div>
        <div className="page-header-meta">
          <button className="btn" onClick={() => setAccountDrawerOpen(true)} type="button">
            <SlidersHorizontal aria-hidden="true" size={16} />
            管理账号
          </button>
          <RefreshLogMenu logs={refreshLogs} />
          <button className="btn" aria-busy={busy === "load"} disabled={operationBusy} onClick={() => void loadHotlist({ force: true })} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            重载
          </button>
          <button className="btn primary" aria-busy={refreshing} disabled={!canRefresh} onClick={() => void handleRefresh()} type="button">
            <TrendingUp aria-hidden="true" size={16} />
            {activeRefreshJob ? `抓取中 ${Math.round(activeRefreshJob.progress)}%` : refreshLabel}
          </button>
        </div>
      </header>

      {message ? <div className="notice" role="status">{message}</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      <section className="douyin-hotlist-workspace workbench-frame-workspace">
        <section className="pane douyin-hotlist-rank-pane">
          <div className="pane-header">
            <div>
              <h2>{rankTitle}</h2>
              <p className="pane-subtitle">{rankSubtitle}</p>
            </div>
            <div className="douyin-hotlist-rank-actions">
              <WindowFilterControl
                disabled={operationBusy}
                onChange={setWindowFilter}
                value={windowFilter}
              />
              <PlatformFilterControl
                disabled={operationBusy || initialLoading || !snapshot?.accounts.length}
                onChange={(platform) => setSelectedAccountId(platform === "all" ? "all" : getPlatformAccountSelection(platform))}
                value={activePlatformFilter}
              />
              <AccountFilter
                accounts={snapshot?.accounts || []}
                disabled={operationBusy || initialLoading || !snapshot?.accounts.length}
                onChange={setSelectedAccountId}
                value={selectedAccountId}
              />
              <label className="inline-sort-control douyin-hotlist-sort">
                <span>排序</span>
                <select
                  aria-label="榜单排序"
                  disabled={operationBusy}
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                  value={sortMode}
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <span className={`status-pill ${initialLoading || refreshing ? "pending" : "completed"}`}>
                {initialLoading ? "读取中" : refreshing ? `刷新 ${Math.round(activeRefreshJob?.progress || 0)}%` : `${visibleItems.length} 条`}
              </span>
            </div>
          </div>

          {initialLoading ? (
            <HotlistLoadingRows />
          ) : visibleItems.length ? (
            <HotlistTable items={visibleItems} showGlobalRank={selectedAccountId !== "all" || sortMode !== "heat"} />
          ) : (
            <EmptyHotlist hasAccounts={Boolean(snapshot?.accounts.length)} selectedAccount={selectedAccount?.name} windowLabel={windowLabel} />
          )}
        </section>
      </section>
      {accountDrawerOpen ? (
        <AccountManagementDrawer
          accounts={snapshot?.accounts || []}
          accountPlatform={accountPlatform}
          busy={busy}
          canAdd={canAdd}
          disabled={operationBusy}
          initialLoading={initialLoading}
          query={query}
          selectedAccountId={selectedAccountId}
          summary={snapshot?.summary}
          windowLabel={windowLabel}
          onAddAccount={handleAddAccount}
          onClose={() => setAccountDrawerOpen(false)}
          onPlatformChange={setAccountPlatform}
          onQueryChange={setQuery}
          onRemoveAccount={setRemoveTarget}
          onSelectAccount={setSelectedAccountId}
        />
      ) : null}
      {removeTarget ? (
        <ConfirmDialog
          body={`会将“${removeTarget.name}”从视频热榜账号池移除，本地热榜记录也会随账号池更新。`}
          busy={busy === `remove:${removeTarget.id}`}
          confirmLabel="移除账号"
          title="移除热榜账号？"
          onCancel={() => {
            if (busy !== `remove:${removeTarget.id}`) setRemoveTarget(null);
          }}
          onConfirm={() => void handleRemoveAccount(removeTarget.id)}
        />
      ) : null}
    </div>
  );
}

function DouyinHotlistFallback() {
  return (
    <div className="page douyin-hotlist-page workbench-frame-page">
      <section className="douyin-hotlist-workspace workbench-frame-workspace">
        <section className="pane douyin-hotlist-rank-pane">
          <HotlistLoadingRows />
        </section>
      </section>
    </div>
  );
}

function AccountFilter({
  accounts,
  disabled,
  onChange,
  value
}: {
  accounts: DouyinHotlistAccount[];
  disabled: boolean;
  onChange: (value: AccountSelection) => void;
  value: AccountSelection;
}) {
  return (
    <label className="inline-sort-control douyin-hotlist-account-filter">
      <span>账号</span>
      <select aria-label="筛选对标账号" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="all">全部账号</option>
        <option value={getPlatformAccountSelection("douyin")}>全部抖音账号</option>
        <option value={getPlatformAccountSelection("bilibili")}>全部 B站账号</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>{getPlatformLabel(account.platform)} · {account.name}</option>
        ))}
      </select>
    </label>
  );
}

function WindowFilterControl({
  disabled,
  onChange,
  value
}: {
  disabled: boolean;
  onChange: (value: WindowFilter) => void;
  value: WindowFilter;
}) {
  return (
    <div className="segmented-control douyin-hotlist-window-filter" aria-label="时间筛选">
      {windowOptions.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={value === option.value ? "active" : ""}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PlatformFilterControl({
  disabled,
  onChange,
  value
}: {
  disabled: boolean;
  onChange: (value: Platform | "all") => void;
  value: Platform | "all";
}) {
  const options: Array<{ label: string; value: Platform | "all" }> = [
    { label: "全部", value: "all" },
    { label: "抖音", value: "douyin" },
    { label: "B站", value: "bilibili" }
  ];

  return (
    <div className="segmented-control douyin-hotlist-platform-filter" aria-label="平台筛选">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={value === option.value ? "active" : ""}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PlatformSwitch({
  disabled,
  onChange,
  value
}: {
  disabled: boolean;
  onChange: (value: Platform) => void;
  value: Platform;
}) {
  return (
    <div className="segmented-control douyin-hotlist-platform-switch" aria-label="选择账号平台">
      {(["douyin", "bilibili"] as const).map((platform) => (
        <button
          aria-pressed={value === platform}
          className={value === platform ? "active" : ""}
          disabled={disabled}
          key={platform}
          onClick={() => onChange(platform)}
          type="button"
        >
          {getPlatformLabel(platform)}
        </button>
      ))}
    </div>
  );
}

function RefreshLogMenu({ logs }: { logs: RefreshLogEntry[] }) {
  const latestLog = logs[0];

  return (
    <details className="douyin-hotlist-refresh-log">
      <summary aria-label="查看刷新日志" className="btn douyin-hotlist-refresh-log-trigger">
        <Clock3 aria-hidden="true" size={13} />
        <span>{latestLog ? formatLogTime(latestLog.at) : "刷新日志"}</span>
      </summary>
      <div className="douyin-hotlist-refresh-log-panel" role="log" aria-label="刷新日志">
        <div className="douyin-hotlist-refresh-log-head">
          <strong>刷新日志</strong>
          <span>每 30 分钟自动检查，失败会记录</span>
        </div>
        {logs.length ? (
          <ol>
            {logs.map((log) => (
              <li className={`tone-${log.status}`} key={log.id}>
                <span className="douyin-hotlist-refresh-log-meta">
                  <span>{formatLogTime(log.at)}</span>
                  <span>{log.automatic ? "自动" : "手动"}</span>
                  <span>{getRefreshLogStatusLabel(log.status)}</span>
                </span>
                <span>{log.text}</span>
                {log.details?.length ? (
                  <span className="douyin-hotlist-refresh-log-details">
                    {log.details.map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>暂无记录，下一次自动刷新会写在这里。</p>
        )}
      </div>
    </details>
  );
}

function AccountManagementDrawer({
  accounts,
  accountPlatform,
  busy,
  canAdd,
  disabled,
  initialLoading,
  query,
  selectedAccountId,
  summary,
  windowLabel,
  onAddAccount,
  onClose,
  onPlatformChange,
  onQueryChange,
  onRemoveAccount,
  onSelectAccount
}: {
  accounts: DouyinHotlistAccount[];
  accountPlatform: Platform;
  busy: BusyState;
  canAdd: boolean;
  disabled: boolean;
  initialLoading: boolean;
  query: string;
  selectedAccountId: AccountSelection;
  summary?: DouyinHotlistResponse["summary"];
  windowLabel: string;
  onAddAccount: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onPlatformChange: (platform: Platform) => void;
  onQueryChange: (value: string) => void;
  onRemoveAccount: (account: DouyinHotlistAccount) => void;
  onSelectAccount: (value: AccountSelection) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = busy === "add" || busy.startsWith("remove:");
  const platformLabel = getPlatformLabel(accountPlatform);
  const visibleAccounts = useMemo(
    () => accounts.filter((account) => account.platform === accountPlatform),
    [accounts, accountPlatform]
  );
  const visibleRecentVideoCount = visibleAccounts.reduce((sum, account) => sum + account.recentVideoCount, 0);
  const platformSelection = getPlatformAccountSelection(accountPlatform);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <ModalBackdrop closeLabel="点击空白处关闭账号管理" disabled={locked} onClose={onClose}>
      <aside
        aria-labelledby="douyin-hotlist-account-drawer-title"
        aria-modal="true"
        className="douyin-hotlist-account-drawer"
        onKeyDown={(event) => handleDrawerKeyDown(event, locked, onClose)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="douyin-hotlist-account-drawer-header">
          <div>
            <h2 id="douyin-hotlist-account-drawer-title">管理账号</h2>
            <p>{summary ? `${summary.accountCount} 个账号 · ${windowLabel} ${summary.recentVideoCount} 条` : "独立热榜账号池"}</p>
          </div>
          <button aria-label="关闭账号管理" className="btn icon-only compact" disabled={locked} onClick={onClose} type="button">
            <X aria-hidden="true" size={15} />
          </button>
        </header>

        <form className="douyin-hotlist-drawer-add-form" onSubmit={onAddAccount}>
          <label htmlFor="douyin-hotlist-drawer-query">账号名 / 主页链接</label>
          <PlatformSwitch
            disabled={disabled}
            onChange={onPlatformChange}
            value={accountPlatform}
          />
          <div className="douyin-hotlist-add-row">
            <input
              autoComplete="off"
              disabled={disabled}
              id="douyin-hotlist-drawer-query"
              name="query"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={getAccountInputPlaceholder(accountPlatform)}
              ref={inputRef}
              value={query}
            />
            <button className="btn primary icon-only" disabled={!canAdd} type="submit" aria-label={`添加${getPlatformLabel(accountPlatform)}账号`}>
              <Plus aria-hidden="true" size={17} />
            </button>
          </div>
        </form>

        <div className="douyin-hotlist-drawer-body" aria-label={`已关注${platformLabel}账号`}>
          {initialLoading ? (
            <HotlistAccountLoadingRows />
          ) : visibleAccounts.length ? (
            <>
              <AccountRowAll
                active={selectedAccountId === platformSelection}
                accountCount={visibleAccounts.length}
                label={`全部${platformLabel}账号`}
                recentVideoCount={visibleRecentVideoCount}
                windowLabel={windowLabel}
                onSelect={() => onSelectAccount(platformSelection)}
              />
              {visibleAccounts.map((account) => (
                <AccountRow
                  account={account}
                  active={selectedAccountId === account.id}
                  busy={disabled || busy === `remove:${account.id}`}
                  key={account.id}
                  windowLabel={windowLabel}
                  onRemove={() => onRemoveAccount(account)}
                  onSelect={() => onSelectAccount(account.id)}
                />
              ))}
            </>
          ) : (
            <div className="douyin-hotlist-empty-inline">
              <Users aria-hidden="true" size={17} />
              <span>还没有{platformLabel}对标账号。</span>
            </div>
          )}
        </div>
      </aside>
    </ModalBackdrop>
  );
}

function handleDrawerKeyDown(event: KeyboardEvent<HTMLElement>, locked: boolean, onClose: () => void) {
  if (event.key === "Escape" && !locked) {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );

  if (!focusable.length) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (document.activeElement === event.currentTarget) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function parseSortMode(value: string | null): SortMode {
  return sortOptions.some((option) => option.value === value) ? (value as SortMode) : "heat";
}

function parseWindowFilter(value: string | null): WindowFilter {
  return windowOptions.some((option) => option.value === value) ? (value as WindowFilter) : DEFAULT_WINDOW;
}

function parseStoredRefreshLogs(value: string | null): RefreshLogEntry[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRefreshLogEntry).slice(0, MAX_REFRESH_LOGS);
  } catch {
    return [];
  }
}

function isRefreshLogEntry(value: unknown): value is RefreshLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RefreshLogEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.at === "string" &&
    typeof entry.automatic === "boolean" &&
    typeof entry.text === "string" &&
    (entry.details === undefined || (Array.isArray(entry.details) && entry.details.every((detail) => typeof detail === "string"))) &&
    isRefreshLogStatus(entry.status)
  );
}

function isRefreshLogStatus(value: unknown): value is RefreshLogStatus {
  return value === "success" || value === "warning" || value === "failed" || value === "skipped";
}

function HotlistAccountLoadingRows() {
  return (
    <div className="douyin-hotlist-skeleton-list" aria-label="正在读取对标账号">
      {Array.from({ length: 5 }).map((_, index) => (
        <span className="douyin-hotlist-account-skeleton" key={index} />
      ))}
    </div>
  );
}

function HotlistLoadingRows() {
  return (
    <div className="douyin-hotlist-list douyin-hotlist-skeleton-list" aria-label="正在读取热榜">
      {Array.from({ length: 6 }).map((_, index) => (
        <article className="douyin-hotlist-item douyin-hotlist-item-skeleton" key={index}>
          <span className="douyin-hotlist-rank-skeleton" />
          <div className="douyin-hotlist-item-skeleton-content">
            <span />
            <span />
            <span />
          </div>
        </article>
      ))}
    </div>
  );
}

function AccountRowAll({
  accountCount,
  active,
  label,
  onSelect,
  recentVideoCount,
  windowLabel
}: {
  accountCount: number;
  active: boolean;
  label: string;
  onSelect: () => void;
  recentVideoCount: number;
  windowLabel: string;
}) {
  return (
    <div className={`list-button account-list-button douyin-hotlist-account-row all-row ${active ? "active" : ""}`}>
      <button
        aria-pressed={active}
        className="douyin-hotlist-account-select"
        onClick={onSelect}
        type="button"
      >
        <span className="account-avatar tone-7" aria-hidden="true">
          <Users size={15} strokeWidth={2.1} />
        </span>
        <span className="account-list-copy">
          <span className="list-title">{label}</span>
          <span className="list-meta">{windowLabel} {recentVideoCount} · {accountCount} 个账号</span>
        </span>
      </button>
    </div>
  );
}

function AccountRow({
  account,
  active,
  busy,
  windowLabel,
  onRemove,
  onSelect
}: {
  account: DouyinHotlistAccount;
  active: boolean;
  busy: boolean;
  windowLabel: string;
  onRemove: () => void;
  onSelect: () => void;
}) {
  return (
    <div className={`list-button account-list-button douyin-hotlist-account-row ${active ? "active" : ""}`}>
      <button
        aria-pressed={active}
        className="douyin-hotlist-account-select"
        onClick={onSelect}
        type="button"
      >
        <span
          className={`account-avatar tone-${getAvatarTone(account.id)} ${account.avatarUrl ? "has-image" : ""}`}
          aria-hidden="true"
        >
          <AccountAvatarImage account={account} size={30} />
        </span>
        <span className="account-list-copy">
          <span className="list-title">
            <PlatformLogoBadge platform={account.platform} />
            <span className="douyin-hotlist-account-name">{account.name}</span>
          </span>
          <span className="list-meta">{windowLabel} {account.recentVideoCount} · 累计 {account.videoCount}</span>
        </span>
      </button>
      <button
        aria-label={`移除 ${account.name}`}
        className="btn icon-only compact douyin-hotlist-account-remove mobile-destructive-action"
        disabled={busy}
        onClick={onRemove}
        title="移出热榜账号池"
        type="button"
      >
        <Trash2 aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

function HotlistTable({
  items,
  showGlobalRank
}: {
  items: { item: DouyinHotlistItem; displayRank: number }[];
  showGlobalRank: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const [renderCount, setRenderCount] = useState(HOTLIST_INITIAL_RENDER_COUNT);
  const maxHeatScore = Math.max(...items.map(({ item }) => item.heatScore), 1);
  const renderedItems = items.slice(0, renderCount);
  const hasMore = renderedItems.length < items.length;
  const remainingCount = Math.max(items.length - renderedItems.length, 0);

  const loadMore = useCallback(() => {
    setRenderCount((current) => Math.min(current + HOTLIST_RENDER_STEP, items.length));
  }, [items.length]);

  useEffect(() => {
    setRenderCount(HOTLIST_INITIAL_RENDER_COUNT);
    listRef.current?.scrollTo({ left: 0, top: 0 });
  }, [items, showGlobalRank]);

  useEffect(() => {
    const root = listRef.current;
    const target = loadMoreRef.current;
    if (!root || !target || !hasMore || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: "320px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div className="douyin-hotlist-list" ref={listRef}>
      {renderedItems.map(({ item, displayRank }) => {
        const surgeClass = getSurgeClass(item.surge);

        return (
          <article
            className={`douyin-hotlist-item has-cover ${getRankClass(displayRank)} ${surgeClass}`}
            key={`${item.account.id}:${item.video.id}`}
          >
            <div className="douyin-hotlist-rank" aria-label={`第 ${displayRank} 名`}>
              <strong>{displayRank}</strong>
              <span>{showGlobalRank ? `总榜 ${item.rank}` : "热榜"}</span>
            </div>
            <div className="douyin-hotlist-item-content">
              <div className="douyin-hotlist-item-head">
                <HotlistCover item={item} />
                <div className="douyin-hotlist-item-main">
                  <h3 title={item.video.title}>{item.video.title}</h3>
                  <div className="douyin-hotlist-item-meta">
                    <span className="douyin-hotlist-account-meta">
                      <span
                        className={`douyin-hotlist-source-avatar tone-${getAvatarTone(item.account.id)} ${item.account.avatarUrl ? "has-image" : ""}`}
                        aria-hidden="true"
                      >
                        <AccountAvatarImage account={item.account} size={22} />
                      </span>
                      <PlatformLogoBadge platform={item.account.platform} />
                      {item.account.name}
                    </span>
                    <span>
                      <Clock3 aria-hidden="true" size={12} />
                      {formatDate(item.video.publishedAt)}
                      {item.ageHours !== undefined ? ` · ${formatAge(item.ageHours)}` : ""}
                    </span>
                  </div>
                  <div className="douyin-hotlist-signal-row">
                    <span className="douyin-hotlist-signal">{item.signal}</span>
                    {item.surge ? (
                      <span className={`douyin-hotlist-surge-badge ${surgeClass}`} title={item.surge.reason} aria-label={item.surge.reason}>
                        <Zap aria-hidden="true" size={12} />
                        {item.surge.label}
                      </span>
                    ) : null}
                  </div>
                  {item.tags.length ? (
                    <div className="douyin-hotlist-tags">
                      {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  ) : null}
                </div>
                <a className="btn icon-only compact" href={getVideoExternalUrl(item.video)} target="_blank" rel="noreferrer" aria-label={`打开 ${item.video.title}`}>
                  <ExternalLink aria-hidden="true" size={15} />
                </a>
              </div>

              <div className="douyin-hotlist-item-data">
                <div className="douyin-hotlist-metrics" aria-label="互动数据">
                  {getMetricItems(item.video).map((metric) => (
                    <Metric key={metric.label} label={metric.label} tone={metric.tone} value={metric.value} />
                  ))}
                </div>
                <div className="douyin-hotlist-heat">
                  <div className="douyin-hotlist-score">
                    <span>热度</span>
                    <strong>{scoreFormatter.format(item.heatScore)}</strong>
                  </div>
                  <div className="douyin-hotlist-heat-track" aria-hidden="true">
                    <span style={{ "--heat-strength": `${getHeatStrength(item.heatScore, maxHeatScore)}%` } as CSSProperties} />
                  </div>
                  <small>互动与发布时间综合</small>
                </div>
              </div>
            </div>
          </article>
        );
      })}
      {hasMore ? (
        <div className="douyin-hotlist-load-more">
          <button className="btn compact" onClick={loadMore} ref={loadMoreRef} type="button">
            继续显示 · 已载入 {renderedItems.length}/{items.length}
          </button>
          <span>向下滚动会自动载入剩余 {remainingCount} 条</span>
        </div>
      ) : null}
    </div>
  );
}

function HotlistCover({ item }: { item: DouyinHotlistItem }) {
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
  }, [item.account.avatarUrl, item.video.coverUrl]);

  if (item.video.coverUrl && !coverFailed) {
    return (
      <Image
        alt=""
        className="douyin-hotlist-cover"
        height={76}
        onError={() => setCoverFailed(true)}
        referrerPolicy="no-referrer"
        src={item.video.coverUrl}
        unoptimized
        width={56}
      />
    );
  }

  return (
    <span className={`douyin-hotlist-cover douyin-hotlist-cover-placeholder tone-${getAvatarTone(item.account.id)}`} aria-hidden="true">
      <AccountAvatarImage account={item.account} size={32} />
    </span>
  );
}

function AccountAvatarImage({
  account,
  size
}: {
  account: Pick<DouyinHotlistItem["account"], "avatarUrl" | "id" | "name">;
  size: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [account.avatarUrl]);

  if (!account.avatarUrl || failed) return <>{getAccountInitial(account.name)}</>;

  return (
    <Image
      alt=""
      height={size}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
      src={account.avatarUrl}
      unoptimized
      width={size}
    />
  );
}

function PlatformLogoBadge({ platform }: { platform: Platform }) {
  const label = getPlatformLabel(platform);

  return (
    <span
      aria-label={label}
      className={`douyin-hotlist-platform-logo platform-${platform}`}
      role="img"
      title={label}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="douyin-hotlist-platform-logo-image"
        height={18}
        src={platformLogoSrc[platform]}
        unoptimized
        width={18}
      />
    </span>
  );
}

function Metric({
  label,
  tone,
  value
}: {
  label: string;
  tone: MetricTone;
  value: number;
}) {
  return (
    <span className={`douyin-hotlist-metric tone-${tone}`}>
      <small>{label}</small>
      <strong>{formatNumber(value)}</strong>
    </span>
  );
}

function getMetricItems(video: DouyinHotlistItem["video"]): Array<{ label: string; tone: MetricTone; value: number }> {
  if (video.platform === "bilibili") {
    return [
      { label: "播放", tone: "views", value: video.stats.views },
      { label: "点赞", tone: "likes", value: video.stats.likes },
      { label: "评论", tone: "comments", value: video.stats.comments },
      { label: "收藏", tone: "favorites", value: video.stats.favorites }
    ];
  }

  return [
    { label: "点赞", tone: "likes", value: video.stats.likes },
    { label: "评论", tone: "comments", value: video.stats.comments },
    { label: "收藏", tone: "favorites", value: video.stats.favorites },
    { label: "转发", tone: "shares", value: video.stats.shares || 0 }
  ];
}

function getVideoExternalUrl(video: DouyinHotlistItem["video"]) {
  if (video.platform === "douyin") {
    return buildDouyinVideoUrl(video.id) || video.url;
  }

  return video.url;
}

function EmptyHotlist({
  hasAccounts,
  selectedAccount,
  windowLabel
}: {
  hasAccounts: boolean;
  selectedAccount?: string;
  windowLabel: string;
}) {
  return (
    <div className="empty-state-panel douyin-hotlist-empty-rank">
      <Flame aria-hidden="true" size={18} />
      <h2>暂无{windowLabel}内容</h2>
      <p className="subtle">
        {selectedAccount
          ? `${selectedAccount} ${windowLabel}还没有可排序内容，可切换时间范围或重新抓取。`
          : hasAccounts
            ? `${windowLabel}暂时没有可排序内容，可切换时间范围或重新抓取。`
            : "添加账号后抓取，榜单会按跨账号热度排序。"}
      </p>
    </div>
  );
}

function compareHotlistItems(left: DouyinHotlistItem, right: DouyinHotlistItem, mode: SortMode) {
  if (mode === "likes") {
    return right.video.stats.likes - left.video.stats.likes || right.heatScore - left.heatScore;
  }

  if (mode === "comments") {
    return right.video.stats.comments - left.video.stats.comments || right.heatScore - left.heatScore;
  }

  if (mode === "saves") {
    return getSaveShareScore(right) - getSaveShareScore(left) || right.heatScore - left.heatScore;
  }

  if (mode === "recent") {
    return getTimeValue(right.video.publishedAt) - getTimeValue(left.video.publishedAt) || right.heatScore - left.heatScore;
  }

  return right.heatScore - left.heatScore || getTimeValue(right.video.publishedAt) - getTimeValue(left.video.publishedAt);
}

function getSaveShareScore(item: DouyinHotlistItem) {
  return item.video.stats.favorites + (item.video.stats.shares || 0);
}

function getRankClass(rank: number) {
  if (rank === 1) return "rank-one";
  if (rank === 2) return "rank-two";
  if (rank === 3) return "rank-three";
  return "";
}

function getSurgeClass(surge?: DouyinHotlistItem["surge"]) {
  if (!surge) return "";
  return surge.label === "猛涨" ? "is-surging surge-rapid" : "is-surging surge-rising";
}

function getHeatStrength(score: number, maxScore: number) {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return 8;
  return Math.max(8, Math.min(100, Math.round((score / maxScore) * 100)));
}

function getTimeValue(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatNumber(value: number | undefined) {
  return numberFormatter.format(value || 0);
}

function getWindowLabel(value: string) {
  return windowOptions.find((option) => option.value === value)?.labelText || windowOptions.find((option) => option.value === DEFAULT_WINDOW)?.labelText || "近 3 天";
}

function formatDate(value?: string) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return dateFormatter.format(date);
}

function formatLogTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未知时间";
  return logTimeFormatter.format(date);
}

function getRefreshLogStatusLabel(status: RefreshLogStatus) {
  if (status === "success") return "完成";
  if (status === "warning") return "部分失败";
  if (status === "failed") return "失败";
  return "跳过";
}

function describeRefreshLogDetails(accounts: DouyinHotlistRefreshAccountResult[]) {
  const issueAccounts = accounts.filter((account) => account.status === "failed" || account.status === "unchanged" || account.retried);
  const details = issueAccounts.slice(0, MAX_REFRESH_LOG_DETAILS).map(describeRefreshAccountResult);
  const omitted = issueAccounts.length - details.length;
  if (omitted > 0) details.push(`还有 ${omitted} 个账号也无更新、触发了重试或失败。`);
  return details;
}

function describeRefreshAccountResult(account: DouyinHotlistRefreshAccountResult) {
  if (account.status === "unchanged") {
    const countText = formatRefreshCountText(account);
    return `${account.name}：无更新${countText}${account.error ? `，${compactRefreshError(account.error)}` : ""}`;
  }

  if (account.status === "failed") {
    const retryText = account.retried ? "重试后未更新" : "失败";
    const countText = formatRefreshCountText(account);
    return `${account.name}：${retryText}${countText}${account.error ? `，${compactRefreshError(account.error)}` : ""}`;
  }

  const countText = formatRefreshCountText(account);
  return `${account.name}：批量抓取失败后单账号重试成功${countText}${account.retryReason ? `，原因为 ${compactRefreshError(account.retryReason)}` : ""}`;
}

function formatRefreshCountText(account: DouyinHotlistRefreshAccountResult) {
  if (account.changedCount !== undefined && account.observedCount !== undefined) {
    return `，观察 ${account.observedCount} 条，变更 ${account.changedCount} 条`;
  }
  if (account.savedCount !== undefined) return `，变更 ${account.savedCount} 条`;
  if (account.rawCount !== undefined) return `，抓到 ${account.rawCount} 条`;
  return "";
}

function compactRefreshError(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 120);
}

function isRefreshBusyMessage(message: string) {
  return /热榜正在刷新中|正在刷新中|已有.*刷新/i.test(message);
}

function formatAge(ageHours: number) {
  if (ageHours < 1) return "1 小时内";
  if (ageHours < 24) return `${Math.round(ageHours)} 小时前`;
  return `${Math.round(ageHours / 24)} 天前`;
}

function getAccountInitial(name: string) {
  return Array.from(name.trim()).at(0)?.toLocaleUpperCase("zh-CN") || "视";
}

function getAvatarTone(id: string) {
  return Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 8;
}

function getPlatformLabel(platform: Platform) {
  return platform === "bilibili" ? "B站" : "抖音";
}

function getPlatformAccountSelection(platform: Platform) {
  return `platform:${platform}`;
}

function getSelectionPlatform(value: AccountSelection): Platform | null {
  if (value === getPlatformAccountSelection("bilibili")) return "bilibili";
  if (value === getPlatformAccountSelection("douyin")) return "douyin";
  return null;
}

function getAccountInputPlaceholder(platform: Platform) {
  return platform === "bilibili" ? "输入 B站账号名、UID 或主页链接…" : "输入抖音账号名、sec_uid 或主页链接…";
}

function isTerminalRefreshJob(job: JobRecord) {
  return job.kind === "hotlist-refresh" && !["queued", "running"].includes(job.status);
}

function getRefreshJobResult(job: JobRecord): DouyinHotlistRefreshJobResult | null {
  if (!job.result || typeof job.result !== "object") return null;
  const result = job.result as Partial<DouyinHotlistRefreshJobResult>;
  if (!result.refresh || !result.summary || typeof result.automatic !== "boolean") return null;
  return result as DouyinHotlistRefreshJobResult;
}

async function handleRefreshJobSettled(
  job: JobRecord,
  handlers: {
    appendRefreshLog: (entry: Omit<RefreshLogEntry, "id" | "at">) => void;
    loadHotlist: (options?: { force?: boolean }) => Promise<void>;
    setError: (value: string) => void;
    setMessage: (value: string) => void;
  }
) {
  const result = getRefreshJobResult(job);
  const automatic = result?.automatic ?? job.title.startsWith("自动");

  if (job.status === "completed") {
    await handlers.loadHotlist({ force: true });
    if (!result) {
      const message = job.error || "刷新已完成，但任务明细暂未同步。";
      handlers.appendRefreshLog({ automatic, status: job.error ? "warning" : "success", text: message });
      if (job.error) handlers.setError(message);
      else if (!automatic) handlers.setMessage(message);
      return;
    }
    const summaryText = buildRefreshSummaryText(result.refresh);
    handlers.appendRefreshLog({
      automatic,
      status: result.refresh.failed ? "warning" : "success",
      text: `${automatic ? "自动" : "手动"}刷新：${summaryText} · ${result.summary.windowLabel}`,
      details: describeRefreshLogDetails(result.refresh.accounts)
    });
    if (!automatic) handlers.setMessage(summaryText);
    return;
  }

  if (job.status === "cancelled" || job.status === "interrupted") {
    const message = job.status === "cancelled" ? "刷新任务已停止。" : "刷新任务因服务重启中断，请重新发起。";
    handlers.appendRefreshLog({ automatic, status: "skipped", text: `${automatic ? "自动" : "手动"}${message}` });
    if (!automatic) handlers.setMessage(message);
    return;
  }

  const errorMessage = job.error || job.message || "视频热榜刷新失败";
  handlers.appendRefreshLog({ automatic, status: "failed", text: `${automatic ? "自动" : "手动"}刷新失败：${errorMessage}` });
  handlers.setError(errorMessage);
}

function buildRefreshSummaryText(refresh: DouyinHotlistRefreshJobResult["refresh"]) {
  const handledCount = refresh.completed + refresh.unchanged + refresh.failed;
  const changedVideoCount = refresh.accounts.reduce((sum, account) => sum + (account.changedCount || 0), 0);
  const parts = [`已处理 ${handledCount}/${refresh.requested} 个账号`];
  if (refresh.completed) parts.push(`${refresh.completed} 个有更新${changedVideoCount ? `（${changedVideoCount} 条内容）` : ""}`);
  if (refresh.unchanged) parts.push(`${refresh.unchanged} 个无变化`);
  if (refresh.failed) parts.push(`${refresh.failed} 个失败`);
  return `${parts.join("，")}。`;
}
