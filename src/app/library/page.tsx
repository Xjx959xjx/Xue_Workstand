"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AccountSidebar } from "./_components/AccountSidebar";
import { AccountStyleEditorModal } from "./_components/AccountStyleEditorModal";
import { LibraryAccountModal } from "./_components/LibraryAccountModal";
import { LibraryDetailPane } from "./_components/LibraryDetailPane";
import { TranscriptEditorModal } from "./_components/TranscriptEditorModal";
import { VideoTable } from "./_components/VideoTable";
import { makePreview, type BatchLimit } from "./_components/library-view-utils";
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
import { useTasks } from "@/components/TaskProvider";
import { isTaskProgressMessage } from "@/lib/feedback-messages";

export default function LibraryPage() {
  const { library, loading, error, refresh } = useLibrary();
  const { activeJobs, recentJobs, startTask } = useTasks();
  const { notify } = useFeedback();
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [styleDraft, setStyleDraft] = useState("");
  const [styleLoading, setStyleLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [batchLimit, setBatchLimit] = useState<BatchLimit>(5);
  const [openModal, setOpenModal] = useState<"" | "transcript" | "style">("");
  const [deleteTarget, setDeleteTarget] = useState<"" | "accounts" | "videos">("");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const editModalRef = useRef<HTMLDivElement>(null);
  const accountModalRef = useRef<HTMLDivElement>(null);

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
    selectedVideoViewCount,
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

  const openTranscriptEditor = useCallback(() => setOpenModal("transcript"), []);
  const openAccountModal = useCallback(() => setAccountModalOpen(true), []);
  const closeAccountModal = useCallback(() => setAccountModalOpen(false), []);
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
    handleCreateAccount,
    handleDeleteSelectedAccounts,
    handleDeleteSelectedVideos,
    handleSaveStyle,
    newAccountName,
    newAccountPlatform,
    newAccountUidOrUrl,
    setNewAccountName,
    setNewAccountPlatform,
    setNewAccountUidOrUrl
  } = useLibraryMutations({
    clearTranscript,
    closeAccountModal,
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

  const selectedVideoIdForTable = selectedVideo?.id || "";
  const styleLoaded = Boolean(selectedAccount && (typeof selectedAccount.style === "string" || styleDraft));
  const stylePreview = useMemo(() => makePreview(styleDraft || selectedAccount?.style || ""), [selectedAccount?.style, styleDraft]);
  const visibleMessage = message && message !== error ? message : "";
  const visibleMessageIsError = isErrorMessage(visibleMessage);

  useBilibiliStatsHydration({ refresh, reloadSelectedAccountDetail, selectedAccount });
  useRestoreFocus(Boolean(openModal), editModalRef);
  useRestoreFocus(accountModalOpen, accountModalRef);

  useEffect(() => {
    if (!visibleMessage || isTaskProgressMessage(visibleMessage)) return;
    notify({ tone: visibleMessageIsError ? "error" : "success", message: visibleMessage });
  }, [notify, visibleMessage, visibleMessageIsError]);

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

  if (!loading && !library?.accounts.length) {
    return (
      <div className="page library-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Library</p>
            <h1 className="title-with-emoji">
              <span aria-hidden="true" className="title-emoji">
                📚
              </span>
              <span>账号风格库</span>
            </h1>
          </div>
        </header>
        <EmptyState title="还没有账号" body="先在首页添加 B站或抖音账号并采集，采集结果会自动写入本地风格库。" />
      </div>
    );
  }

  return (
    <div className="page library-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Library</p>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              📚
            </span>
            <span>账号风格库</span>
          </h1>
          <p className="subtle">维护账号素材、转写稿和风格卡。</p>
        </div>
        <div className="button-row">
          <button className="btn" onClick={() => void refresh()} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            刷新
          </button>
        </div>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {accountDetailError ? <div className="error" role="alert">{accountDetailError}</div> : null}
      <section className="panel three-pane library-workspace">
        <AccountSidebar
          accountFilter={accountFilter}
          accountManageMode={accountManageMode}
          accounts={filteredAccounts}
          allAccountCount={accounts.length}
          busy={busy}
          selectedAccountId={selectedAccountMeta?.id || ""}
          selectedAccountIds={selectedAccountIds}
          totalTranscriptCount={totalTranscriptCount}
          onAccountFilterChange={setAccountFilter}
          onOpenAccountModal={openAccountModal}
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
          selectedAccount={selectedAccount}
          selectedAccountMeta={selectedAccountMeta}
          selectedVideoId={selectedVideoIdForTable}
          selectedVideoIds={selectedVideoIds}
          videos={sortedVideos}
          videoManageMode={videoManageMode}
          onRequestDeleteVideos={requestDeleteVideos}
          onSelectVideo={selectVideo}
          onSortModeChange={setSortMode}
          onToggleVideoManage={toggleVideoManage}
        />

        <LibraryDetailPane
          activeTranscript={activeTranscript}
          batchLimit={batchLimit}
          busy={busy}
          selectedAccount={selectedAccount}
          selectedVideo={selectedVideo}
          selectedVideoHasTranscript={selectedVideoHasTranscript}
          selectedVideoOpenUrl={selectedVideoOpenUrl}
          selectedVideoViewCount={selectedVideoViewCount}
          stylePreview={stylePreview}
          styleLoaded={styleLoaded}
          styleLoading={styleLoading}
          transcriptLoading={transcriptLoading}
          transcriptPreview={transcriptPreview}
          transcribeProgress={transcribeProgress}
          transcribeStage={transcribeStage}
          onBatchLimitChange={setBatchLimit}
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
      {accountModalOpen ? (
        <LibraryAccountModal
          busy={busy}
          newAccountName={newAccountName}
          newAccountPlatform={newAccountPlatform}
          newAccountUidOrUrl={newAccountUidOrUrl}
          panelRef={accountModalRef}
          onClose={closeAccountModal}
          onCreateAccount={handleCreateAccount}
          onNewAccountNameChange={setNewAccountName}
          onNewAccountPlatformChange={setNewAccountPlatform}
          onNewAccountUidOrUrlChange={setNewAccountUidOrUrl}
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
