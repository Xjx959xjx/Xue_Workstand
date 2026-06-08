"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { AccountSidebar } from "./_components/AccountSidebar";
import { AccountStyleEditorModal } from "./_components/AccountStyleEditorModal";
import { LibraryDetailPane } from "./_components/LibraryDetailPane";
import { LibraryQuickStartPanel, type LibraryStats } from "./_components/LibraryQuickStartPanel";
import { TranscriptEditorModal } from "./_components/TranscriptEditorModal";
import { VideoTable } from "./_components/VideoTable";
import { collectOrderOptions, formatTimeRangeLabel, getDateFilter, type TimeRange } from "./_components/library-collect-utils";
import { makePreview } from "./_components/library-view-utils";
import { useBilibiliStatsHydration } from "./_hooks/useBilibiliStatsHydration";
import { useLibraryAccountDetail } from "./_hooks/useLibraryAccountDetail";
import { useLibraryMutations } from "./_hooks/useLibraryMutations";
import { useLibrarySelection } from "./_hooks/useLibrarySelection";
import { useLibraryTaskActions } from "./_hooks/useLibraryTaskActions";
import { useLibraryTaskEffects } from "./_hooks/useLibraryTaskEffects";
import { useLibraryTranscriptActions } from "./_hooks/useLibraryTranscriptActions";
import { useRestoreFocus } from "./_hooks/useRestoreFocus";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { useLibrary } from "@/components/LibraryProvider";
import { useScopedTasks } from "@/components/TaskProvider";
import { collectAccount, exportAccountTranscripts, getHealth } from "@/lib/client";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import type { CollectOrder, Platform } from "@/lib/types";

export default function LibraryPage() {
  const { library, loading, error, refresh } = useLibrary();
  const { activeJobs, recentJobs, startTask } = useScopedTasks({
    href: "/library",
    kinds: ["account-style", "transcribe-video", "batch-transcribe"]
  });
  const { notify } = useFeedback();
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [styleDraft, setStyleDraft] = useState("");
  const [styleLoading, setStyleLoading] = useState(false);
  const [message, setMessage] = useState("");
  const batchLimit = "all" as const;
  const [openModal, setOpenModal] = useState<"" | "transcript" | "style">("");
  const [deleteTarget, setDeleteTarget] = useState<"" | "accounts" | "videos">("");
  const [collectPlatform, setCollectPlatform] = useState<Platform>("bilibili");
  const [collectName, setCollectName] = useState("");
  const [collectLimit, setCollectLimit] = useState(20);
  const [collectOrder, setCollectOrder] = useState<CollectOrder>("views");
  const [collectTimeRange, setCollectTimeRange] = useState<TimeRange>("all");
  const [customFromDate, setCustomFromDate] = useState("");
  const [customToDate, setCustomToDate] = useState("");
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [lastCollect, setLastCollect] = useState<Awaited<ReturnType<typeof collectAccount>> | null>(null);
  const editModalRef = useRef<HTMLDivElement>(null);

  const accounts = useMemo(() => library?.accounts || [], [library?.accounts]);
  const selectedAccountMeta = useMemo(() => {
    const first = accounts[0];
    return accounts.find((account) => account.id === selectedAccountId) || first || null;
  }, [accounts, selectedAccountId]);

  const {
    accountDetail,
    accountDetailError,
    accountDetailLoading,
    reloadSelectedAccountDetail,
    selectedAccountDetailId,
    selectedAccountDetailPlatform,
    setAccountDetail
  } = useLibraryAccountDetail({ selectedAccountMeta, setStyleDraft });
  const selectedAccount = accountDetail?.id === selectedAccountMeta?.id ? accountDetail : null;

  const {
    accountFilter,
    accountManageMode,
    availableSortOptions,
    completedCount,
    effectiveSortMode,
    filteredAccounts,
    maxPrimaryMetric,
    pendingCount,
    selectAccount,
    selectVideo,
    selectedAccountIds,
    selectedVideo,
    selectedVideoIds,
    selectedVideoOpenUrl,
    setAccountFilter,
    setAccountManageMode,
    setSelectedAccountIds,
    setSelectedVideoIds,
    setSortMode,
    setVideoManageMode,
    sortedVideos,
    totalTranscriptCount,
    toggleAccountManage,
    toggleManagedAccount,
    toggleVideoManage,
    videoManageMode
  } = useLibrarySelection({
    accounts,
    selectedAccount,
    selectedAccountMeta,
    selectedVideoId,
    setSelectedAccountId,
    setSelectedVideoId
  });
  const accountFilterHasNoMatch = Boolean(accountFilter.trim() && !filteredAccounts.length);
  const visibleSelectedAccountMeta = accountFilterHasNoMatch ? null : selectedAccountMeta;
  const visibleSelectedAccount = accountFilterHasNoMatch ? null : selectedAccount;
  const visibleSelectedVideo = accountFilterHasNoMatch ? null : selectedVideo;
  const visibleSortedVideos = accountFilterHasNoMatch ? [] : sortedVideos;

  const openTranscriptEditor = useCallback(() => setOpenModal("transcript"), []);
  const closeDeleteDialog = useCallback(() => setDeleteTarget(""), []);
  const closeEditorModal = useCallback(() => setOpenModal(""), []);
  const requestDeleteAccounts = useCallback(() => setDeleteTarget("accounts"), []);
  const requestDeleteVideos = useCallback(() => setDeleteTarget("videos"), []);

  const {
    activeTranscript,
    clearTranscript,
    handleSaveTranscript,
    openTranscriptModal,
    selectedVideoHasTranscript,
    setTranscript,
    setTranscriptVideoId,
    transcriptLoading,
    transcriptPreview,
    updateTranscriptDraft
  } = useLibraryTranscriptActions({
    refresh,
    reloadSelectedAccountDetail,
    selectedAccount,
    selectedVideo,
    setMessage,
    onOpenEditor: openTranscriptEditor,
    onSaved: closeEditorModal
  });

  const {
    busy,
    setActiveBatchJobId,
    setActiveStyleJobId,
    setActiveTranscribeJobId,
    setBusy,
    setStyleProgress,
    setStyleStage,
    setTranscribeProgress,
    setTranscribeStage,
    styleProgress,
    styleStage,
    transcribeProgress,
    transcribeStage
  } = useLibraryTaskEffects({
    activeJobs,
    recentJobs,
    reloadSelectedAccountDetail,
    selectedAccount,
    selectedVideo,
    setAccountDetail,
    setMessage,
    setStyleDraft,
    setTranscript,
    setTranscriptVideoId
  });

  const { generateBatchStyle, handleGenerateStyle, handleTranscribe } = useLibraryTaskActions({
    batchLimit,
    refresh,
    reloadSelectedAccountDetail,
    selectedAccount,
    selectedVideo,
    setActiveBatchJobId,
    setActiveStyleJobId,
    setActiveTranscribeJobId,
    setBusy,
    setMessage,
    setStyleProgress,
    setStyleStage,
    setTranscribeProgress,
    setTranscribeStage,
    startTask
  });

  const {
    handleDeleteSelectedAccounts,
    handleDeleteSelectedVideos,
    handleSaveStyle
  } = useLibraryMutations({
    clearTranscript,
    closeDeleteDialog,
    refresh,
    reloadSelectedAccountDetail,
    selectedAccount,
    selectedAccountIds,
    selectedVideo,
    selectedVideoIds,
    setAccountDetail,
    setAccountManageMode,
    setBusy,
    setMessage,
    setSelectedAccountId,
    setSelectedAccountIds,
    setSelectedVideoId,
    setSelectedVideoIds,
    setVideoManageMode,
    styleDraft
  });

  const selectedVideoIdForTable = visibleSelectedVideo?.id || "";
  const styleLoaded = Boolean(selectedAccount && (typeof selectedAccount.style === "string" || styleDraft));
  const stylePreview = useMemo(() => makePreview(styleDraft || selectedAccount?.style || ""), [selectedAccount?.style, styleDraft]);
  const visibleActiveTranscript = accountFilterHasNoMatch ? "" : activeTranscript;
  const visibleSelectedVideoHasTranscript = accountFilterHasNoMatch ? false : selectedVideoHasTranscript;
  const visibleTranscriptPreview = accountFilterHasNoMatch ? "" : transcriptPreview;
  const visibleStyleLoaded = accountFilterHasNoMatch ? false : styleLoaded;
  const visibleStylePreview = accountFilterHasNoMatch ? "" : stylePreview;
  const visibleMessage = message && message !== error ? message : "";
  const visibleMessageIsError = isErrorMessage(visibleMessage);
  const stats: LibraryStats = useMemo(() => {
    const videoCount = accounts.reduce((sum, account) => sum + account.videoCount, 0);
    const transcriptCount = accounts.reduce((sum, account) => sum + account.transcriptCount, 0);
    return {
      accountCount: accounts.length,
      videoCount,
      transcriptCount,
      copySourceCount: library?.copySources.length || 0,
      projectCount: library?.projects.length || 0,
      draftCount: library?.drafts.length || 0
    };
  }, [accounts, library?.copySources.length, library?.drafts.length, library?.projects.length]);
  const collectDateFilter = useMemo(() => getDateFilter(collectTimeRange, customFromDate, customToDate), [
    collectTimeRange,
    customFromDate,
    customToDate
  ]);
  const activeTimeLabel = formatTimeRangeLabel(collectTimeRange, collectDateFilter.fromDate, collectDateFilter.toDate);
  const activeOrderOptions = collectOrderOptions[collectPlatform];
  const canCollect = Boolean(collectName.trim()) && !busy && !healthBusy;

  useBilibiliStatsHydration({ refresh, reloadSelectedAccountDetail, selectedAccount });
  useRestoreFocus(Boolean(openModal), editModalRef);

  useEffect(() => {
    if (!visibleMessage || isTaskProgressMessage(visibleMessage)) return;
    notify({
      tone: visibleMessageIsError ? "error" : "success",
      message: visibleMessage,
      action: lastCollect && visibleMessage.startsWith("采集完成") && !visibleMessageIsError ? { label: "整理账号", href: "/library" } : undefined
    });
  }, [lastCollect, notify, visibleMessage, visibleMessageIsError]);

  useEffect(() => {
    if (!selectedAccount) return;
    setStyleDraft(typeof selectedAccount.style === "string" ? selectedAccount.style : "");
  }, [selectedAccount]);

  const openStyleModal = useCallback(async () => {
    if (!selectedAccountDetailId || !selectedAccountDetailPlatform) return;
    if (typeof selectedAccount?.style === "string") {
      setStyleDraft(selectedAccount.style);
      setOpenModal("style");
      return;
    }

    setStyleLoading(true);
    setMessage("");
    try {
      const detail = await reloadSelectedAccountDetail({ includeStyle: true });
      if (!detail) return;
      setStyleDraft(detail.style || "");
      setOpenModal("style");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "读取账号风格卡失败");
    } finally {
      setStyleLoading(false);
    }
  }, [
    reloadSelectedAccountDetail,
    selectedAccount?.style,
    selectedAccountDetailId,
    selectedAccountDetailPlatform
  ]);

  const saveTranscriptDraft = useCallback(() => {
    void handleSaveTranscript(setBusy);
  }, [handleSaveTranscript, setBusy]);

  const handleCollectPlatformChange = useCallback((nextPlatform: Platform) => {
    setCollectPlatform(nextPlatform);
    setCollectOrder((currentOrder) =>
      collectOrderOptions[nextPlatform].some((option) => option.value === currentOrder)
        ? currentOrder
        : collectOrderOptions[nextPlatform][0].value
    );
  }, []);

  const handleHealthCheck = useCallback(async () => {
    setHealthBusy(true);
    setMessage("");
    setLastCollect(null);
    try {
      setHealth(await getHealth());
      setMessage("环境检查完成。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "环境检查失败，请确认 opencli、模型或飞书配置后重试。");
    } finally {
      setHealthBusy(false);
    }
  }, []);

  const handleCollect = useCallback(async () => {
    if (!canCollect) return;
    setBusy("collect");
    setMessage("");
    setLastCollect(null);
    try {
      const result = await collectAccount({
        platform: collectPlatform,
        name: collectName,
        limit: collectLimit,
        order: collectOrder,
        ...collectDateFilter
      });
      setLastCollect(result);
      setMessage(formatCollectMessage(result, activeTimeLabel, collectOrder));
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "采集失败，请检查账号名、主页链接或 opencli 配置后重试。");
    } finally {
      setBusy("");
    }
  }, [
    activeTimeLabel,
    canCollect,
    collectDateFilter,
    collectLimit,
    collectName,
    collectOrder,
    collectPlatform,
    refresh,
    setBusy
  ]);

  const handleExportTranscripts = useCallback(async () => {
    if (!selectedAccount) return;
    setBusy("export-transcripts");
    setMessage("");
    try {
      const result = await exportAccountTranscripts({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id
      });
      setMessage(`已导出 ${result.transcriptCount} 份转写稿：${result.fileName}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "导出转写稿失败");
    } finally {
      setBusy("");
    }
  }, [selectedAccount, setBusy]);

  if (!loading && !library?.accounts.length) {
    return (
      <div className="page library-page">
        <header className="page-header">
          <div className="page-title-group">
            <span className="page-title-eyebrow">账号资产</span>
            <div className="page-title-row">
              <span className="page-title-mark" aria-hidden="true">
                <FileText size={20} strokeWidth={2.1} />
              </span>
              <div className="page-title-copy">
                <h1>账号风格库</h1>
              </div>
            </div>
          </div>
        </header>
        <LibraryQuickStartPanel
          activeOrderOptions={activeOrderOptions}
          busy={healthBusy ? "health" : busy}
          canSubmit={canCollect}
          customFromDate={customFromDate}
          customToDate={customToDate}
          health={health}
          limit={collectLimit}
          name={collectName}
          order={collectOrder}
          platform={collectPlatform}
          stats={stats}
          timeRange={collectTimeRange}
          onCollect={handleCollect}
          onCustomFromDateChange={setCustomFromDate}
          onCustomToDateChange={setCustomToDate}
          onHealthCheck={handleHealthCheck}
          onLimitChange={setCollectLimit}
          onNameChange={setCollectName}
          onOrderChange={setCollectOrder}
          onPlatformChange={handleCollectPlatformChange}
          onTimeRangeChange={setCollectTimeRange}
        />
        <EmptyState title="还没有账号" body="在上方添加 B站或抖音账号并采集，采集结果会自动写入本地风格库。" />
      </div>
    );
  }

  return (
    <div className="page library-page">
      <header className="page-header">
        <div className="page-title-group">
          <span className="page-title-eyebrow">内容资料库</span>
          <div className="page-title-row">
            <span className="page-title-mark" aria-hidden="true">
              <FileText size={20} strokeWidth={2.1} />
            </span>
            <div className="page-title-copy">
              <h1>账号风格库</h1>
              <p className="subtle">采集、转写、风格沉淀。</p>
            </div>
          </div>
        </div>
        <div className="page-header-meta">
          <span className="stat-pill">{accounts.length} 个账号</span>
          <span className="stat-pill">{stats.transcriptCount} 份转写</span>
          <button className="btn ghost" onClick={() => void refresh()} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            刷新
          </button>
        </div>
      </header>

      <LibraryQuickStartPanel
        activeOrderOptions={activeOrderOptions}
        busy={healthBusy ? "health" : busy}
        canSubmit={canCollect}
        customFromDate={customFromDate}
        customToDate={customToDate}
        health={health}
        limit={collectLimit}
        name={collectName}
        order={collectOrder}
        platform={collectPlatform}
        stats={stats}
        timeRange={collectTimeRange}
        onCollect={handleCollect}
        onCustomFromDateChange={setCustomFromDate}
        onCustomToDateChange={setCustomToDate}
        onHealthCheck={handleHealthCheck}
        onLimitChange={setCollectLimit}
        onNameChange={setCollectName}
        onOrderChange={setCollectOrder}
        onPlatformChange={handleCollectPlatformChange}
        onTimeRangeChange={setCollectTimeRange}
      />
      {error ? <div className="error" role="alert">{error}</div> : null}
      {accountDetailError ? <div className="error" role="alert">{accountDetailError}</div> : null}
      <section className="panel three-pane library-workspace">
        <AccountSidebar
          accountFilter={accountFilter}
          accountManageMode={accountManageMode}
          accounts={filteredAccounts}
          allAccountCount={accounts.length}
          busy={busy}
          selectedAccountId={visibleSelectedAccountMeta?.id || ""}
          selectedAccountIds={selectedAccountIds}
          totalTranscriptCount={totalTranscriptCount}
          onAccountFilterChange={setAccountFilter}
          onRequestDeleteAccounts={requestDeleteAccounts}
          onSelectAccount={selectAccount}
          onToggleAccountManage={toggleAccountManage}
          onToggleManagedAccount={toggleManagedAccount}
        />

        <VideoTable
          accountDetailLoading={accountDetailLoading}
          availableSortOptions={availableSortOptions}
          busy={busy}
          completedCount={completedCount}
          effectiveSortMode={effectiveSortMode}
          maxPrimaryMetric={maxPrimaryMetric}
          pendingCount={pendingCount}
          selectedAccount={visibleSelectedAccount}
          selectedAccountMeta={visibleSelectedAccountMeta}
          selectedVideoId={selectedVideoIdForTable}
          selectedVideoIds={selectedVideoIds}
          videos={visibleSortedVideos}
          videoManageMode={videoManageMode}
          onRequestDeleteVideos={requestDeleteVideos}
          onSelectVideo={selectVideo}
          onSortModeChange={setSortMode}
          onToggleVideoManage={toggleVideoManage}
        />

        <LibraryDetailPane
          activeTranscript={visibleActiveTranscript}
          busy={busy}
          selectedAccount={visibleSelectedAccount}
          selectedVideo={visibleSelectedVideo}
          selectedVideoHasTranscript={visibleSelectedVideoHasTranscript}
          selectedVideoOpenUrl={selectedVideoOpenUrl}
          stylePreview={visibleStylePreview}
          styleLoaded={visibleStyleLoaded}
          styleLoading={styleLoading}
          transcriptLoading={transcriptLoading}
          transcriptPreview={visibleTranscriptPreview}
          transcribeProgress={transcribeProgress}
          transcribeStage={transcribeStage}
          onExportTranscripts={handleExportTranscripts}
          onGenerateBatchStyle={generateBatchStyle}
          onOpenStyleModal={openStyleModal}
          onOpenTranscriptModal={openTranscriptModal}
          onTranscribe={handleTranscribe}
        />
      </section>

      {openModal === "transcript" ? (
        <TranscriptEditorModal
          activeTranscript={activeTranscript}
          busy={busy}
          panelRef={editModalRef}
          onChange={updateTranscriptDraft}
          onClose={closeEditorModal}
          onSave={saveTranscriptDraft}
        />
      ) : null}
      {openModal === "style" ? (
        <AccountStyleEditorModal
          busy={busy}
          panelRef={editModalRef}
          styleDraft={styleDraft}
          styleProgress={styleProgress}
          styleStage={styleStage}
          onChange={setStyleDraft}
          onClose={closeEditorModal}
          onGenerateStyle={handleGenerateStyle}
          onSaveStyle={handleSaveStyle}
        />
      ) : null}
      {deleteTarget === "accounts" ? (
        <ConfirmDialog
          body={`会删除 ${selectedAccountIds.length} 个账号的本地资料、视频记录和转写稿。`}
          busy={busy === "account-delete"}
          confirmLabel="删除账号"
          title="确认删除账号？"
          onCancel={closeDeleteDialog}
          onConfirm={handleDeleteSelectedAccounts}
        />
      ) : null}
      {deleteTarget === "videos" ? (
        <ConfirmDialog
          body={`会删除 ${selectedVideoIds.length} 条视频记录，并同步删除对应转写稿。`}
          busy={busy === "video-delete"}
          confirmLabel="删除视频"
          title="确认删除视频？"
          onCancel={closeDeleteDialog}
          onConfirm={handleDeleteSelectedVideos}
        />
      ) : null}
    </div>
  );
}

function isErrorMessage(message: string) {
  return ["失败", "没有", "未配置", "未找到", "未更新", "无法", "异常", "超时"].some((keyword) => message.includes(keyword));
}

function formatCollectMessage(
  result: Awaited<ReturnType<typeof collectAccount>>,
  activeTimeLabel: string,
  order: CollectOrder
) {
  const base = `采集完成：opencli 返回 ${result.rawCount} 条，${activeTimeLabel}内写入 ${result.filteredCount} 条到「${result.account.name}」。`;
  const filter = result.dateFilter;
  if (!filter?.applied || result.filteredCount > 0 || result.rawCount === 0) return base;

  const dateRange =
    filter.earliestPublishedAt && filter.latestPublishedAt
      ? `本次返回视频发布时间为 ${filter.earliestPublishedAt} 至 ${filter.latestPublishedAt}`
      : filter.missingDateCount
        ? `本次返回的视频有 ${filter.missingDateCount} 条缺少发布时间`
        : "本次返回视频不在所选时间范围内";
  const orderHint = order === "pubdate" ? "" : "，或把排序改成「时间优先」";
  return `${base} ${dateRange}，都不在当前时间范围内；请把时间改成「不限」/更早的范围${orderHint}后再采集。`;
}
