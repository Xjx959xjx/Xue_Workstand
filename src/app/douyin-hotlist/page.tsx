"use client";

import { Suspense, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Flame,
  RefreshCw,
  SlidersHorizontal,
  TrendingUp
} from "lucide-react";
import {
  addDouyinHotlistAccount,
  getCachedDouyinHotlist,
  getDouyinHotlist,
  removeDouyinHotlistAccount
} from "@/lib/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useFeedback } from "@/components/FeedbackProvider";
import { useScopedTasks } from "@/components/TaskProvider";
import type {
  DouyinHotlistAccount,
  DouyinHotlistResponse,
  JobRecord,
  Platform
} from "@/lib/types";
import {
  MAX_REFRESH_LOGS,
  buildHotlistHref,
  formatDate,
  getPlatformAccountSelection,
  getPlatformLabel,
  getRefreshJobSettlement,
  getSelectedAccount,
  getSelectionPlatform,
  getTimeValue,
  getVisibleHotlistItems,
  getWindowLabel,
  isRefreshBusyMessage,
  isTerminalRefreshJob,
  parseSortMode,
  parseStoredRefreshLogs,
  parseWindowFilter,
  sortOptions,
  type AccountSelection,
  type BusyState,
  type RefreshHotlistOptions,
  type RefreshLogEntry,
  type SortMode,
  type WindowFilter
} from "./_lib/douyin-hotlist-model";
import { AccountManagementDrawer } from "./_components/AccountManagementDrawer";
import { AccountFilter, PlatformFilterControl, WindowFilterControl } from "./_components/HotlistFilters";
import { EmptyHotlist, HotlistLoadingRows, HotlistTable } from "./_components/HotlistTable";
import { RefreshLogMenu } from "./_components/RefreshLogMenu";

const REFRESH_LIMIT = 10;
const AUTO_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000;
const AUTO_REFRESH_CHECK_INTERVAL_MS = 60 * 1000;
const AUTO_REFRESH_START_DELAY_MS = AUTO_REFRESH_CHECK_INTERVAL_MS;
const REFRESH_LOG_STORAGE_KEY = "douyin-hotlist-refresh-logs";

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
  const { notify } = useFeedback();
  const initialWindowFilter = parseWindowFilter(searchParams.get("window"));
  const [snapshot, setSnapshot] = useState<DouyinHotlistResponse | null>(() => getCachedDouyinHotlist({ window: initialWindowFilter }));
  const [query, setQuery] = useState("");
  const [accountPlatform, setAccountPlatform] = useState<Platform>("douyin");
  const [selectedAccountId, setSelectedAccountId] = useState<AccountSelection>(() => searchParams.get("account") || "all");
  const [sortMode, setSortMode] = useState<SortMode>(() => parseSortMode(searchParams.get("sort")));
  const [windowFilter, setWindowFilter] = useState<WindowFilter>(() => initialWindowFilter);
  const [busy, setBusy] = useState<BusyState>(() => getCachedDouyinHotlist({ window: initialWindowFilter }) ? "" : "load");
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
    const nextHref = buildHotlistHref({
      account: selectedAccountId,
      pathname,
      search: window.location.search,
      sort: sortMode,
      window: windowFilter
    });
    if (`${window.location.pathname}${window.location.search}` !== nextHref) {
      router.replace(nextHref, { scroll: false });
    }
  }, [pathname, router, selectedAccountId, sortMode, windowFilter]);

  const selectedAccount = useMemo(
    () => getSelectedAccount(snapshot, selectedAccountId, selectedPlatform),
    [selectedAccountId, selectedPlatform, snapshot]
  );

  const selectedPlatformAccounts = useMemo(() => {
    if (!snapshot || !selectedPlatform) return [];
    return snapshot.accounts.filter((account) => account.platform === selectedPlatform);
  }, [selectedPlatform, snapshot]);

  const visibleItems = useMemo(
    () => getVisibleHotlistItems({
      items: snapshot?.items || [],
      selectedAccountId,
      selectedPlatform,
      sortMode
    }),
    [selectedAccountId, selectedPlatform, snapshot?.items, sortMode]
  );

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
    setError("");
    try {
      const next = await addDouyinHotlistAccount({ platform: accountPlatform, query, window: windowFilter });
      setSnapshot(next);
      setQuery("");
      notify({ tone: "success", message: `已加入${getPlatformLabel(accountPlatform)}视频热榜账号池。` });
    } catch (err) {
      notify({ tone: "error", message: err instanceof Error ? err.message : `添加${getPlatformLabel(accountPlatform)}账号失败` });
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
      if (!automatic) {
        notify({ tone: "info", message: "刷新任务已开始，可在任务中心查看进度或停止。" });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      const refreshBusy = isRefreshBusyMessage(errorMessage);
      appendRefreshLog({
        automatic,
        status: refreshBusy ? "skipped" : "failed",
        text: `${automatic ? "自动" : "手动"}刷新${refreshBusy ? "跳过" : "失败"}：${errorMessage}`
      });
      if (refreshBusy) {
        if (!automatic) notify({ tone: "warning", message: errorMessage });
      } else {
        notify({ tone: "error", message: errorMessage });
      }
    }
  }, [appendRefreshLog, notify, selectedAccount, selectedPlatform, selectedPlatformAccounts, snapshot?.accounts.length, tasks, windowFilter]);

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
        const settlement = getRefreshJobSettlement(job);
        if (settlement.reload) await loadHotlist({ force: true });
        appendRefreshLog(settlement.log);
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
    setError("");
    try {
      setSnapshot(await removeDouyinHotlistAccount(accountId, { window: windowFilter }));
      setRemoveTarget(null);
      if (selectedAccountId === accountId) {
        setSelectedAccountId("all");
      }
      notify({ tone: "success", message: "已从热榜账号池移除。" });
    } catch (err) {
      notify({ tone: "error", message: err instanceof Error ? err.message : "移除视频热榜账号失败" });
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
