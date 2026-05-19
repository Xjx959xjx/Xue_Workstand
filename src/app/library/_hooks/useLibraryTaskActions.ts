"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { BatchLimit } from "../_components/library-view-utils";
import type { AccountDetail, JobRecord, JobStartInput, VideoListItem } from "@/lib/types";

type ReloadAccountDetail = (options?: { includeStyle?: boolean; force?: boolean }) => Promise<AccountDetail | null>;

type UseLibraryTaskActionsInput = {
  batchLimit: BatchLimit;
  refresh: () => Promise<void>;
  reloadSelectedAccountDetail: ReloadAccountDetail;
  selectedAccount: AccountDetail | null;
  selectedVideo: VideoListItem | null;
  setActiveBatchJobId: Dispatch<SetStateAction<string>>;
  setActiveStyleJobId: Dispatch<SetStateAction<string>>;
  setActiveTranscribeJobId: Dispatch<SetStateAction<string>>;
  setBusy: (value: string) => void;
  setMessage: Dispatch<SetStateAction<string>>;
  setStyleProgress: Dispatch<SetStateAction<number>>;
  setStyleStage: Dispatch<SetStateAction<string>>;
  setTranscribeProgress: Dispatch<SetStateAction<number>>;
  setTranscribeStage: Dispatch<SetStateAction<string>>;
  startTask: (input: JobStartInput) => Promise<JobRecord>;
};

export function useLibraryTaskActions({
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
}: UseLibraryTaskActionsInput) {
  const handleGenerateStyle = useCallback(async () => {
    if (!selectedAccount) return;
    setBusy("style");
    setMessage("");
    setStyleProgress(8);
    setStyleStage("正在读取账号转写样本");
    try {
      const job = await startTask({
        kind: "account-style",
        title: "生成账号风格卡",
        inputSummary: selectedAccount.name,
        href: "/library",
        input: {
          platform: selectedAccount.platform,
          accountId: selectedAccount.id
        }
      });
      setActiveStyleJobId(job.id);
      setStyleStage(job.message);
      setStyleProgress(job.progress);
      setMessage("账号风格卡已在后台开始生成，可以切换到其他模块。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "自动总结失败");
    }
  }, [selectedAccount, setActiveStyleJobId, setBusy, setMessage, setStyleProgress, setStyleStage, startTask]);

  const handleTranscribe = useCallback(async () => {
    if (!selectedAccount || !selectedVideo) return;
    setBusy("transcribe");
    setTranscribeProgress(12);
    setTranscribeStage("正在检查字幕和媒体");
    setMessage("");
    try {
      const job = await startTask({
        kind: "transcribe-video",
        title: "转写视频",
        inputSummary: selectedVideo.title,
        href: "/library",
        input: {
          platform: selectedAccount.platform,
          accountId: selectedAccount.id,
          videoId: selectedVideo.id,
          allowRemoteDownload: true
        }
      });
      setActiveTranscribeJobId(job.id);
      setTranscribeStage(job.message);
      setTranscribeProgress(job.progress);
      setMessage("转写稿已在后台开始生成，可以切换到其他模块。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "转写失败");
      await refresh();
      await reloadSelectedAccountDetail({ force: true });
    }
  }, [
    refresh,
    reloadSelectedAccountDetail,
    selectedAccount,
    selectedVideo,
    setActiveTranscribeJobId,
    setBusy,
    setMessage,
    setTranscribeProgress,
    setTranscribeStage,
    startTask
  ]);

  const handleBatchTranscribe = useCallback(async (updateStyle = false) => {
    if (!selectedAccount) return;
    setBusy(updateStyle ? "batch-style" : "batch");
    setTranscribeProgress(8);
    setTranscribeStage("正在读取候选视频");
    setMessage("");
    try {
      const job = await startTask({
        kind: "batch-transcribe",
        title: updateStyle ? "批量转写并更新风格" : "批量转写",
        inputSummary: `${selectedAccount.name} · ${batchLimit === "all" ? "全部视频" : `${batchLimit} 条视频`}`,
        href: "/library",
        input: {
          platform: selectedAccount.platform,
          accountId: selectedAccount.id,
          limit: batchLimit,
          updateStyle
        }
      });
      setActiveBatchJobId(job.id);
      setTranscribeStage(job.message);
      setTranscribeProgress(job.progress);
      setMessage("批量转写已在后台开始，可以切换到其他模块。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "批量转写失败");
      await refresh();
      await reloadSelectedAccountDetail({ force: true });
    }
  }, [
    batchLimit,
    refresh,
    reloadSelectedAccountDetail,
    selectedAccount,
    setActiveBatchJobId,
    setBusy,
    setMessage,
    setTranscribeProgress,
    setTranscribeStage,
    startTask
  ]);

  const generateBatchStyle = useCallback(() => {
    void handleBatchTranscribe(true);
  }, [handleBatchTranscribe]);

  return {
    generateBatchStyle,
    handleGenerateStyle,
    handleTranscribe
  };
}
