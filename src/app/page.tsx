"use client";

import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "@/components/FeedbackProvider";
import { useLibrary } from "@/components/LibraryProvider";
import { collectAccount, getHealth } from "@/lib/client";
import type { CollectOrder, Platform } from "@/lib/types";
import { HomeHeader } from "./_components/home/HomeHeader";
import { QuickStartPanel, type HomeStats } from "./_components/home/QuickStartPanel";
import { RecentAccountsPanel } from "./_components/home/RecentAccountsPanel";
import { TaskListPanel } from "./_components/home/TaskListPanel";
import { collectOrderOptions, formatTimeRangeLabel, getDateFilter, type TimeRange } from "./_components/home/home-utils";

export default function HomePage() {
  const { library, loading, error, refresh } = useLibrary();
  const { notify } = useFeedback();
  const [platform, setPlatform] = useState<Platform>("bilibili");
  const [name, setName] = useState("");
  const [limit, setLimit] = useState(20);
  const [order, setOrder] = useState<CollectOrder>("views");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [customFromDate, setCustomFromDate] = useState("");
  const [customToDate, setCustomToDate] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [lastCollect, setLastCollect] = useState<Awaited<ReturnType<typeof collectAccount>> | null>(null);

  const stats: HomeStats = useMemo(() => {
    const accounts = library?.accounts || [];
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
  }, [library]);
  const canWrite = stats.accountCount > 0;
  const canSubmit = Boolean(name.trim()) && !busy;
  const dateFilter = useMemo(() => getDateFilter(timeRange, customFromDate, customToDate), [
    customFromDate,
    customToDate,
    timeRange
  ]);
  const activeTimeLabel = formatTimeRangeLabel(timeRange, dateFilter.fromDate, dateFilter.toDate);
  const activeOrderOptions = collectOrderOptions[platform];
  const messageIsError = message.includes("失败") || message.includes("不可用");

  useEffect(() => {
    if (!message) return;
    notify({
      tone: messageIsError ? "error" : "success",
      message,
      action: lastCollect && !messageIsError ? { label: "去账号库整理风格", href: "/library" } : undefined
    });
  }, [lastCollect, message, messageIsError, notify]);

  function handlePlatformChange(nextPlatform: Platform) {
    setPlatform(nextPlatform);
    setOrder((currentOrder) =>
      collectOrderOptions[nextPlatform].some((option) => option.value === currentOrder)
        ? currentOrder
        : collectOrderOptions[nextPlatform][0].value
    );
  }

  async function handleHealthCheck() {
    setBusy("health");
    setMessage("");
    try {
      setHealth(await getHealth());
      setMessage("环境检查完成。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "环境检查失败，请确认 opencli、模型或飞书配置后重试。");
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
      setMessage(err instanceof Error ? err.message : "采集失败，请检查账号名、主页链接或 opencli 配置后重试。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page home-page">
      <HomeHeader loading={loading} onRefresh={refresh} />
      <QuickStartPanel
        activeOrderOptions={activeOrderOptions}
        busy={busy}
        canSubmit={canSubmit}
        customFromDate={customFromDate}
        customToDate={customToDate}
        health={health}
        limit={limit}
        name={name}
        order={order}
        platform={platform}
        stats={stats}
        timeRange={timeRange}
        onCollect={handleCollect}
        onCustomFromDateChange={setCustomFromDate}
        onCustomToDateChange={setCustomToDate}
        onHealthCheck={handleHealthCheck}
        onLimitChange={setLimit}
        onNameChange={setName}
        onOrderChange={setOrder}
        onPlatformChange={handlePlatformChange}
        onTimeRangeChange={setTimeRange}
      />

      {error ? <div className="error">{error}</div> : null}

      <section className="grid-2 dashboard-grid">
        <TaskListPanel canWrite={canWrite} stats={stats} />
        <RecentAccountsPanel loading={loading} recentAccounts={library?.recentAccounts || []} />
      </section>
    </div>
  );
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
