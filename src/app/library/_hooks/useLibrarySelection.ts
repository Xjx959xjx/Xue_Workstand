"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatPlatform } from "@/components/Formatters";
import type { AccountDetail, AccountListItem, VideoListItem } from "@/lib/types";
import { getPrimaryMetric, getVideoOpenUrl, type VideoSortMode } from "../_components/library-view-utils";

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sortMode, setSortMode] = useState<VideoSortMode>(() => parseVideoSortMode(searchParams.get("sort")));
  const [accountFilter, setAccountFilter] = useState(() => searchParams.get("q") || "");
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

  const effectiveSortMode = resolveEffectiveVideoSortMode(sortMode, selectedAccount?.platform);
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const trimmedFilter = accountFilter.trim();
    if (trimmedFilter) {
      params.set("q", trimmedFilter);
    } else {
      params.delete("q");
    }
    if (sortMode === "hot") {
      params.delete("sort");
    } else {
      params.set("sort", sortMode);
    }
    const query = params.toString();
    const nextHref = query ? `${pathname}?${query}` : pathname;
    if (`${window.location.pathname}${window.location.search}` !== nextHref) {
      router.replace(nextHref, { scroll: false });
    }
  }, [accountFilter, pathname, router, sortMode]);

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

const videoTitleCollator = new Intl.Collator("zh-Hans-CN", {
  numeric: true,
  sensitivity: "base"
});

const videoSortModes: VideoSortMode[] = ["hot", "title", "views", "likes", "comments", "favorites", "latest"];

function parseVideoSortMode(value: string | null): VideoSortMode {
  return videoSortModes.includes(value as VideoSortMode) ? (value as VideoSortMode) : "hot";
}

function resolveEffectiveVideoSortMode(sortMode: VideoSortMode, platform?: AccountDetail["platform"]): VideoSortMode {
  if (platform === "douyin") {
    return sortMode === "views" ? "hot" : sortMode;
  }

  return sortMode === "hot" ? "views" : sortMode;
}

function getVideoSorter(sortMode: VideoSortMode) {
  const sorters: Record<VideoSortMode, (a: VideoListItem, b: VideoListItem) => number> = {
    hot: (a, b) => b.hotScore - a.hotScore,
    title: (a, b) => videoTitleCollator.compare(a.title, b.title),
    views: (a, b) => b.stats.views - a.stats.views,
    likes: (a, b) => b.stats.likes - a.stats.likes,
    comments: (a, b) => b.stats.comments - a.stats.comments,
    favorites: (a, b) => b.stats.favorites - a.stats.favorites,
    latest: (a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0)
  };

  return sorters[sortMode];
}
