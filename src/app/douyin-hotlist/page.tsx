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
  getDouyinHotlistRefreshLogs,
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
  buildHotlistHref,
  formatDate,
  getPlatformAccountSelection,
  getPlatformLabel,
  getSelectedAccount,
  getSelectionPlatform,
  getVisibleHotlistItems,
  getWindowLabel,
  isRefreshBusyMessage,
  isTerminalRefreshJob,
  parseSortMode,
  parseWindowFilter,
  sortOptions,
  type AccountSelection,
  type BusyState,
  type RefreshLogEntry,
  type SortMode,
  type WindowFilter
} from "./_lib/douyin-hotlist-model";
import { AccountManagementDrawer } from "./_components/AccountManagementDrawer";
import { AccountFilter, PlatformFilterControl, WindowFilterControl } from "./_components/HotlistFilters";
import { EmptyHotlist, HotlistLoadingRows, HotlistTable } from "./_components/HotlistTable";
import { RefreshLogMenu } from "./_components/RefreshLogMenu";

const REFRESH_LIMIT = 10;

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
  const [refreshLogsLoading, setRefreshLogsLoading] = useState(true);
  const [refreshLogsError, setRefreshLogsError] = useState("");
  const busyRef = useRef<BusyState>(busy);
  const activeRefreshJobRef = useRef<JobRecord | null>(null);
  const syncedRefreshDataRevisionsRef = useRef<Map<string, number>>(new Map());
  const syncedTerminalRefreshJobRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const refreshLogRequestIdRef = useRef(0);
  const activeRefreshJob = tasks.activeJobs[0] || null;
  const latestTerminalRefreshJob = tasks.jobs.find(isTerminalRefreshJob) || null;
  const latestTerminalRefreshJobId = latestTerminalRefreshJob?.id || "";
  const latestTerminalRefreshJobStatus = latestTerminalRefreshJob?.status || "";
  const latestTerminalRefreshJobUpdatedAt = latestTerminalRefreshJob?.updatedAt || "";
  const latestTerminalRefreshDataRevision = latestTerminalRefreshJob?.dataRevision || 0;
  const latestTerminalRefreshSignature = latestTerminalRefreshJobId
    ? `${latestTerminalRefreshJobId}:${latestTerminalRefreshJobUpdatedAt}:${latestTerminalRefreshDataRevision}`
    : "";
  const refreshing = Boolean(activeRefreshJob);

  const loadRefreshLogs = useCallback(async (options: { signal?: AbortSignal } = {}) => {
    const requestId = refreshLogRequestIdRef.current + 1;
    refreshLogRequestIdRef.current = requestId;
    setRefreshLogsLoading(true);
    try {
      const result = await getDouyinHotlistRefreshLogs({ signal: options.signal });
      if (refreshLogRequestIdRef.current !== requestId) return;
      setRefreshLogs(result.logs);
      setRefreshLogsError("");
    } catch (error) {
      if (options.signal?.aborted || refreshLogRequestIdRef.current !== requestId) return;
      setRefreshLogsError(error instanceof Error ? error.message : "读取共享刷新日志失败");
    } finally {
      if (refreshLogRequestIdRef.current === requestId) setRefreshLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRefreshLogs({ signal: controller.signal });
    return () => controller.abort();
  }, [loadRefreshLogs]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

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

  const refreshHotlist = useCallback(async () => {
    if (!snapshot?.accounts.length || activeRefreshJobRef.current || busyRef.current) return;

    setError("");
    try {
      const job = await tasks.startTask({
        kind: "hotlist-refresh",
        href: "/douyin-hotlist",
        input: {
          accountIds: selectedAccount
            ? [selectedAccount.id]
            : selectedPlatform
              ? selectedPlatformAccounts.map((account) => account.id)
              : undefined,
          automatic: false,
          limit: REFRESH_LIMIT,
          window: windowFilter
        }
      });
      activeRefreshJobRef.current = job;
      notify({ tone: "info", message: "刷新任务已开始，可在任务中心查看进度或停止。" });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "未知错误";
      const refreshBusy = isRefreshBusyMessage(errorMessage);
      if (refreshBusy) {
        notify({ tone: "warning", message: errorMessage });
      } else {
        notify({ tone: "error", message: errorMessage });
      }
    }
  }, [notify, selectedAccount, selectedPlatform, selectedPlatformAccounts, snapshot?.accounts.length, tasks, windowFilter]);

  useEffect(() => {
    if (tasks.loading) return;
    if (syncedTerminalRefreshJobRef.current === null) {
      syncedTerminalRefreshJobRef.current = latestTerminalRefreshSignature;
      return;
    }
    if (!latestTerminalRefreshSignature) return;

    if (syncedTerminalRefreshJobRef.current === latestTerminalRefreshSignature) return;
    syncedTerminalRefreshJobRef.current = latestTerminalRefreshSignature;
    void loadRefreshLogs();
    if (latestTerminalRefreshJobStatus === "completed" || latestTerminalRefreshDataRevision > 0) {
      void loadHotlist({ force: true });
    }
  }, [
    latestTerminalRefreshDataRevision,
    latestTerminalRefreshJobStatus,
    latestTerminalRefreshSignature,
    loadHotlist,
    loadRefreshLogs,
    tasks.loading
  ]);

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
          <RefreshLogMenu error={refreshLogsError} loading={refreshLogsLoading} logs={refreshLogs} />
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
            <HotlistTable items={visibleItems} showGlobalRank={selectedAccountId !== "all"} />
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
