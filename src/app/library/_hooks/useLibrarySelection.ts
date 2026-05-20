"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { formatPlatform } from "@/components/Formatters";
import type { AccountDetail, AccountListItem, VideoListItem } from "@/lib/types";
import {
  getAvailableSortOptions,
  getPrimaryMetric,
  getVideoOpenUrl,
  type VideoSortMode
} from "../_components/library-view-utils";

type UseLibrarySelectionInput = {
  accounts: AccountListItem[];
  selectedAccount: AccountDetail | null;
  selectedAccountMeta: AccountListItem | null;
  selectedVideoId: string;
  setSelectedAccountId: Dispatch<SetStateAction<string>>;
  setSelectedVideoId: Dispatch<SetStateAction<string>>;
};

export function useLibrarySelection({
  accounts,
  selectedAccount,
  selectedAccountMeta,
  selectedVideoId,
  setSelectedAccountId,
  setSelectedVideoId
}: UseLibrarySelectionInput) {
  const [sortMode, setSortMode] = useState<VideoSortMode>("hot");
  const [accountFilter, setAccountFilter] = useState("");
  const [accountManageMode, setAccountManageMode] = useState(false);
  const [videoManageMode, setVideoManageMode] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);

  const filteredAccounts = useMemo(() => {
    const keyword = accountFilter.trim().toLowerCase();
    if (!keyword) return accounts;
    return accounts.filter((account) => {
      const haystack = `${account.name} ${formatPlatform(account.platform)} ${account.uid}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [accountFilter, accounts]);

  const availableSortOptions = useMemo(() => getAvailableSortOptions(selectedAccount?.platform), [selectedAccount?.platform]);
  const effectiveSortMode = selectedAccount?.platform === "douyin" && sortMode === "views" ? "hot" : sortMode;
  const sortedVideos = useMemo(() => {
    const videos = [...(selectedAccount?.videos || [])];
    return videos.sort(getVideoSorter(effectiveSortMode));
  }, [effectiveSortMode, selectedAccount?.videos]);

  const selectedVideo = useMemo(() => {
    const first = sortedVideos[0];
    return sortedVideos.find((video) => video.id === selectedVideoId) || first || null;
  }, [selectedVideoId, sortedVideos]);

  const selectedVideoOpenUrl = useMemo(() => getVideoOpenUrl(selectedVideo), [selectedVideo]);
  const maxPrimaryMetric = useMemo(() => Math.max(...sortedVideos.map((video) => getPrimaryMetric(video).sortValue), 1), [sortedVideos]);
  const completedCount = sortedVideos.filter((video) => video.transcriptStatus === "completed").length;
  const pendingCount = sortedVideos.length - completedCount;
  const totalTranscriptCount = useMemo(
    () => accounts.reduce((sum, account) => sum + account.transcriptCount, 0),
    [accounts]
  );

  useEffect(() => {
    setSelectedVideoIds([]);
    setVideoManageMode(false);
  }, [selectedAccount?.id]);

  const toggleManagedAccount = useCallback((accountId: string) => {
    setSelectedAccountIds((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
    );
  }, []);

  const toggleManagedVideo = useCallback((videoId: string) => {
    setSelectedVideoIds((current) =>
      current.includes(videoId) ? current.filter((id) => id !== videoId) : [...current, videoId]
    );
  }, []);

  const selectVideo = useCallback((videoId: string) => {
    if (videoManageMode) {
      toggleManagedVideo(videoId);
      return;
    }
    setSelectedVideoId(videoId);
  }, [setSelectedVideoId, toggleManagedVideo, videoManageMode]);

  const selectAccount = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
    setSelectedVideoId("");
  }, [setSelectedAccountId, setSelectedVideoId]);

  const toggleAccountManage = useCallback(() => {
    setAccountManageMode((current) => !current);
    setVideoManageMode(false);
    setSelectedAccountIds([]);
    setSelectedVideoIds([]);
  }, []);

  const toggleVideoManage = useCallback(() => {
    setVideoManageMode((current) => !current);
    setAccountManageMode(false);
    setSelectedAccountIds([]);
    setSelectedVideoIds([]);
  }, []);

  return {
    accountFilter,
    accountManageMode,
    availableSortOptions,
    completedCount,
    effectiveSortMode,
    filteredAccounts,
    maxPrimaryMetric,
    pendingCount,
    selectAccount,
    selectedAccountIds,
    selectedAccountMeta,
    selectedVideo,
    selectedVideoIds,
    selectedVideoOpenUrl,
    setAccountFilter,
    setAccountManageMode,
    setSelectedAccountId,
    setSelectedAccountIds,
    setSelectedVideoId,
    setSelectedVideoIds,
    setSortMode,
    setVideoManageMode,
    sortedVideos,
    totalTranscriptCount,
    toggleAccountManage,
    toggleManagedAccount,
    toggleVideoManage,
    videoManageMode,
    selectVideo
  };
}

function getVideoSorter(sortMode: VideoSortMode) {
  const sorters: Record<VideoSortMode, (a: VideoListItem, b: VideoListItem) => number> = {
    hot: (a, b) => b.hotScore - a.hotScore,
    views: (a, b) => b.stats.views - a.stats.views,
    likes: (a, b) => b.stats.likes - a.stats.likes,
    comments: (a, b) => b.stats.comments - a.stats.comments,
    favorites: (a, b) => b.stats.favorites - a.stats.favorites,
    latest: (a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0)
  };

  return sorters[sortMode];
}
