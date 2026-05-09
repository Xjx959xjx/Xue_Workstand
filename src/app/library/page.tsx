"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { formatDateWithYear, formatNumber, formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { StatusPill } from "@/components/StatusPill";
import {
  batchTranscribe,
  createAccount,
  deleteAccounts,
  deleteTranscript,
  generateStyle,
  getTranscript,
  hydrateVideo,
  saveTranscript,
  saveStyle,
  transcribeVideo
} from "@/lib/client";
import { Platform } from "@/lib/types";

type BatchLimit = 3 | 5 | 10 | "all";

export default function LibraryPage() {
  const { library, loading, error, refresh } = useLibrary();
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [styleDraft, setStyleDraft] = useState("");
  const [transcript, setTranscript] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [sortMode, setSortMode] = useState<"hot" | "views" | "likes" | "comments" | "favorites" | "latest">("hot");
  const [batchLimit, setBatchLimit] = useState<BatchLimit>(5);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [openModal, setOpenModal] = useState<"" | "transcript" | "style">("");
  const [hydratedStatsAccounts, setHydratedStatsAccounts] = useState<string[]>([]);
  const [accountManageMode, setAccountManageMode] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState("");
  const [newAccountPlatform, setNewAccountPlatform] = useState<Platform>("bilibili");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountUidOrUrl, setNewAccountUidOrUrl] = useState("");

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
    return videos.sort(sorters[sortMode]);
  }, [selectedAccount?.videos, sortMode]);

  const selectedVideo = useMemo(() => {
    const first = sortedVideos[0];
    return sortedVideos.find((video) => video.id === selectedVideoId) || first || null;
  }, [selectedVideoId, sortedVideos]);

  const transcriptPreview = useMemo(() => makePreview(transcript), [transcript]);
  const stylePreview = useMemo(() => makePreview(styleDraft || selectedAccount?.style || ""), [selectedAccount?.style, styleDraft]);
  const maxViews = useMemo(() => Math.max(...sortedVideos.map((video) => video.stats.views || 0), 1), [sortedVideos]);
  const accountCompletion = selectedAccount?.videoCount
    ? Math.round((selectedAccount.transcriptCount / selectedAccount.videoCount) * 100)
    : 0;
  const completedCount = sortedVideos.filter((video) => video.transcriptStatus === "completed").length;
  const pendingCount = sortedVideos.length - completedCount;

  useEffect(() => {
    if (selectedAccount) setStyleDraft(selectedAccount.style);
  }, [selectedAccount]);

  useEffect(() => {
    if (busy !== "batch-style") return;

    const timer = window.setInterval(() => {
      setTranscribeProgress((current) => {
        if (current >= 92) return current;
        const step = current < 36 ? 5 : current < 72 ? 3 : 1;
        return Math.min(current + step, 92);
      });
    }, 650);

    return () => window.clearInterval(timer);
  }, [busy]);

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
      if (!selectedAccount || !selectedVideo || selectedVideo.transcriptStatus !== "completed") return;
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
    try {
      const result = await generateStyle(selectedAccount.platform, selectedAccount.id);
      setStyleDraft(result.style);
      setMessage(result.fallback ? "已用本地模板生成风格卡，可继续编辑。" : "已自动总结风格卡。");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "自动总结失败");
    } finally {
      setBusy("");
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
    setMessage("");
    try {
      setTranscribeProgress(35);
      await transcribeVideo({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoId: selectedVideo.id,
        allowRemoteDownload: true
      });
      setTranscribeProgress(85);
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
      }, 400);
    }
  }

  async function handleBatchTranscribe(updateStyle = false) {
    if (!selectedAccount) return;
    setBusy(updateStyle ? "batch-style" : "batch");
    setTranscribeProgress(8);
    setMessage("");
    try {
      setTranscribeProgress(25);
      const result = await batchTranscribe({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        limit: batchLimit,
        updateStyle
      });
      setTranscribeProgress(80);
      if (result.style) setStyleDraft(result.style);
      const baseMessage = `批量转写完成：新增转写 ${result.completed}，跳过 ${result.skipped}，失败 ${result.failed}。`;
      if (!updateStyle) {
        setMessage(baseMessage);
      } else if (result.styleUpdated) {
        setMessage(`${baseMessage} 风格卡已同步更新。`);
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
      }, 400);
    }
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
    const confirmed = window.confirm(`确认删除 ${selectedAccountIds.length} 个账号？本地账号资料和转写稿会一起删除。`);
    if (!confirmed) return;
    setBusy("account-delete");
    setMessage("");
    try {
      const result = await deleteAccounts(selectedAccountIds);
      if (selectedAccount && selectedAccountIds.includes(selectedAccount.id)) {
        setSelectedAccountId("");
        setSelectedVideoId("");
      }
      setSelectedAccountIds([]);
      setMessage(`已删除 ${result.deleted.length} 个账号。`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除账号失败");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteTranscript() {
    if (!selectedAccount || !selectedVideo) return;
    const confirmed = window.confirm("确认删除当前视频的转写稿？视频记录会保留，状态会恢复为未采集。");
    if (!confirmed) return;
    setBusy("delete-transcript");
    setMessage("");
    try {
      await deleteTranscript({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoId: selectedVideo.id
      });
      setTranscript("");
      setMessage("转写稿已删除。");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除转写稿失败");
    } finally {
      setBusy("");
    }
  }

  function toggleManagedAccount(accountId: string) {
    setSelectedAccountIds((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
    );
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

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className={isErrorMessage(message) ? "error" : "notice"}>{message}</div> : null}

      <section className="panel three-pane library-workspace">
        <aside className="pane">
          <div className="pane-header">
            <h2>账号</h2>
            <div className="account-manage-actions">
              <button className="btn icon-btn" onClick={() => setAccountModalOpen(true)} title="添加账号" type="button">
                <Plus size={15} />
                添加
              </button>
              <button
                className={`btn icon-btn ${accountManageMode ? "primary" : ""}`}
                onClick={() => {
                  setAccountManageMode((current) => !current);
                  setSelectedAccountIds([]);
                }}
                title="管理账号"
                type="button"
              >
                管理
              </button>
            </div>
          </div>
          {accountManageMode ? (
            <div className="account-manage-bar">
              <span>已选 {selectedAccountIds.length}</span>
              <button
                className="btn danger"
                disabled={!selectedAccountIds.length || busy === "account-delete"}
                onClick={handleDeleteSelectedAccounts}
                type="button"
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>
          ) : null}
          <div className="pane-search">
            <input
              aria-label="搜索账号"
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

        <section className="pane">
          <div className="pane-header video-pane-header">
            <div>
              <h2>{selectedAccount?.name || "视频"}</h2>
              <p className="pane-subtitle">
                {sortedVideos.length} 条视频 · {completedCount} 已转写 · {pendingCount} 待处理
              </p>
            </div>
            <div className="field sort-field">
              <label>排序</label>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}>
                <option value="hot">综合热度</option>
                <option value="views">播放最多</option>
                <option value="likes">点赞最多</option>
                <option value="comments">评论最多</option>
                <option value="favorites">收藏最多</option>
                <option value="latest">发布时间</option>
              </select>
            </div>
          </div>
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
                {sortedVideos.map((video) => (
                  <tr
                    className={selectedVideo?.id === video.id ? "active" : ""}
                    key={video.id}
                    onClick={() => setSelectedVideoId(video.id)}
                  >
                    <td>
                      <span className="video-title-line">
                        <strong>{video.title}</strong>
                        <span className="metric-mini">热度 {Math.round(video.hotScore)}</span>
                      </span>
                      <span className="list-meta">
                        {formatDateWithYear(video.publishedAt)} · 高于均值 {video.relativeViewRate || 0}x
                      </span>
                    </td>
                    <td className="metric performance-metric">
                      <span className="metric-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(4, Math.round(((video.stats.views || 0) / maxViews) * 100))}%` }} />
                      </span>
                      <span className="performance-stack">
                        <span className="metric-item primary">
                          <span>播放</span>
                          <strong>{formatNumber(video.stats.views)}</strong>
                        </span>
                        <span className="metric-item">
                          <span>点赞</span>
                          <strong>{formatNumber(video.stats.likes)}</strong>
                        </span>
                        <span className="metric-item">
                          <span>评论</span>
                          <strong>{formatNumber(video.stats.comments)}</strong>
                        </span>
                      </span>
                    </td>
                    <td>
                      <StatusPill status={video.transcriptStatus} />
                    </td>
                  </tr>
                ))}
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
                <span className="list-progress large" aria-label={`账号转写覆盖 ${accountCompletion}%`}>
                  <span style={{ width: `${accountCompletion}%` }} />
                </span>
              </div>
            ) : null}
            {selectedVideo ? (
              <div className="detail-section">
                <h3>{selectedVideo.title}</h3>
                <div className="stat-row">
                  <span className="stat-pill">播放 {formatNumber(selectedVideo.stats.views)}</span>
                  <span className="stat-pill">点赞 {formatNumber(selectedVideo.stats.likes)}</span>
                  <span className="stat-pill">收藏 {formatNumber(selectedVideo.stats.favorites)}</span>
                  <StatusPill status={selectedVideo.transcriptStatus} />
                </div>
                <div className="button-row detail-action-row">
                  <button className="btn" disabled={busy === "transcribe"} onClick={handleTranscribe} type="button">
                    <RefreshCw size={16} />
                    {busy === "transcribe" ? "转写中..." : "转写此视频"}
                  </button>
                  {selectedVideo.url ? (
                    <a className="btn" href={selectedVideo.url} target="_blank">
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
                  <label>爆款数量</label>
                  <select
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
            </div>

            <div className="compact-card">
              <div>
                <h3>转写稿</h3>
                <p>{transcriptPreview || (selectedVideo?.transcriptStatus === "completed" ? "转写稿为空。" : "当前视频还没有转写稿。")}</p>
              </div>
              <div className="button-row">
                <button
                  className="btn"
                  disabled={!selectedVideo || (selectedVideo.transcriptStatus !== "completed" && !transcript)}
                  onClick={() => setOpenModal("transcript")}
                  type="button"
                >
                  <Eye size={16} />
                  查看全文
                </button>
                {accountManageMode ? (
                  <button
                    className="btn danger"
                    disabled={!selectedVideo || (selectedVideo.transcriptStatus !== "completed" && !transcript) || busy === "delete-transcript"}
                    onClick={handleDeleteTranscript}
                    type="button"
                  >
                    <Trash2 size={16} />
                    {busy === "delete-transcript" ? "删除中..." : "删除转写稿"}
                  </button>
                ) : null}
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
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <div className="modal-header">
              <h2>{openModal === "transcript" ? "转写稿全文" : "账号风格卡"}</h2>
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
                <textarea value={styleDraft || selectedAccount?.style || ""} onChange={(event) => setStyleDraft(event.target.value)} />
                <div className="button-row">
                  <button className="btn" disabled={busy === "style"} onClick={handleGenerateStyle} type="button">
                    <Sparkles size={16} />
                    自动总结
                  </button>
                  <button className="btn primary" disabled={busy === "save-style"} onClick={handleSaveStyle} type="button">
                    <Save size={16} />
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {accountModalOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel account-modal">
            <div className="modal-header">
              <h2>添加账号</h2>
              <button className="btn" onClick={() => setAccountModalOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="modal-editor">
              <div className="form-grid">
                <div className="field">
                  <label>平台</label>
                  <select value={newAccountPlatform} onChange={(event) => setNewAccountPlatform(event.target.value as Platform)}>
                    <option value="bilibili">B站</option>
                    <option value="douyin">抖音</option>
                  </select>
                </div>
                <div className="field">
                  <label>账号名</label>
                  <input value={newAccountName} onChange={(event) => setNewAccountName(event.target.value)} placeholder="例如：老青椒" />
                </div>
              </div>
              <div className="field">
                <label>UID 或主页链接</label>
                <input
                  value={newAccountUidOrUrl}
                  onChange={(event) => setNewAccountUidOrUrl(event.target.value)}
                  placeholder="B站可留空自动搜索；抖音建议填写 sec_uid 或主页链接"
                />
              </div>
              <div className="button-row">
                <button className="btn primary" disabled={!newAccountName.trim() || busy === "account-create"} onClick={handleCreateAccount} type="button">
                  <Plus size={16} />
                  {busy === "account-create" ? "添加中..." : "添加账号"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function makePreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 72);
}

function isErrorMessage(message: string) {
  return ["失败", "没有", "未配置", "未找到", "未更新"].some((keyword) => message.includes(keyword));
}
