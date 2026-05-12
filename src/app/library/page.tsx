"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Eye, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { formatDateWithYear, formatNumber, formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { StatusPill } from "@/components/StatusPill";
import {
  createAccount,
  deleteAccounts,
  deleteVideos,
  getTranscript,
  hydrateVideo,
  saveTranscript,
  saveStyle,
  streamBatchTranscribe,
  streamGenerateStyle,
  transcribeVideo
} from "@/lib/client";
import type { StyleGenerationResponse } from "@/lib/client";
import { BatchTranscribeResult, Platform, Video } from "@/lib/types";
import { buildDouyinVideoUrl, extractDouyinAwemeId, isLikelyDirectMediaUrl } from "@/lib/utils";

type BatchLimit = 3 | 5 | 10 | "all";
type VideoSortMode = "hot" | "views" | "likes" | "comments" | "favorites" | "latest";

const BILIBILI_HOT_SCORE_FORMULA = "热度 = 播放 + 点赞×20 + 评论×60 + 收藏×80 + 分享×50";
const DOUYIN_HOT_SCORE_FORMULA = "热度 = 点赞×20 + 评论×60 + 收藏×80 + 分享×50";
const VIDEO_SORT_OPTIONS: Array<{ value: VideoSortMode; label: string }> = [
  { value: "hot", label: "综合热度" },
  { value: "views", label: "播放最多" },
  { value: "likes", label: "点赞最多" },
  { value: "comments", label: "评论最多" },
  { value: "favorites", label: "收藏最多" },
  { value: "latest", label: "发布时间" }
];

function canReadTranscript(video: Pick<Video, "transcriptStatus" | "transcriptPath"> | null) {
  return Boolean(video?.transcriptPath) || video?.transcriptStatus === "completed";
}

function getVideoOpenUrl(video: Video | null) {
  if (!video?.url) return "";
  if (video.platform !== "douyin") return video.url;
  if (!isLikelyDirectMediaUrl(video.url)) return video.url;

  const raw = video.raw && typeof video.raw === "object" ? (video.raw as Record<string, unknown>) : {};
  return (
    buildDouyinVideoUrl(
      extractDouyinAwemeId(video.id) ||
        extractDouyinAwemeId(String(raw.aweme_id || raw.id || ""))
    ) || video.url
  );
}

export default function LibraryPage() {
  const { library, loading, error, refresh } = useLibrary();
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [styleDraft, setStyleDraft] = useState("");
  const [transcript, setTranscript] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [sortMode, setSortMode] = useState<VideoSortMode>("hot");
  const [batchLimit, setBatchLimit] = useState<BatchLimit>(5);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcribeStage, setTranscribeStage] = useState("");
  const [styleProgress, setStyleProgress] = useState(0);
  const [styleStage, setStyleStage] = useState("");
  const [openModal, setOpenModal] = useState<"" | "transcript" | "style">("");
  const [hydratedStatsAccounts, setHydratedStatsAccounts] = useState<string[]>([]);
  const [accountManageMode, setAccountManageMode] = useState(false);
  const [videoManageMode, setVideoManageMode] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<"" | "accounts" | "videos">("");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState("");
  const [newAccountPlatform, setNewAccountPlatform] = useState<Platform>("bilibili");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountUidOrUrl, setNewAccountUidOrUrl] = useState("");
  const editModalRef = useRef<HTMLDivElement>(null);
  const accountModalRef = useRef<HTMLDivElement>(null);

  const selectedAccount = useMemo(() => {
    const first = library?.accounts[0];
    return library?.accounts.find((account) => account.id === selectedAccountId) || first || null;
  }, [library?.accounts, selectedAccountId]);

  const filteredAccounts = useMemo(() => {
    const keyword = accountFilter.trim().toLowerCase();
    const accounts = library?.accounts || [];
    if (!keyword) return accounts;
    return accounts.filter((account) => {
      const haystack = `${account.name} ${formatPlatform(account.platform)} ${account.uid}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [accountFilter, library?.accounts]);

  const availableSortOptions = useMemo(
    () => VIDEO_SORT_OPTIONS.filter((option) => !(selectedAccount?.platform === "douyin" && option.value === "views")),
    [selectedAccount?.platform]
  );
  const effectiveSortMode = selectedAccount?.platform === "douyin" && sortMode === "views" ? "hot" : sortMode;
  const hotScoreFormula = selectedAccount?.platform === "douyin" ? DOUYIN_HOT_SCORE_FORMULA : BILIBILI_HOT_SCORE_FORMULA;

  const sortedVideos = useMemo(() => {
    const videos = [...(selectedAccount?.videos || [])];
    const sorters = {
      hot: (a: typeof videos[number], b: typeof videos[number]) => b.hotScore - a.hotScore,
      views: (a: typeof videos[number], b: typeof videos[number]) => b.stats.views - a.stats.views,
      likes: (a: typeof videos[number], b: typeof videos[number]) => b.stats.likes - a.stats.likes,
      comments: (a: typeof videos[number], b: typeof videos[number]) => b.stats.comments - a.stats.comments,
      favorites: (a: typeof videos[number], b: typeof videos[number]) => b.stats.favorites - a.stats.favorites,
      latest: (a: typeof videos[number], b: typeof videos[number]) =>
        +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0)
    };
    return videos.sort(sorters[effectiveSortMode]);
  }, [effectiveSortMode, selectedAccount?.videos]);

  const selectedVideo = useMemo(() => {
    const first = sortedVideos[0];
    return sortedVideos.find((video) => video.id === selectedVideoId) || first || null;
  }, [selectedVideoId, sortedVideos]);
  const selectedVideoOpenUrl = useMemo(() => getVideoOpenUrl(selectedVideo), [selectedVideo]);

  const transcriptPreview = useMemo(() => makePreview(transcript), [transcript]);
  const stylePreview = useMemo(() => makePreview(styleDraft || selectedAccount?.style || ""), [selectedAccount?.style, styleDraft]);
  const maxPrimaryMetric = useMemo(() => Math.max(...sortedVideos.map((video) => getPrimaryMetric(video).sortValue), 1), [sortedVideos]);
  const accountCompletion = selectedAccount?.videoCount
    ? Math.round((selectedAccount.transcriptCount / selectedAccount.videoCount) * 100)
    : 0;
  const completedCount = sortedVideos.filter((video) => video.transcriptStatus === "completed").length;
  const pendingCount = sortedVideos.length - completedCount;
  const selectedVideoHasTranscript = canReadTranscript(selectedVideo);
  const selectedVideoPrimaryMetric = selectedVideo ? getPrimaryMetric(selectedVideo) : null;
  const visibleMessage = message && message !== error ? message : "";
  const visibleMessageIsError = isErrorMessage(visibleMessage);
  const editModalTitle = openModal === "transcript" ? "转写稿全文" : "账号风格卡";

  useEffect(() => {
    if (selectedAccount) setStyleDraft(selectedAccount.style);
  }, [selectedAccount]);

  useEffect(() => {
    if (!openModal) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    editModalRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [openModal]);

  useEffect(() => {
    if (!accountModalOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    accountModalRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [accountModalOpen]);

  useEffect(() => {
    setSelectedVideoIds([]);
    setVideoManageMode(false);
  }, [selectedAccount?.id]);

  useEffect(() => {
    if (!selectedAccount || selectedAccount.platform !== "bilibili") return;
    if (hydratedStatsAccounts.includes(selectedAccount.id)) return;

    const missingStats = selectedAccount.videos
      .filter((video) => video.stats.likes === 0 || video.stats.comments === 0 || video.stats.favorites === 0)
      .slice(0, 10);
    if (!missingStats.length) return;

    let ignore = false;
    setHydratedStatsAccounts((current) => (current.includes(selectedAccount.id) ? current : [...current, selectedAccount.id]));
    Promise.allSettled(
      missingStats.map((video) =>
        hydrateVideo({
          platform: selectedAccount.platform,
          accountId: selectedAccount.id,
          videoId: video.id
        })
      )
    ).then(async () => {
      if (!ignore) await refresh();
    });

    return () => {
      ignore = true;
    };
  }, [hydratedStatsAccounts, refresh, selectedAccount]);

  useEffect(() => {
    let ignore = false;

    async function loadTranscript() {
      setTranscript("");
      if (!selectedAccount || !selectedVideo || !canReadTranscript(selectedVideo)) return;
      try {
        const result = await getTranscript({
          platform: selectedAccount.platform,
          accountId: selectedAccount.id,
          videoId: selectedVideo.id
        });
        if (!ignore) setTranscript(result.transcript);
      } catch {
        if (!ignore) setTranscript("");
      }
    }

    loadTranscript();
    return () => {
      ignore = true;
    };
  }, [selectedAccount, selectedVideo]);

  async function handleGenerateStyle() {
    if (!selectedAccount) return;
    setBusy("style");
    setMessage("");
    setStyleProgress(8);
    setStyleStage("正在读取账号转写样本");
    try {
      const result = await new Promise<StyleGenerationResponse>(
        async (resolve, reject) => {
          let streamed = "";
          try {
            await streamGenerateStyle({
              platform: selectedAccount.platform,
              accountId: selectedAccount.id
            }, {
              onStage(stage) {
                setStyleProgress(stage.progress || 0);
                setStyleStage(stage.message);
              },
              onDelta(delta) {
                streamed += delta;
                setStyleDraft(streamed);
                const nextProgress = Math.min(88, 45 + Math.floor(streamed.length / 80));
                setStyleProgress((current) => Math.max(current, nextProgress));
              },
              onResult(result) {
                setStyleProgress(100);
                setStyleStage("风格卡已生成");
                resolve(result);
              }
            });
          } catch (error) {
            reject(error);
          }
        }
      );
      setStyleDraft(result.style);
      setMessage(
        result.fallback
          ? `已降级生成风格卡：${result.fallbackReason || "模型没有返回可用内容，已用本地模板生成，可继续编辑。"}`
          : "已自动总结风格卡。"
      );
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "自动总结失败");
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setStyleProgress(0);
        setStyleStage("");
      }, 400);
    }
  }

  async function handleSaveStyle() {
    if (!selectedAccount) return;
    setBusy("save-style");
    setMessage("");
    try {
      await saveStyle(selectedAccount.platform, selectedAccount.id, styleDraft);
      setMessage("风格卡已保存。");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  async function handleSaveTranscript() {
    if (!selectedAccount || !selectedVideo) return;
    setBusy("save-transcript");
    setMessage("");
    try {
      const result = await saveTranscript({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoId: selectedVideo.id,
        transcript
      });
      setTranscript(result.transcript);
      setMessage("转写稿已保存。");
      setOpenModal("");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存转写稿失败");
    } finally {
      setBusy("");
    }
  }

  async function handleTranscribe() {
    if (!selectedAccount || !selectedVideo) return;
    setBusy("transcribe");
    setTranscribeProgress(12);
    setTranscribeStage("正在检查字幕和媒体");
    setMessage("");
    try {
      setTranscribeProgress(35);
      setTranscribeStage("正在转写视频");
      await transcribeVideo({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoId: selectedVideo.id,
        allowRemoteDownload: true
      });
      setTranscribeProgress(85);
      setTranscribeStage("正在保存转写结果");
      setMessage("转写完成。");
      await refresh();
      setTranscribeProgress(100);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "转写失败");
      await refresh();
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setTranscribeProgress(0);
        setTranscribeStage("");
      }, 400);
    }
  }

  async function handleBatchTranscribe(updateStyle = false) {
    if (!selectedAccount) return;
    setBusy(updateStyle ? "batch-style" : "batch");
    setTranscribeProgress(8);
    setTranscribeStage("正在读取候选视频");
    setMessage("");
    try {
      const result = await new Promise<BatchTranscribeResult>(async (resolve, reject) => {
        try {
          await streamBatchTranscribe({
            platform: selectedAccount.platform,
            accountId: selectedAccount.id,
            limit: batchLimit,
            updateStyle
          }, {
            onStage(stage) {
              setTranscribeProgress(stage.progress || 0);
              setTranscribeStage(stage.message);
            },
            onVideo(video) {
              setTranscribeStage(`已处理：${video.title}`);
            },
            onResult(result) {
              setTranscribeProgress(100);
              setTranscribeStage("批量任务已完成");
              resolve(result);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
      if (result.style) setStyleDraft(result.style);
      const timingSummary = summarizeBatchTranscribeTimings(result);
      const baseMessage = `批量转写完成：新增转写 ${result.completed}，跳过 ${result.skipped}，失败 ${result.failed}。${timingSummary ? ` ${timingSummary}` : ""}`;
      if (!updateStyle) {
        setMessage(baseMessage);
      } else if (result.styleUpdated) {
        setMessage(
          result.fallback
            ? `${baseMessage} 风格卡已降级更新：${result.fallbackReason || "模型没有返回可用内容，已用本地模板生成，可继续编辑。"}`
            : `${baseMessage} 风格卡已同步更新。`
        );
      } else if (result.styleError) {
        setMessage(`${baseMessage} 风格卡未更新：${result.styleError}`);
      } else {
        setMessage(`${baseMessage} 风格卡未更新。`);
      }
      await refresh();
      setTranscribeProgress(100);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "批量转写失败");
      await refresh();
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setTranscribeProgress(0);
        setTranscribeStage("");
      }, 400);
    }
  }

  function summarizeBatchTranscribeTimings(result: BatchTranscribeResult) {
    const transcribeTotal = result.timings?.find((item) => item.stage === "transcribe-phase-total")?.ms;
    const mediaPreload = result.timings?.find((item) => item.stage === "douyin-preload-media")?.ms;
    const completedTimings = result.results
      .map((item) => item.timings?.find((timing) => timing.stage === "total")?.ms || 0)
      .filter((ms) => ms > 0);
    const maxVideoMs = completedTimings.length ? Math.max(...completedTimings) : 0;
    const parts = [
      transcribeTotal ? `转写阶段 ${formatDuration(transcribeTotal)}` : "",
      mediaPreload ? `媒体预取 ${formatDuration(mediaPreload)}` : "",
      maxVideoMs ? `最慢单条 ${formatDuration(maxVideoMs)}` : ""
    ].filter(Boolean);
    return parts.length ? `耗时：${parts.join("，")}。` : "";
  }

  function formatDuration(ms: number) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
  }

  async function handleCreateAccount() {
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
      setNewAccountName("");
      setNewAccountUidOrUrl("");
      setAccountModalOpen(false);
      setMessage("账号已添加。");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "添加账号失败");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteSelectedAccounts() {
    if (!selectedAccountIds.length) return;
    setBusy("account-delete");
    setMessage("");
    try {
      const result = await deleteAccounts(selectedAccountIds);
      if (selectedAccount && selectedAccountIds.includes(selectedAccount.id)) {
        setSelectedAccountId("");
        setSelectedVideoId("");
      }
      setSelectedAccountIds([]);
      setSelectedVideoIds([]);
      setAccountManageMode(false);
      setDeleteTarget("");
      setMessage(`已删除 ${result.deleted.length} 个账号。`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除账号失败");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteSelectedVideos() {
    if (!selectedAccount || !selectedVideoIds.length) return;
    setBusy("video-delete");
    setMessage("");
    try {
      const result = await deleteVideos({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoIds: selectedVideoIds
      });
      if (selectedVideo && selectedVideoIds.includes(selectedVideo.id)) {
        setSelectedVideoId("");
        setTranscript("");
      }
      setSelectedVideoIds([]);
      setVideoManageMode(false);
      setDeleteTarget("");
      setMessage(`已删除 ${result.deleted.length} 条视频。`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除视频失败");
    } finally {
      setBusy("");
    }
  }

  function toggleManagedAccount(accountId: string) {
    setSelectedAccountIds((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
    );
  }

  function toggleManagedVideo(videoId: string) {
    setSelectedVideoIds((current) =>
      current.includes(videoId) ? current.filter((id) => id !== videoId) : [...current, videoId]
    );
  }

  function selectVideo(videoId: string) {
    if (videoManageMode) {
      toggleManagedVideo(videoId);
      return;
    }
    setSelectedVideoId(videoId);
  }

  if (!loading && !library?.accounts.length) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Library</p>
            <h1>账号风格库</h1>
          </div>
        </header>
        <EmptyState title="还没有账号" body="先在首页添加 B站或抖音账号并采集，采集结果会自动写入本地风格库。" />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Library</p>
          <h1>账号风格库</h1>
          <p className="subtle">左侧选账号，中间看爆款，右侧整理转写稿与风格卡。</p>
        </div>
        <div className="button-row">
          <button className="btn" onClick={refresh} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {visibleMessage ? (
        <div aria-live={visibleMessageIsError ? "assertive" : "polite"} className={visibleMessageIsError ? "error" : "notice"} role={visibleMessageIsError ? "alert" : "status"}>
          {visibleMessage}
        </div>
      ) : null}

      <section className="panel three-pane library-workspace">
        <aside className={`pane ${accountManageMode ? "selection-mode" : ""}`}>
          <div className="pane-header">
            <h2>账号</h2>
            <div className="account-manage-actions">
              {!accountManageMode ? (
                <button className="btn icon-btn" onClick={() => setAccountModalOpen(true)} title="添加账号" type="button">
                  <Plus size={15} />
                  添加
                </button>
              ) : null}
              <button
                className={`btn icon-btn ${accountManageMode ? "primary" : ""}`}
                onClick={() => {
                  setAccountManageMode((current) => !current);
                  setVideoManageMode(false);
                  setSelectedAccountIds([]);
                  setSelectedVideoIds([]);
                }}
                title="管理账号"
                type="button"
              >
                {accountManageMode ? "完成" : "管理"}
              </button>
            </div>
          </div>
          {accountManageMode ? (
            <div className="selection-toolbar" role="toolbar" aria-label="账号批量操作">
              <div className="selection-copy">
                <strong>账号选择</strong>
                <span>已选 {selectedAccountIds.length} 个</span>
              </div>
              <button
                className="btn danger"
                disabled={!selectedAccountIds.length || busy === "account-delete"}
                onClick={() => setDeleteTarget("accounts")}
                type="button"
              >
                <Trash2 size={14} />
                删除账号
              </button>
            </div>
          ) : null}
          <div className="pane-search">
            <input
              aria-label="搜索账号"
              autoComplete="off"
              name="accountFilter"
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
              placeholder="搜索账号名、平台或 UID"
            />
          </div>
          <div className="pane-body">
            <div className="status-summary">
              <span>{filteredAccounts.length} / {library?.accounts.length || 0} 个账号</span>
              <span>{library?.accounts.reduce((sum, account) => sum + account.transcriptCount, 0) || 0} 份转写</span>
            </div>
            {filteredAccounts.map((account) => {
              const completion = account.videoCount ? Math.round((account.transcriptCount / account.videoCount) * 100) : 0;
              return (
                <button
                  aria-current={!accountManageMode && selectedAccount?.id === account.id ? "true" : undefined}
                  aria-pressed={accountManageMode ? selectedAccountIds.includes(account.id) : undefined}
                  className={`list-button account-list-button ${selectedAccount?.id === account.id ? "active" : ""} ${
                    accountManageMode && selectedAccountIds.includes(account.id) ? "checked" : ""
                  }`}
                  key={account.id}
                  onClick={() => {
                    if (accountManageMode) {
                      toggleManagedAccount(account.id);
                      return;
                    }
                    setSelectedAccountId(account.id);
                    setSelectedVideoId("");
                    setStyleDraft(account.style);
                  }}
                  type="button"
                >
                  {accountManageMode ? (
                    <span className={`check-dot ${selectedAccountIds.includes(account.id) ? "checked" : ""}`} aria-hidden="true" />
                  ) : null}
                  <span>
                    <span className="list-title">{account.name}</span>
                    <span className="list-meta">
                      {formatPlatform(account.platform)} · {account.videoCount} 条 · {account.transcriptCount} 转写
                    </span>
                    <span className="list-progress" aria-label={`转写覆盖 ${completion}%`}>
                      <span style={{ width: `${completion}%` }} />
                    </span>
                  </span>
                </button>
              );
            })}
            {!filteredAccounts.length ? <p className="subtle">没有匹配的账号。</p> : null}
          </div>
        </aside>

        <section className={`pane ${videoManageMode ? "selection-mode" : ""}`}>
          <div className="pane-header video-pane-header">
            <div>
              <h2>{selectedAccount?.name || "视频"}</h2>
              <p className="pane-subtitle">
                {sortedVideos.length} 条视频 · {completedCount} 已完成 · {pendingCount} 未完成
              </p>
              <p className="pane-caption">{hotScoreFormula}</p>
            </div>
            <div className="video-header-tools">
              <div className="field sort-field">
                <label htmlFor="library-video-sort">排序</label>
                <select
                  id="library-video-sort"
                  name="videoSort"
                  value={effectiveSortMode}
                  onChange={(event) => setSortMode(event.target.value as VideoSortMode)}
                >
                  {availableSortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className={`btn icon-btn ${videoManageMode ? "primary" : ""}`}
                disabled={!selectedAccount}
                onClick={() => {
                  setVideoManageMode((current) => !current);
                  setAccountManageMode(false);
                  setSelectedAccountIds([]);
                  setSelectedVideoIds([]);
                }}
                title="管理视频"
                type="button"
              >
                {videoManageMode ? "完成" : "管理"}
              </button>
            </div>
          </div>
          {videoManageMode ? (
            <div className="selection-toolbar" role="toolbar" aria-label="视频批量操作">
              <div className="selection-copy">
                <strong>视频选择</strong>
                <span>已选 {selectedVideoIds.length} 条</span>
              </div>
              <button
                className="btn danger"
                disabled={!selectedVideoIds.length || busy === "video-delete"}
                onClick={() => setDeleteTarget("videos")}
                type="button"
              >
                <Trash2 size={14} />
                {busy === "video-delete" ? "删除中..." : "删除视频"}
              </button>
            </div>
          ) : null}
          <div className="pane-body">
            <table className="video-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>数据表现</th>
                  <th>转写</th>
                </tr>
              </thead>
              <tbody>
                {sortedVideos.map((video) => {
                  const checked = selectedVideoIds.includes(video.id);
                  const primaryMetric = getPrimaryMetric(video);
                  return (
                    <tr
                      className={videoManageMode ? (checked ? "checked" : "") : selectedVideo?.id === video.id ? "active" : ""}
                      key={video.id}
                    >
                      <td>
                        <button
                          aria-current={!videoManageMode && selectedVideo?.id === video.id ? "true" : undefined}
                          aria-pressed={videoManageMode ? checked : undefined}
                          className={`video-row-button ${videoManageMode ? "manage" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectVideo(video.id);
                          }}
                          type="button"
                        >
                          <span className={`video-title-cell ${videoManageMode ? "manage" : ""}`}>
                            {videoManageMode ? <span className={`check-dot ${checked ? "checked" : ""}`} aria-hidden="true" /> : null}
                            <span className="video-title-copy">
                              <span className="video-title-line">
                                <strong>{video.title}</strong>
                                <span className="metric-mini hot-score" title={buildHotScoreHint(video)}>
                                  热度 {formatInteger(video.hotScore)}
                                </span>
                              </span>
                              <span className="list-meta">
                                {getVideoMetaText(video)}
                              </span>
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="metric performance-metric">
                        <span className="metric-bar" aria-hidden="true">
                          <span style={{ width: `${Math.max(4, Math.round((primaryMetric.sortValue / maxPrimaryMetric) * 100))}%` }} />
                        </span>
                        <span className="performance-stack">
                          <span className="metric-item">
                            <span>点赞</span>
                            <strong>{formatNumber(video.stats.likes)}</strong>
                          </span>
                          <span className="metric-item">
                            <span>评论</span>
                            <strong>{formatNumber(video.stats.comments)}</strong>
                          </span>
                          <span className="metric-item">
                            <span>收藏</span>
                            <strong>{formatNumber(video.stats.favorites)}</strong>
                          </span>
                        </span>
                      </td>
                      <td>
                        <StatusPill status={video.transcriptStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="pane library-detail-pane">
          <div className="pane-header">
            <h2>详情与风格</h2>
          </div>
          <div className="pane-body detail-stack">
            {selectedAccount ? (
              <div className="detail-section account-health">
                <div className="section-title-row">
                  <h3>账号资产</h3>
                  <span className="status-pill done">{accountCompletion}% 覆盖</span>
                </div>
                <div className="stat-row">
                  <span className="stat-pill">{formatPlatform(selectedAccount.platform)}</span>
                  <span className="stat-pill">{selectedAccount.videoCount} 条视频</span>
                  <span className="stat-pill">{selectedAccount.transcriptCount} 份转写</span>
                </div>
              </div>
            ) : null}
            {selectedVideo ? (
              <div className="detail-section">
                <h3>{selectedVideo.title}</h3>
                <div className="stat-row">
                  {selectedVideoPrimaryMetric ? (
                    <span className="stat-pill" title={selectedVideoPrimaryMetric.title}>
                      {selectedVideoPrimaryMetric.label} {selectedVideoPrimaryMetric.value}
                    </span>
                  ) : null}
                  <span className="stat-pill">点赞 {formatNumber(selectedVideo.stats.likes)}</span>
                  <span className="stat-pill">收藏 {formatNumber(selectedVideo.stats.favorites)}</span>
                </div>
                <div className="button-row detail-action-row">
                  <button className="btn" disabled={busy === "transcribe"} onClick={handleTranscribe} type="button">
                    <RefreshCw size={16} />
                    {busy === "transcribe" ? "转写中..." : "转写此视频"}
                  </button>
                  {selectedVideoOpenUrl ? (
                    <a className="btn" href={selectedVideoOpenUrl} rel="noreferrer" target="_blank">
                      打开原链接
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="subtle">选择一个视频查看详情。</p>
            )}

            <div className="detail-section">
              <h3>账号自动化</h3>
              <div className={`automation-row compact ${busy === "batch-style" ? "running" : ""}`}>
                <div className="field compact-field">
                  <label htmlFor="batch-limit">爆款数量</label>
                  <select
                    id="batch-limit"
                    name="batchLimit"
                    value={batchLimit}
                    onChange={(event) =>
                      setBatchLimit(event.target.value === "all" ? "all" : (Number(event.target.value) as BatchLimit))
                    }
                  >
                    <option value={3}>前 3 条</option>
                    <option value={5}>前 5 条</option>
                    <option value={10}>前 10 条</option>
                    <option value="all">全部转写</option>
                  </select>
                </div>
                <button
                  className="btn primary progress-button"
                  disabled={busy === "batch-style"}
                  onClick={() => handleBatchTranscribe(true)}
                  type="button"
                >
                  <span className="progress-button-fill" style={{ width: `${busy === "batch-style" ? transcribeProgress : 0}%` }} />
                  <span className="progress-button-content">
                    <Sparkles size={16} />
                    {busy === "batch-style" ? `转写更新中 ${transcribeProgress}%` : "转写并更新风格"}
                  </span>
                </button>
              </div>
              {busy === "batch-style" || busy === "transcribe" ? <p className="subtle">{transcribeStage}</p> : null}
            </div>

            <div className="compact-card">
              <div>
                <h3>转写稿</h3>
                <p>{transcriptPreview || (selectedVideoHasTranscript ? "转写稿为空。" : "当前视频还没有转写稿。")}</p>
              </div>
              <div className="button-row">
                <button
                  className="btn"
                  disabled={!selectedVideo || (!selectedVideoHasTranscript && !transcript)}
                  onClick={() => setOpenModal("transcript")}
                  type="button"
                >
                  <Eye size={16} />
                  查看全文
                </button>
              </div>
            </div>

            <div className="compact-card">
              <div>
                <h3>账号风格卡</h3>
                <p>{stylePreview || "暂无风格卡"}</p>
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={() => setOpenModal("style")} type="button">
                  <Eye size={16} />
                  查看编辑
                </button>
              </div>
            </div>
          </div>
        </aside>
      </section>

      {openModal ? (
        <ModalDialog
          labelledBy="library-edit-modal-title"
          panelRef={editModalRef}
          onClose={() => setOpenModal("")}
        >
          <div className="modal-header">
            <h2 id="library-edit-modal-title">{editModalTitle}</h2>
            <button className="btn" onClick={() => setOpenModal("")} type="button">
              关闭
            </button>
          </div>
            {openModal === "transcript" ? (
              <div className="modal-editor">
                <textarea
                  aria-label="转写稿全文"
                  value={transcript}
                  onChange={(event) => setTranscript(event.target.value)}
                  placeholder="暂无转写稿。"
                />
                <div className="button-row">
                  <button
                    className="btn primary"
                    disabled={busy === "save-transcript"}
                    onClick={handleSaveTranscript}
                    type="button"
                  >
                    <Save size={16} />
                    保存转写稿
                  </button>
                </div>
              </div>
            ) : (
              <div className="modal-editor">
                <textarea aria-label="账号风格卡" value={styleDraft || selectedAccount?.style || ""} onChange={(event) => setStyleDraft(event.target.value)} />
                <div className="button-row">
                  <button className="btn progress-button" disabled={busy === "style"} onClick={handleGenerateStyle} type="button">
                    <span className="progress-button-fill" style={{ width: `${busy === "style" ? styleProgress : 0}%` }} />
                    <span className="progress-button-content">
                      <Sparkles size={16} />
                      {busy === "style" ? `自动总结中 ${styleProgress}%` : "自动总结"}
                    </span>
                  </button>
                  <button className="btn primary" disabled={busy === "save-style" || busy === "style"} onClick={handleSaveStyle} type="button">
                    <Save size={16} />
                    保存
                  </button>
                </div>
                {busy === "style" ? <p className="subtle">{styleStage}</p> : null}
              </div>
            )}
        </ModalDialog>
      ) : null}

      {accountModalOpen ? (
        <ModalDialog
          labelledBy="library-account-modal-title"
          panelClassName="account-modal"
          panelRef={accountModalRef}
          onClose={() => setAccountModalOpen(false)}
        >
          <div className="modal-header">
            <h2 id="library-account-modal-title">添加账号</h2>
            <button className="btn" onClick={() => setAccountModalOpen(false)} type="button">
              关闭
            </button>
          </div>
            <div className="modal-editor">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="new-account-platform">平台</label>
                  <select id="new-account-platform" name="platform" value={newAccountPlatform} onChange={(event) => setNewAccountPlatform(event.target.value as Platform)}>
                    <option value="bilibili">B站</option>
                    <option value="douyin">抖音</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="new-account-name">账号名</label>
                  <input
                    autoComplete="off"
                    id="new-account-name"
                    name="accountName"
                    value={newAccountName}
                    onChange={(event) => setNewAccountName(event.target.value)}
                    placeholder="例如：老青椒"
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="new-account-uid-or-url">UID 或主页链接</label>
                <input
                  autoComplete="off"
                  id="new-account-uid-or-url"
                  name="uidOrUrl"
                  value={newAccountUidOrUrl}
                  onChange={(event) => setNewAccountUidOrUrl(event.target.value)}
                  placeholder="可留空用 opencli 搜索；也可直接填写 UID / sec_uid / 主页链接"
                />
              </div>
              <div className="button-row">
                <button className="btn primary" disabled={!newAccountName.trim() || busy === "account-create"} onClick={handleCreateAccount} type="button">
                  <Plus size={16} />
                  {busy === "account-create" ? "添加中..." : "添加账号"}
                </button>
              </div>
            </div>
        </ModalDialog>
      ) : null}
      {deleteTarget === "accounts" ? (
        <ConfirmDialog
          body={`会删除 ${selectedAccountIds.length} 个账号的本地资料、视频记录和转写稿。`}
          busy={busy === "account-delete"}
          confirmLabel="删除账号"
          title="确认删除账号？"
          onCancel={() => setDeleteTarget("")}
          onConfirm={handleDeleteSelectedAccounts}
        />
      ) : null}
      {deleteTarget === "videos" ? (
        <ConfirmDialog
          body={`会删除 ${selectedVideoIds.length} 条视频记录，并同步删除对应转写稿。`}
          busy={busy === "video-delete"}
          confirmLabel="删除视频"
          title="确认删除视频？"
          onCancel={() => setDeleteTarget("")}
          onConfirm={handleDeleteSelectedVideos}
        />
      ) : null}
    </div>
  );
}

function makePreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 72);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value || 0));
}

function getVideoMetaText(video: Pick<Video, "platform" | "publishedAt" | "relativeViewRate">) {
  const dateText = formatDateWithYear(video.publishedAt);
  if (video.platform === "douyin") return dateText;
  return `${dateText} · 高于均值 ${video.relativeViewRate || 0}x`;
}

function getPrimaryMetric(video: Pick<Video, "platform" | "hotScore" | "stats">) {
  if (video.platform === "douyin") {
    return {
      label: "热度",
      value: formatNumber(Math.round(video.hotScore)),
      sortValue: Math.round(video.hotScore),
      title: buildHotScoreHint(video)
    };
  }

  return {
    label: "播放",
    value: formatNumber(video.stats.views),
    sortValue: video.stats.views,
    title: undefined
  };
}

function ModalDialog({
  children,
  labelledBy,
  onClose,
  panelClassName = "",
  panelRef
}: {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  panelClassName?: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="modal-backdrop">
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`modal-panel ${panelClassName}`}
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

function buildHotScoreHint(video: {
  platform?: Video["platform"];
  hotScore: number;
  stats: { views: number; likes: number; comments: number; favorites: number; shares?: number };
}) {
  if (video.platform === "douyin") {
    return `${DOUYIN_HOT_SCORE_FORMULA}\n当前视频：点赞 ${formatNumber(video.stats.likes)}×20 + 评论 ${formatNumber(video.stats.comments)}×60 + 收藏 ${formatNumber(video.stats.favorites)}×80 + 分享 ${formatNumber(video.stats.shares ?? 0)}×50 = ${Math.round(video.hotScore)}`;
  }

  return `${BILIBILI_HOT_SCORE_FORMULA}\n当前视频：播放 ${formatNumber(video.stats.views)} + 点赞 ${formatNumber(video.stats.likes)}×20 + 评论 ${formatNumber(video.stats.comments)}×60 + 收藏 ${formatNumber(video.stats.favorites)}×80 + 分享 ${formatNumber(video.stats.shares ?? 0)}×50 = ${Math.round(video.hotScore)}`;
}

function isErrorMessage(message: string) {
  return ["失败", "没有", "未配置", "未找到", "未更新", "无法", "异常", "超时"].some((keyword) => message.includes(keyword));
}
