import { readRadarCollection, writeRadarCollection, updateRadarCollection } from "./hotspot-radar/collection";
import path from "node:path";
import { libraryRoot } from "./storage/core";
import { readJsonFile, writeJsonFile } from "./storage/fs";
import { hotspotFeedbackSchema, hotspotSnapshotSchema } from "./storage/schemas";
import { withMutationLock } from "./storage/mutation-lock";
import { analyzeRadar, toStoredSignal } from "./hotspot-radar/analysis";
import { collectRadarSources, mergeRadarSignals } from "./hotspot-radar/collector";
import type { CollectedSource, RadarRefreshOptions } from "./hotspot-radar/collector";
import { SOURCES, isRecentVerifiedSignal, sameEvent } from "./hotspot-radar/source-rules.mjs";
import { radarGrades } from "./hotspot-radar/types";
import type { RadarFeedback, RadarRating } from "./hotspot-radar/types";
import type { HotspotEvent, HotspotRadarRefreshResult, HotspotRadarResponse, HotspotSignal } from "./types";

const queues = new Map<string, Promise<unknown>>();
const activeRefreshes = new Set<string>();
function snapshotPath() { return path.join(libraryRoot(), "hotspots", "radar-snapshot.json"); }
function feedbackPath() { return path.join(libraryRoot(), "hotspots", "radar-feedback.json"); }
async function readSnapshot(): Promise<HotspotRadarRefreshResult> {
  const saved = await readJsonFile<unknown>(snapshotPath());
  if (saved === null) return emptySnapshot();
  const result = hotspotSnapshotSchema.safeParse(saved);
  if (!result.success) throw new Error("热点雷达快照格式损坏，请备份并检查 hotspots/radar-snapshot.json；未覆盖原文件");
  return result.data;
}
async function readFeedback(): Promise<RadarFeedback> {
  const saved = await readJsonFile<unknown>(feedbackPath());
  if (saved === null) return { schemaVersion: 1, ratings: [], history: [] };
  const result = hotspotFeedbackSchema.safeParse(saved);
  if (!result.success) throw new Error("热点评分文件格式损坏，请检查 hotspots/radar-feedback.json；未覆盖原文件");
  return result.data;
}
export async function getHotspotRadar(options: { refresh?: boolean } & RadarRefreshOptions = {}): Promise<HotspotRadarRefreshResult> {
  if (options.refresh) return refreshHotspotRadar(options);
  const [snapshot, feedback] = await Promise.all([readSnapshot(), readFeedback()]);
  const response = summarizeSnapshot(applyFeedback(snapshot, feedback));
  const collection = await readRadarCollection();
  if (collection) {
    response.collection = { generatedAt: collection.generatedAt, signalCount: collection.signals.length, status: collection.status, error: collection.error, analyzedCount: collection.analyzedCount, candidateCount: collection.candidateCount };
    response.scouts = collection.scouts;
    if (collection.status !== "completed") response.provisionalHotspots = summarizeSnapshot(applyFeedback({ ...snapshot, hotspots: collection.partialHotspots }, feedback)).hotspots;
  }
  return response;
}
export async function getHotspotDetail(id: string) {
  const [snapshot, feedback] = await Promise.all([readSnapshot(), readFeedback()]);
  const collection = await readRadarCollection();
  const partial = collection?.status !== "completed" ? collection?.partialHotspots.find(item => item.id === id) : undefined;
  const hotspot = applyFeedback({ ...snapshot, hotspots: partial ? [partial] : snapshot.hotspots }, feedback).hotspots.find(item => item.id === id);
  if (!hotspot) throw new Error("选题不存在或已过期，请刷新选题列表");
  const ids = new Set(hotspot.signalIds);
  return { hotspot, signals: (partial ? collection!.signals : snapshot.signals).filter(item => ids.has(item.id)) };
}
export async function saveHotspotFeedback(id: string, rating: RadarRating) {
  return withMutationLock(queues, feedbackPath(), async () => {
    const [snapshot, feedback] = await Promise.all([readSnapshot(), readFeedback()]);
    const topic = snapshot.hotspots.find(item => item.id === id) || (await readRadarCollection())?.partialHotspots.find(item => item.id === id);
    if (!topic) throw new Error("选题不存在，请刷新后评分");
    const record = { hotspotId: id, title: topic.title, summary: topic.summary, rating, updatedAt: new Date().toISOString() };
    feedback.ratings = [...feedback.ratings.filter(item => item.hotspotId !== id), record].slice(-1000);
    feedback.history = [...feedback.history, { hotspotId: id, rating, updatedAt: record.updatedAt }].slice(-1000);
    await writeJsonFile(feedbackPath(), hotspotFeedbackSchema.parse(feedback));
    return getHotspotRadar();
  });
}
export function summarizeSnapshot(snapshot: HotspotRadarRefreshResult): HotspotRadarRefreshResult {
  return { ...snapshot, signals: [], hotspots: snapshot.hotspots.map(item => ({ ...item, evidence: [], research: [], playerFocus: [], angles: [], risks: [], accounts: [], displayInfo: { ...item.displayInfo, facts: [] } })) };
}
function applyFeedback(snapshot: HotspotRadarRefreshResult, feedback: RadarFeedback) {
  const ratings = new Map(feedback.ratings.map(item => [item.hotspotId, item.rating]));
  const hotspots = snapshot.hotspots.filter(item => isVisibleTopic(item, snapshot)).map(item => {
    const rating = ratings.get(item.id);
    if (!rating) return item;
    const gradeLabel: HotspotEvent["gradeLabel"] = rating === "不行" ? "先看看" : rating;
    return { ...item, userRating: rating, gradeLabel, priorityLabel: gradeLabel, displayInfo: { ...item.displayInfo, statusLine: gradeLabel }, status: gradeLabel === "吊爆了" ? "ready" as const : "watch" as const };
  });
  return { ...snapshot, hotspots: sortTopics(hotspots), summary: { ...snapshot.summary, hotspotCount: hotspots.length, readyCount: hotspots.filter(item => item.status === "ready").length } };
}
function isVisibleTopic(item: HotspotEvent, snapshot: HotspotRadarResponse) {
  if (item.retainedUntil && Date.parse(item.retainedUntil) > Date.now()) return true;
  if (item.publishedAt) return isRecentVerifiedSignal(item);
  // 旧版选题没有日期时，至少按快照日期淘汰陈旧数据。
  return isRecentVerifiedSignal({ publishedAt: snapshot.generatedAt });
}
function sortTopics(items: HotspotEvent[]) { return items.slice().sort((a, b) => radarGrades.indexOf(a.gradeLabel || "先看看") - radarGrades.indexOf(b.gradeLabel || "先看看") || (b.publishedAt || "").localeCompare(a.publishedAt || "")); }
export function retainPriorityTopics(previous: HotspotRadarRefreshResult, current: HotspotEvent[], now = Date.now()) {
  const byId = new Map(previous.hotspots.map(item => [item.id, item]));
  const currentIds = new Set(current.map(item => item.id));
  const pool: HotspotEvent[] = current.map(item => {
    const old = byId.get(item.id) || previous.hotspots.find(candidate => sameEvent(candidate.title, item.title, candidate.publishedAt || "", item.publishedAt || ""));
    if (old) currentIds.add(old.id);
    const existingDeadline = old?.retainedUntil;
    // 保留时钟从首次进入最高档开始，不因每次刷新无限延长。
    const retainedUntil = item.gradeLabel === "吊爆了" ? existingDeadline || new Date(now + 72 * 3600000).toISOString() : undefined;
    return { ...item, retainedUntil, signalIds: [...new Set([...item.signalIds, ...(old?.signalIds || [])])], evidence: [...new Set([...item.evidence, ...(old?.evidence || [])])] };
  });
  for (const item of previous.hotspots) {
    if (!currentIds.has(item.id) && item.gradeLabel === "吊爆了" && item.retainedUntil && Date.parse(item.retainedUntil) > now) pool.push(item);
  }
  return sortTopics(pool);
}
export function assertCollectionCoverage(collected: CollectedSource[]) {
  const successful = collected.filter(item => !item.error).length;
  if (successful < Math.ceil(collected.length / 2) || !collected.some(item => item.items.length)) {
    throw new Error(`热点采集覆盖不足（${successful}/${collected.length} 来源成功），已保留上次快照，请检查网络后重试。${collected.filter(item => item.error).slice(0, 4).map(item => `${item.source.name}：${item.error}`).join("；")}`);
  }
}
export async function refreshHotspotRadar(options: RadarRefreshOptions = {}): Promise<HotspotRadarRefreshResult> {
  const key = snapshotPath();
  if (activeRefreshes.has(key)) throw new Error("热点刷新任务正在运行，请到任务中心查看进度");
  activeRefreshes.add(key);
  let collectionSaved = false;
  try {
    const [previous, feedback] = await Promise.all([readSnapshot(), readFeedback()]);
    if (options.retryReport) return await finishSavedRadarReport(previous, feedback, options);
    const collected = await collectRadarSources(options);
    options.signal?.throwIfAborted();
    const collectedAt = new Date().toISOString();
    await writeRadarCollection({ schemaVersion: 1, generatedAt: collectedAt, signals: collected.flatMap(item => item.items).map(toStoredSignal), scouts: collected.map(item => ({ id: item.source.id, board: "game", name: item.source.name, scope: item.source.scope, cadence: "手动刷新", sources: [item.source.url], status: item.error ? "failed" : "running", coverage: item.error ? 0 : 100, itemCount: item.items.length, lastCheckedAt: item.checkedAt, error: item.error })), status: "collected", partialHotspots: [], analyzedCount: 0, candidateCount: 0 });
    collectionSaved = true;
    await options.onProgress?.({ completed: collected.length, total: collected.length, sourceName: "资讯已保存，可立即阅读", failed: false, stage: "collect", dataChanged: true });
    assertCollectionCoverage(collected);
    await updateRadarCollection(current => ({ ...current, status: "analyzing" }));
    const merged = mergeRadarSignals(collected.flatMap(item => item.items));
    const analyzed = await analyzeRadar(merged, feedback, { ...options, async onPartial(items, count, total) {
      options.signal?.throwIfAborted();
      await updateRadarCollection(current => ({ ...current, partialHotspots: items, analyzedCount: count, candidateCount: total }));
      await options.onProgress?.({ completed: count, total, sourceName: `已保存 ${items.length} 个选题，正在继续分析`, failed: false, stage: "AI 精筛", dataChanged: true });
    } });
    await updateRadarCollection(current => ({ ...current, analysis: analyzed.analysis }));
    const hotspots = retainPriorityTopics(previous, analyzed.hotspots);
    await options.onProgress?.({ completed: 0, total: 1, sourceName: "生成最终选题池日报", failed: false, stage: "日报" });
    const dailyReport = await analyzed.report(hotspots);
    const sourceSignals = merged.flatMap(item => [item, ...(item.related || [])]).map(toStoredSignal);
    const signalsById = new Map<string, HotspotSignal>(sourceSignals.map(item => [item.id, item]));
    for (const hotspot of hotspots) for (const id of hotspot.signalIds) {
      if (!signalsById.has(id)) { const signal = previous.signals.find(item => item.id === id); if (signal) signalsById.set(id, signal); }
    }
    const generatedAt = new Date().toISOString();
    const successful = collected.filter(item => !item.error).length;
    const counts = { sourceCount: collected.length, completedSourceCount: successful, failedSourceCount: collected.length - successful, signalCount: merged.length, hotspotCount: hotspots.length, readyCount: hotspots.filter(item => item.status === "ready").length, averageScore: 0 };
    const snapshot: HotspotRadarRefreshResult = {
      schemaVersion: 1, generatedAt, hotspots, signals: [...signalsById.values()], analysis: analyzed.analysis, dailyReport,
      scouts: collected.map(item => ({ id: item.source.id, board: "game", name: item.source.name, scope: item.source.scope, cadence: "手动任务刷新", sources: [item.source.url], status: item.error ? "failed" : item.items.length ? "running" : "paused", coverage: item.error ? 0 : 100, itemCount: item.items.length, lastCheckedAt: item.checkedAt, error: item.error })),
      summary: { ...counts, generatedAt, boardStats: [{ ...counts, board: "game", topScore: 0 }] },
      refresh: { requested: collected.length, completed: successful, failed: collected.length - successful, sources: collected.map(item => ({ id: item.source.id, board: "game", name: item.source.name, status: item.error ? "failed" : "completed", itemCount: item.items.length, error: item.error })) }
    };
    const latestFeedback = await readFeedback();
    options.signal?.throwIfAborted();
    await writeJsonFile(key, hotspotSnapshotSchema.parse(snapshot));
    await updateRadarCollection(current => ({ ...current, status: "completed", error: undefined, partialHotspots: [], analyzedCount: analyzed.analysis.analyzedCount, candidateCount: analyzed.analysis.coarseCount }));
    return summarizeSnapshot(applyFeedback(snapshot, latestFeedback));
  } catch (error) {
    if (collectionSaved) {
      await updateRadarCollection(current => ({ ...current, status: options.signal?.aborted ? "cancelled" : "failed", error: options.signal?.aborted ? "任务已取消，已采集资讯仍可阅读" : error instanceof Error ? error.message : "热点分析失败，请重试" }));
      await options.onProgress?.({ completed: 0, total: 1, sourceName: "已保留采集结果和完成批次", failed: true, stage: "保存诊断", dataChanged: true });
    }
    throw error;
  } finally { activeRefreshes.delete(key); }
}
function emptySnapshot(): HotspotRadarRefreshResult {
  return { schemaVersion: 1, generatedAt: "", hotspots: [], signals: [], scouts: SOURCES.map(source => ({ id: source.id, board: "game", name: source.name, scope: source.scope, cadence: "手动任务刷新", sources: [source.url], status: "paused", coverage: 0, itemCount: 0 })), summary: { sourceCount: SOURCES.length, completedSourceCount: 0, failedSourceCount: 0, signalCount: 0, hotspotCount: 0, readyCount: 0, averageScore: 0, boardStats: [], generatedAt: "" }, refresh: { requested: 0, completed: 0, failed: 0, sources: [] } };
}
export function getHotspotRadarSnapshotSummary(snapshot: HotspotRadarResponse) {
  return `${snapshot.summary.completedSourceCount}/${snapshot.summary.sourceCount} 个源可用，${snapshot.summary.signalCount} 条信号，${snapshot.summary.hotspotCount} 个选题。`;
}

export async function getRadarSignals(query: { page?: number; search?: string; source?: string; id?: string } = {}) {
  const collection = await readRadarCollection();
  const snapshot = collection ? null : await readSnapshot();
  const all = collection?.signals || snapshot?.signals || [];
  const matching = [...all].sort((a, b) => Date.parse(b.publishedAt || b.capturedAt) - Date.parse(a.publishedAt || a.capturedAt)).filter(item => (!query.id || item.id === query.id) && (!query.source || item.sourceId === query.source) && (!query.search || `${item.title} ${item.sourceName} ${item.summary || ""}`.toLowerCase().includes(query.search.toLowerCase())));
  const page = Math.max(1, query.page || 1);
  const items: HotspotSignal[] = query.id ? matching : matching.slice((page - 1) * 30, page * 30).map(({ summary: _summary, ...item }) => { void _summary; return item; });
  return { items, total: matching.length, page, generatedAt: collection?.generatedAt || snapshot?.generatedAt || "" };
}


async function finishSavedRadarReport(previous: HotspotRadarRefreshResult, feedback: RadarFeedback, options: RadarRefreshOptions) {
  const collection = await readRadarCollection();
  if (!collection || collection.candidateCount === 0 || collection.analyzedCount !== collection.candidateCount || !["failed", "cancelled"].includes(collection.status)) throw new Error("没有已完成精筛且待恢复的日报，请重新采集并筛选");
  if (Date.now() - Date.parse(collection.generatedAt) > 72 * 3600000) throw new Error("已保存资讯超过72小时，请重新采集");
  try {
  await updateRadarCollection(current => ({ ...current, status: "analyzing", error: undefined }));
  const hotspots = retainPriorityTopics(previous, collection.partialHotspots);
  await options.onProgress?.({ completed: 0, total: 1, sourceName: "恢复已完成选题，仅重新生成日报", failed: false, stage: "日报", dataChanged: true });
  const reportRunner = await analyzeRadar([], feedback, options);
  const dailyReport = await reportRunner.report(hotspots);
  const generatedAt = new Date().toISOString();
  const successful = collection.scouts.filter(item => !item.error).length;
  const counts = { sourceCount: collection.scouts.length, completedSourceCount: successful, failedSourceCount: collection.scouts.length - successful, signalCount: collection.signals.length, hotspotCount: hotspots.length, readyCount: hotspots.filter(item => item.status === "ready").length, averageScore: 0 };
  const signals = new Map(collection.signals.map(item => [item.id, item]));
  for (const topic of hotspots) for (const id of topic.signalIds) if (!signals.has(id)) { const item = previous.signals.find(signal => signal.id === id); if (item) signals.set(id, item); }
  const analysis = collection.analysis ? { ...collection.analysis, fallback: collection.analysis.fallback || reportRunner.analysis.fallback, fallbackReason: [collection.analysis.fallbackReason, reportRunner.analysis.fallbackReason].filter(Boolean).join("；") || undefined } : undefined;
  const snapshot: HotspotRadarRefreshResult = { schemaVersion: 1, generatedAt, hotspots, signals: [...signals.values()], scouts: collection.scouts, dailyReport, analysis,
    summary: { ...counts, generatedAt, boardStats: [{ ...counts, board: "game", topScore: 0 }] },
    refresh: { requested: counts.sourceCount, completed: successful, failed: counts.failedSourceCount, sources: collection.scouts.map(item => ({ id: item.id, board: "game", name: item.name, status: item.error ? "failed" : "completed", itemCount: item.itemCount, error: item.error })) }
  };
  options.signal?.throwIfAborted();
  await writeJsonFile(snapshotPath(), hotspotSnapshotSchema.parse(snapshot));
  await updateRadarCollection(current => ({ ...current, status: "completed", error: undefined, partialHotspots: [] }));
  return summarizeSnapshot(applyFeedback(snapshot, await readFeedback()));
  } catch (error) {
    await updateRadarCollection(current => ({ ...current, status: options.signal?.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : "日报生成失败，请重试" }));
    await options.onProgress?.({ completed: 0, total: 1, sourceName: "日报失败，已保留完成的选题", failed: true, stage: "日报", dataChanged: true });
    throw error;
  }
}
