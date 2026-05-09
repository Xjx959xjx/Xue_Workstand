"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpenText,
  FileText,
  Layers3,
  MessageSquareText,
  Play,
  RefreshCw,
  Settings2
} from "lucide-react";
import { useLibrary } from "@/components/LibraryProvider";
import { formatDate, formatPlatform } from "@/components/Formatters";
import { collectAccount, getHealth } from "@/lib/client";
import { Platform } from "@/lib/types";

const entries = [
  {
    href: "/library",
    title: "账号风格库",
    body: "管理平台、账号、爆款视频、转写稿和可编辑风格卡。",
    action: "查看账号库",
    icon: BookOpenText
  },
  {
    href: "/projects",
    title: "项目库",
    body: "把多个账号合并成项目风格卡，适合矩阵账号和长期选题。",
    action: "管理项目",
    icon: Layers3
  },
  {
    href: "/writer",
    title: "对话写作",
    body: "选择账号风格，按主题生成或改写已有文案。",
    action: "开始写文案",
    icon: MessageSquareText
  },
  {
    href: "/drafts",
    title: "草稿管理",
    body: "查看生成结果、引用账号、历史版本和可复用片段。",
    action: "查看草稿",
    icon: FileText
  }
];

type TimeRange = "all" | "7d" | "30d" | "90d" | "180d" | "365d" | "custom";

const timeRangeOptions: Array<{ value: TimeRange; label: string; days?: number }> = [
  { value: "all", label: "不限" },
  { value: "7d", label: "近 7 天", days: 7 },
  { value: "30d", label: "近 30 天", days: 30 },
  { value: "90d", label: "近 90 天", days: 90 },
  { value: "180d", label: "近半年", days: 180 },
  { value: "365d", label: "近一年", days: 365 },
  { value: "custom", label: "自定义" }
];

export default function HomePage() {
  const { library, loading, error, refresh } = useLibrary();
  const [platform, setPlatform] = useState<Platform>("bilibili");
  const [name, setName] = useState("");
  const [limit, setLimit] = useState(20);
  const [order, setOrder] = useState<"pubdate" | "click" | "stow">("click");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [customFromDate, setCustomFromDate] = useState("");
  const [customToDate, setCustomToDate] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [lastCollect, setLastCollect] = useState<Awaited<ReturnType<typeof collectAccount>> | null>(null);

  const stats = useMemo(() => {
    const accounts = library?.accounts || [];
    const videoCount = accounts.reduce((sum, account) => sum + account.videoCount, 0);
    const transcriptCount = accounts.reduce((sum, account) => sum + account.transcriptCount, 0);
    const readyAccountCount = accounts.filter((account) => account.transcriptCount > 0).length;
    const projectCount = library?.projects.length || 0;
    const draftCount = library?.drafts.length || 0;
    const transcriptRate = videoCount ? Math.round((transcriptCount / videoCount) * 100) : 0;
    return { accounts, accountCount: accounts.length, readyAccountCount, videoCount, transcriptCount, transcriptRate, projectCount, draftCount };
  }, [library]);

  const canWrite = stats.accountCount > 0;
  const canSubmit = Boolean(name.trim()) && !busy;
  const dateFilter = useMemo(() => getDateFilter(timeRange, customFromDate, customToDate), [
    customFromDate,
    customToDate,
    timeRange
  ]);
  const activeTimeLabel = formatTimeRangeLabel(timeRange, dateFilter.fromDate, dateFilter.toDate);

  async function handleHealthCheck() {
    setBusy("health");
    setMessage("");
    try {
      setHealth(await getHealth());
      setMessage("环境检查完成。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "环境检查失败");
    } finally {
      setBusy("");
    }
  }

  async function handleCollect() {
    if (!canSubmit) return;
    setBusy("collect");
    setMessage("");
    setLastCollect(null);
    try {
      const result = await collectAccount({ platform, name, limit, order, ...dateFilter });
      setLastCollect(result);
      setMessage(formatCollectMessage(result, activeTimeLabel, order));
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "采集失败");
    } finally {
      setBusy("");
    }
  }

  function entryStatus(title: string) {
    if (title === "账号风格库") return `${stats.accountCount} 个账号 · ${stats.videoCount} 条视频`;
    if (title === "项目库") return `${stats.projectCount} 个项目`;
    if (title === "对话写作") return canWrite ? "已有参考账号" : "先添加一个参考账号";
    return `${stats.draftCount} 个草稿`;
  }

  return (
    <div className="page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Local Workbench</p>
          <h1>工作台总览</h1>
          <p className="subtle">采集、转写、风格沉淀和写作都在本地流转，文件沉淀到 style-library。</p>
        </div>
        <div className="button-row">
          <button className="btn" disabled={loading} onClick={refresh} type="button">
            <RefreshCw size={16} />
            {loading ? "读取中" : "刷新数据"}
          </button>
        </div>
      </header>

      <section className="panel quick-start">
        <div className="quick-start-main">
          <div>
            <p className="eyebrow">Quick Start</p>
            <h2>快速开工</h2>
            <p className="subtle">输入账号名自动搜索并采集爆款；后续转写和风格整理会进入账号库。</p>
          </div>
          <div className="quick-form">
            <div className="field">
              <label>平台</label>
              <select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
                <option value="bilibili">B站</option>
                <option value="douyin">抖音</option>
              </select>
            </div>
            <div className="field">
              <label>账号名</label>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：某某UP主" />
            </div>
            <div className="field">
              <label>数量</label>
              <input
                min={1}
                max={50}
                type="number"
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label>排序</label>
              {platform === "bilibili" ? (
                <select value={order} onChange={(event) => setOrder(event.target.value as typeof order)}>
                  <option value="click">播放优先</option>
                  <option value="stow">收藏优先</option>
                  <option value="pubdate">最新优先</option>
                </select>
              ) : (
                <select disabled value="default">
                  <option value="default">默认排序</option>
                </select>
              )}
            </div>
            <div className="field">
              <label>时间</label>
              <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as TimeRange)}>
                {timeRangeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {timeRange === "custom" ? (
              <>
                <div className="field">
                  <label>开始日期</label>
                  <input type="date" value={customFromDate} onChange={(event) => setCustomFromDate(event.target.value)} />
                </div>
                <div className="field">
                  <label>结束日期</label>
                  <input type="date" value={customToDate} onChange={(event) => setCustomToDate(event.target.value)} />
                </div>
              </>
            ) : null}
          </div>
          <div className="quick-actions">
            <button className="btn primary" disabled={!canSubmit} onClick={handleCollect} type="button">
              <Play size={16} />
              {busy === "collect" ? "采集中..." : "开始采集"}
            </button>
            <button className="btn" disabled={busy === "health"} onClick={handleHealthCheck} type="button">
              <Settings2 size={16} />
              {busy === "health" ? "检查中..." : "检查环境"}
            </button>
          </div>
        </div>
        <aside className="quick-status">
          <h3>当前状态</h3>
          <div className="stat-row">
            <span className="stat-pill">{stats.accountCount} 个账号</span>
            <span className="stat-pill">{stats.projectCount} 个项目</span>
            <span className="stat-pill">{stats.videoCount} 条视频</span>
            <span className="stat-pill">{stats.transcriptCount} 份转写</span>
            <span className="stat-pill">{stats.draftCount} 个草稿</span>
          </div>
          {health ? (
            <div className="health-list">
              <span className={`status-pill ${health.opencli.ok ? "done" : "failed"}`}>
                opencli {health.opencli.ok ? `可用 ${health.opencli.version}` : "不可用"}
              </span>
              <span className={`status-pill ${health.siliconflowConfigured ? "done" : "pending"}`}>
                硅基流动 {health.siliconflowConfigured ? "已配置" : "未配置"}
              </span>
              <span className={`status-pill ${health.chatConfigured ? "done" : "pending"}`}>
                对话模型 {health.chatConfigured ? `${health.chat.model} / ${health.chat.wireApi} / 已配置` : `${health.chat.model} / ${health.chat.wireApi} / 未配置`}
              </span>
              <span className={`status-pill ${health.chat.proxyConfigured ? "done" : "pending"}`}>
                模型代理 {health.chat.proxyConfigured ? "已配置" : "未配置"}
              </span>
              <span className={`status-pill ${health.feishu.doctor.ok ? "done" : "failed"}`}>
                飞书 lark-cli {health.feishu.doctor.ok ? "可用" : "需登录/配置"}
              </span>
            </div>
          ) : (
            <p className="subtle">点击检查环境，确认 opencli、硅基流动、对话模型和飞书 lark-cli 配置。</p>
          )}
        </aside>
      </section>

      {message ? (
        <div className={message.includes("失败") || message.includes("不可用") ? "error" : "notice"}>
          <div className="feedback-row">
            <span>{message}</span>
            {lastCollect ? (
              <span className="button-row">
                <Link className="btn" href="/library">
                  去账号库整理风格
                </Link>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      <section className="kpi-grid">
        <div className="kpi-card">
          <span>账号</span>
          <strong>{stats.accountCount}</strong>
          <small>{stats.readyAccountCount} 个可参考写作</small>
        </div>
        <div className="kpi-card">
          <span>视频资产</span>
          <strong>{stats.videoCount}</strong>
          <small>{stats.transcriptCount} 份转写</small>
        </div>
        <div className="kpi-card">
          <span>转写覆盖</span>
          <strong>{stats.transcriptRate}%</strong>
          <small>{stats.videoCount ? "基于已采集视频" : "等待采集"}</small>
        </div>
        <div className="kpi-card">
          <span>项目 / 草稿</span>
          <strong>
            {stats.projectCount} / {stats.draftCount}
          </strong>
          <small>矩阵风格与输出沉淀</small>
        </div>
      </section>

      <section className="grid-2 dashboard-grid">
        <div className="panel task-panel">
          <div className="panel-inner">
            <div className="section-title-row">
              <h2>常用任务</h2>
              <span className="status-pill done">本地工作流</span>
            </div>
            <div className="task-list">
              {entries.map((entry) => {
                const Icon = entry.icon;
                const disabled = entry.title === "对话写作" && !canWrite;
                return (
                  <Link className={`task-row ${disabled ? "disabled-card" : ""}`} href={disabled ? "#" : entry.href} key={entry.href}>
                    <span className="entry-icon">
                      <Icon size={18} />
                    </span>
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.body}</small>
                    </span>
                    <span className="task-row-meta">
                      <span>{entryStatus(entry.title)}</span>
                      <span className={`btn ${disabled ? "disabled" : ""}`}>{entry.action}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-inner">
            <div className="section-title-row">
              <h2>最近账号</h2>
              <Link className="text-link" href="/library">
                进入账号库
              </Link>
            </div>
            {loading ? <p className="subtle">正在读取本地风格库...</p> : null}
            {!loading && !library?.recentAccounts.length ? (
              <div className="empty-action">
                <p className="subtle">还没有账号。上方填入账号名后，可以直接保存或开始采集。</p>
                <span className="status-pill pending">等待第一个参考账号</span>
              </div>
            ) : null}
            <div className="detail-stack">
              {library?.recentAccounts.map((account) => (
                <Link className="account-row compact-link-row" href="/library" key={account.id}>
                  <div>
                    <span className="list-title">{account.name}</span>
                    <span className="list-meta">
                      {formatPlatform(account.platform)} · {account.videoCount} 条视频 · {account.transcriptCount} 份转写
                    </span>
                    <div className="stat-row account-status-row">
                      {account.videoCount === 0 ? <span className="status-pill pending">继续采集</span> : null}
                      {account.videoCount > 0 && account.transcriptCount === 0 ? (
                        <span className="status-pill pending">待转写</span>
                      ) : null}
                      {account.transcriptCount > 0 ? <span className="status-pill done">可参考写作</span> : null}
                    </div>
                  </div>
                  <span className="row-arrow">打开</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="activity-grid">
        <div className="panel">
          <div className="panel-inner">
            <div className="section-title-row">
              <h2>最近草稿</h2>
              <Link className={`text-link ${canWrite ? "" : "disabled"}`} href={canWrite ? "/writer" : "#"}>
                进入写作台
              </Link>
            </div>
            {!library?.recentDrafts.length ? (
              <p className="subtle">生成文案后会出现在这里。</p>
            ) : (
              <div className="detail-stack">
                {library.recentDrafts.map((draft) => (
                  <Link href="/drafts" className="list-button" key={draft.id}>
                    <span>
                      <span className="list-title">{draft.title}</span>
                      <span className="list-meta">
                        参考 {draft.targetType === "project" ? `项目 ${draft.projectName}` : draft.accountName} · {formatDate(draft.createdAt)}
                      </span>
                    </span>
                    <span className="status-pill done">草稿</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function getDateFilter(timeRange: TimeRange, customFromDate: string, customToDate: string) {
  if (timeRange === "all") return {};
  if (timeRange === "custom") {
    return {
      ...(customFromDate ? { fromDate: customFromDate } : {}),
      ...(customToDate ? { toDate: customToDate } : {})
    };
  }

  const option = timeRangeOptions.find((item) => item.value === timeRange);
  if (!option?.days) return {};

  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - option.days + 1);

  return {
    fromDate: toDateInputValue(from),
    toDate: toDateInputValue(today)
  };
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeRangeLabel(timeRange: TimeRange, fromDate?: string, toDate?: string) {
  const option = timeRangeOptions.find((item) => item.value === timeRange);
  if (timeRange !== "custom") return option?.label || "不限";
  if (fromDate && toDate) return `${fromDate} 至 ${toDate}`;
  if (fromDate) return `${fromDate} 之后`;
  if (toDate) return `${toDate} 之前`;
  return "自定义不限";
}

function formatCollectMessage(
  result: Awaited<ReturnType<typeof collectAccount>>,
  activeTimeLabel: string,
  order: "pubdate" | "click" | "stow"
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
  const orderHint = order === "pubdate" ? "" : "，或把排序改成「最新优先」";
  return `${base} ${dateRange}，都不在当前时间范围内；请把时间改成「不限」/更早的范围${orderHint}后再采集。`;
}
