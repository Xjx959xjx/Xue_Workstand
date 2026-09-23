import { createHash } from "node:crypto";
import { getDouyinHotlist } from "../douyin-hotlist";
import { getTrendRadarFeed, trendRadarItemsToSources } from "../trendradar";
import { canonicalRadarUrl, safeSourceUrl } from "./collector";
import { coarseFilter, isLowValueRoutineSports } from "./source-rules.mjs";
import type { RadarSignal } from "./source-rules.mjs";
import type { CollectedSource, RadarRefreshOptions } from "./collector";
import type { RadarPipelineConfig } from "./config";
import type { DouyinHotlistResponse } from "../types";

export function videoHotlistSources(feed: DouyinHotlistResponse): CollectedSource[] {
  const checkedAt = feed.summary.lastRefreshedAt || "";
  const source = { id: "video-hotlist", name: "视频热榜", url: "", type: "video", scope: "已保存的抖音 / B站热榜" };
  const items: RadarSignal[] = [];
  let invalid = 0;
  for (const { video, account, rank } of feed.items) {
    let url: string;
    try { url = safeSourceUrl(video.url); } catch { invalid++; continue; }
    items.push({ id: `video:${video.platform}:${createHash("sha256").update(video.id).digest("hex").slice(0, 24)}`, sourceId: source.id, source: `${account.name}（${video.platform === "bilibili" ? "B站" : "抖音"}）`, originalSource: account.name,
      title: video.title, summary: "视频标题线索；未读取视频文稿，不代表已核实视频内容或事件事实。", url, category: "视频热榜", publishedAt: video.publishedAt || "", collectedAt: checkedAt, observedAt: checkedAt, inputKind: "video",
      metrics: { rank, likes: video.stats.likes, comments: video.stats.comments, views: video.stats.views } });
  }
  const warnings = [!checkedAt ? "尚无视频热榜刷新记录，请先在视频热榜更新" : "", feed.summary.staleAccountIds.length ? `${feed.summary.staleAccountIds.length} 个热榜账号记录缺失` : "", invalid ? `${invalid} 条视频链接无效，已排除` : ""].filter(Boolean);
  return [{ source, checkedAt, items, ...(warnings.length ? { error: warnings.join("；") } : {}) }];
}

export async function collectUnifiedSources(config: RadarPipelineConfig, options: RadarRefreshOptions): Promise<CollectedSource[]> {
  const results = await Promise.allSettled([
    config.sources.some(kind => kind !== "video") ? getTrendRadarFeed(options.signal, undefined, { maxAgeHours: config.maxAgeHours }) : Promise.resolve(null),
    config.sources.includes("video") ? getDouyinHotlist({ windowDays: Math.ceil(config.maxAgeHours / 24) }) : Promise.resolve(null)
  ]);
  options.signal?.throwIfAborted();
  const collected: CollectedSource[] = [];
  const failed = (id: string, name: string, message: string): CollectedSource => ({ source: { id, name, url: "", type: "unified", scope: "统一资讯池" }, checkedAt: new Date().toISOString(), items: [], error: message });
  const [trend, video] = results;
  if (trend.status === "rejected") collected.push(failed("trendradar", "TrendRadar", trend.reason instanceof Error ? trend.reason.message : "读取 TrendRadar 失败"));
  else if (trend.value) {
    collected.push(...trendRadarItemsToSources(trend.value.items.filter(item => config.sources.includes(item.kind))));
    if (trend.value.missing.length || trend.value.warnings.length) collected.push(failed("trendradar-status", "TrendRadar 读取状态", [...trend.value.missing, ...trend.value.warnings].join("；")));
  }
  if (video.status === "rejected") collected.push(failed("video-hotlist", "视频热榜", video.reason instanceof Error ? video.reason.message : "读取视频热榜失败"));
  else if (video.value) collected.push(...videoHotlistSources(video.value));
  const now = Date.now();
  for (const entry of collected) {
    const priorCount = entry.items.length;
    entry.items = entry.items.filter(item => {
      const timestamp = Date.parse(item.publishedAt || item.observedAt || "");
      return Number.isFinite(timestamp) && now - timestamp <= config.maxAgeHours * 3600000 && timestamp <= now + 3600000;
    });
    if (priorCount && !entry.items.length) entry.error = [entry.error, `来源数据超过 ${config.maxAgeHours} 小时或时间缺失，请先更新采集服务`].filter(Boolean).join("；");
  }
  return collected;
}

/** 每类、每来源轮转，保留弱规则评分以外的游戏线索给模型判断。 */
export function selectUnifiedCandidates(items: RadarSignal[], config: RadarPipelineConfig): RadarSignal[] {
  const scores = new Map(coarseFilter(items).map(item => [item.id, item.coarseScore || 0]));
  const eligible = items.filter(item => !isLowValueRoutineSports(item) && !config.exclude.some(word => `${item.title} ${item.summary}`.toLowerCase().includes(word.toLowerCase())));
  const queues = new Map<string, RadarSignal[]>();
  for (const item of eligible) {
    const key = `${item.inputKind || "hotlist"}:${item.sourceId}`;
    const queue = queues.get(key) || [];
    queue.push(item); queues.set(key, queue);
  }
  for (const [key, queue] of queues) queues.set(key, queue.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0) || (b.publishedAt || b.observedAt || "").localeCompare(a.publishedAt || a.observedAt || "") || a.id.localeCompare(b.id)).slice(0, config.perSourceLimit));
  const kinds = config.sources.map(kind => [...queues.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([, values]) => values));
  const selected: RadarSignal[] = [];
  let changed = true;
  while (selected.length < config.candidateLimit && changed) {
    changed = false;
    for (const sources of kinds) {
      const queue = sources.shift();
      if (!queue) continue;
      const item = queue.shift();
      if (queue.length) sources.push(queue);
      if (item) { selected.push(item); changed = true; }
      if (selected.length >= config.candidateLimit) break;
    }
  }
  return selected;
}

/** 只做同 URL 去重，事件语义归并交给后续模型，避免规则误合并。 */
export function deduplicateUnifiedSignals(items: RadarSignal[]): RadarSignal[] {
  const byUrl = new Map<string, RadarSignal>();
  for (const item of items) {
    const key = canonicalRadarUrl(item.url);
    const existing = byUrl.get(key);
    if (existing) existing.related!.push(item);
    else byUrl.set(key, { ...item, related: [] });
  }
  return [...byUrl.values()];
}
