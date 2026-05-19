"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import {
  createAccount,
  deleteAccounts,
  deleteVideos,
  saveStyle
} from "@/lib/client";
import { cachedGetAccountDetail, invalidateAccountDetail } from "@/lib/detail-cache";
import type { AccountDetail, Platform, VideoListItem } from "@/lib/types";

type ReloadAccountDetail = (options?: { includeStyle?: boolean; force?: boolean }) => Promise<AccountDetail | null>;

type UseLibraryMutationsInput = {
  clearTranscript: () => void;
  closeAccountModal: () => void;
  closeDeleteDialog: () => void;
  refresh: () => Promise<void>;
  reloadSelectedAccountDetail: ReloadAccountDetail;
  selectedAccount: AccountDetail | null;
  selectedAccountIds: string[];
  selectedVideo: VideoListItem | null;
  selectedVideoIds: string[];
  setAccountDetail: Dispatch<SetStateAction<AccountDetail | null>>;
  setAccountManageMode: Dispatch<SetStateAction<boolean>>;
  setBusy: (value: string) => void;
  setMessage: Dispatch<SetStateAction<string>>;
  setSelectedAccountId: Dispatch<SetStateAction<string>>;
  setSelectedAccountIds: Dispatch<SetStateAction<string[]>>;
  setSelectedVideoId: Dispatch<SetStateAction<string>>;
  setSelectedVideoIds: Dispatch<SetStateAction<string[]>>;
  setVideoManageMode: Dispatch<SetStateAction<boolean>>;
  styleDraft: string;
};

export function useLibraryMutations({
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
}: UseLibraryMutationsInput) {
  const [newAccountPlatform, setNewAccountPlatform] = useState<Platform>("bilibili");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountUidOrUrl, setNewAccountUidOrUrl] = useState("");

  const handleSaveStyle = useCallback(async () => {
    if (!selectedAccount) return;
    setBusy("save-style");
    setMessage("");
    try {
      await saveStyle(selectedAccount.platform, selectedAccount.id, styleDraft);
      setMessage("风格卡已保存。");
      await refresh();
      await reloadSelectedAccountDetail({ includeStyle: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy("");
    }
  }, [refresh, reloadSelectedAccountDetail, selectedAccount, setBusy, setMessage, styleDraft]);

  const handleCreateAccount = useCallback(async () => {
    if (!newAccountName.trim()) return;
    setBusy("account-create");
    setMessage("");
    try {
      const account = await createAccount({
        platform: newAccountPlatform,
        name: newAccountName,
        uidOrUrl: newAccountUidOrUrl || undefined
      });
      setSelectedAccountId(account.id);
      setSelectedVideoId("");
      setNewAccountName("");
      setNewAccountUidOrUrl("");
      closeAccountModal();
      setMessage("账号已添加。");
      await refresh();
      setAccountDetail(await cachedGetAccountDetail({ platform: account.platform, accountId: account.id, force: true }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "添加账号失败");
    } finally {
      setBusy("");
    }
  }, [
    closeAccountModal,
    newAccountName,
    newAccountPlatform,
    newAccountUidOrUrl,
    refresh,
    setAccountDetail,
    setBusy,
    setMessage,
    setSelectedAccountId,
    setSelectedVideoId
  ]);

  const handleDeleteSelectedAccounts = useCallback(async () => {
    if (!selectedAccountIds.length) return;
    const deletingSelectedAccount = Boolean(selectedAccount && selectedAccountIds.includes(selectedAccount.id));

    setBusy("account-delete");
    setMessage("");
    try {
      const result = await deleteAccounts(selectedAccountIds);
      selectedAccountIds.forEach((accountId) => {
        const [platform] = accountId.split(":") as [Platform, string];
        invalidateAccountDetail(platform, accountId);
      });
      if (deletingSelectedAccount) {
        setSelectedAccountId("");
        setSelectedVideoId("");
      }
      setSelectedAccountIds([]);
      setSelectedVideoIds([]);
      setAccountManageMode(false);
      closeDeleteDialog();
      setMessage(`已删除 ${result.deleted.length} 个账号。`);
      await refresh();
      if (deletingSelectedAccount) setAccountDetail(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除账号失败");
    } finally {
      setBusy("");
    }
  }, [
    closeDeleteDialog,
    refresh,
    selectedAccount,
    selectedAccountIds,
    setAccountDetail,
    setAccountManageMode,
    setBusy,
    setMessage,
    setSelectedAccountId,
    setSelectedAccountIds,
    setSelectedVideoId,
    setSelectedVideoIds
  ]);

  const handleDeleteSelectedVideos = useCallback(async () => {
    if (!selectedAccount || !selectedVideoIds.length) return;
    const deletingSelectedVideo = Boolean(selectedVideo && selectedVideoIds.includes(selectedVideo.id));

    setBusy("video-delete");
    setMessage("");
    try {
      const result = await deleteVideos({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoIds: selectedVideoIds
      });
      if (deletingSelectedVideo) {
        setSelectedVideoId("");
        clearTranscript();
      }
      setSelectedVideoIds([]);
      setVideoManageMode(false);
      closeDeleteDialog();
      setMessage(`已删除 ${result.deleted.length} 条视频。`);
      await refresh();
      await reloadSelectedAccountDetail();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除视频失败");
    } finally {
      setBusy("");
    }
  }, [
    clearTranscript,
    closeDeleteDialog,
    refresh,
    reloadSelectedAccountDetail,
    selectedAccount,
    selectedVideo,
    selectedVideoIds,
    setBusy,
    setMessage,
    setSelectedVideoId,
    setSelectedVideoIds,
    setVideoManageMode
  ]);

  return {
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
  };
}
