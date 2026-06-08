import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import {
  getBilibiliVideoStatsByUrl,
  getDouyinVideoStatsBatchByUrl,
  getDouyinVideoStatsByUrl,
} from "@/lib/opencli";
import type { OpenCliTimingSink } from "@/lib/opencli";
import { parseGrossMarginBulkMonitorTemplate } from "@/lib/gross-margin-monitor-template";
import {
  appendGrossMarginPlaySample,
  deleteGrossMarginMonitorRecord,
  getGrossMarginLibrary,
  getGrossMarginMonitorRecords,
  resolveGrossMarginMonitorRecord,
  saveGrossMarginMonitorRecord,
  saveGrossMarginPriceTable,
  upsertGrossMarginMonitorRecord
} from "@/lib/storage";
import type {
  GrossMarginMonitorRecord,
  GrossMarginPriceTable,
  GrossMarginServiceKind
} from "@/lib/types";
import {
  detectVideoPlatform,
  extractBvid,
  extractDouyinAwemeId,
  extractVideoUrl,
  getVideoComparableKey,
  normalizeVideoUrlInput
} from "@/lib/platform-links";
import { safeSegment, shortHash, toNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const platformSchema = z.enum(["douyin", "bilibili"]);
const serviceSchema = z.enum(["play", "like", "douPlus", "coin", "comment", "share", "favorite", "danmaku", "blueLink"]);
const amountSchema = z.coerce.number().finite().min(0, "金额不能小于 0").max(100_000_000, "金额过大，请检查输入");
const minimumQuantitySchema = z.coerce.number().finite().gt(0, "起量必须大于 0").max(100_000_000, "起量过大，请检查输入");
const DOUYIN_VIDEO_STATS_CACHE_TTL_MS = 3 * 60 * 1000;
const MONITOR_REFRESH_LOG_PREFIX = "[gross-margin-monitor]";
const DEFAULT_MONITOR_REFRESH_CONCURRENCY = 3;
const MAX_MONITOR_REFRESH_CONCURRENCY = 6;

const douyinSingleVideoStatsCache = new Map<
  string,
  {
    expiresAt: number;
    promise: ReturnType<typeof getDouyinVideoStatsByUrl>;
  }
>();

type MonitorFetchedStats =
  | Awaited<ReturnType<typeof getBilibiliVideoStatsByUrl>>
  | Awaited<ReturnType<typeof getDouyinVideoStatsByUrl>>
  | Awaited<ReturnType<typeof getDouyinMonitorStats>>;

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("savePriceTable"),
    platform: platformSchema,
    items: z.array(
      z.object({
        id: z.string().min(1, "单价项缺少 ID"),
        service: serviceSchema,
        name: z.string().trim().min(1, "请填写单价项名称").max(40, "单价项名称太长"),
        unitPrice: amountSchema,
        quantityUnit: z.string().trim().min(1, "请填写数量单位").max(12, "数量单位太长"),
        minimumQuantity: minimumQuantitySchema.optional(),
        note: z.string().trim().max(120, "备注太长").optional()
      })
    )
  }),
  z.object({
    action: z.literal("saveMonitorRecord"),
    platform: platformSchema,
    accountName: z.string().trim().optional(),
    videoUrl: z.string().trim().min(1, "请填写视频链接"),
    sourceText: z.string().min(1, "监控记录缺少维护目标文案"),
    targetStats: z.record(serviceSchema, z.coerce.number().finite().min(0)).optional()
  }),
  z.object({
    action: z.literal("bulkSaveMonitorRecords"),
    template: z.string().trim().min(1, "请先粘贴监控模板"),
    projectName: z.string().trim().max(80, "项目名太长").optional(),
    createProject: z.boolean().optional()
  }),
  z.object({
    action: z.literal("refreshMonitorRecord"),
    recordId: z.string().trim().min(1, "缺少监控记录 ID")
  }),
  z.object({
    action: z.literal("refreshMonitorRecords"),
    recordIds: z.array(z.string().trim().min(1, "监控记录 ID 不能为空")).optional()
  }),
  z.object({
    action: z.literal("updateMonitorPlayTarget"),
    recordId: z.string().trim().min(1, "缺少监控记录 ID"),
    target: z.coerce.number().finite().gt(0, "播放量目标必须大于 0").max(100_000_000, "播放量目标过大，请检查输入")
  }),
  z.object({
    action: z.literal("updateMonitorPlayCurrent"),
    recordId: z.string().trim().min(1, "缺少监控记录 ID"),
    current: z.coerce.number().finite().min(0, "当前播放量不能小于 0").max(100_000_000, "当前播放量过大，请检查输入")
  }),
  z.object({
    action: z.literal("deleteMonitorRecord"),
    recordId: z.string().trim().min(1, "缺少监控记录 ID")
  })
]);

export async function GET() {
  return apiJson(() => getGrossMarginLibrary(), {
    fallbackMessage: "读取毛利单价表失败",
    status: 500,
    formatError: formatGrossMarginError
  });
}

export async function POST(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, mutationSchema);
    if (input.action === "saveMonitorRecord") {
      const record = await saveMonitorRecordFromInput(input);
      return { record, library: await getGrossMarginLibrary() };
    }
    if (input.action === "bulkSaveMonitorRecords") {
      const result = await bulkSaveMonitorRecordsFromInput(input);
      return { ...result, library: await getGrossMarginLibrary() };
    }
    if (input.action === "refreshMonitorRecord") {
      const record = await refreshMonitorRecord(input.recordId);
      return { record, library: await getGrossMarginLibrary() };
    }
    if (input.action === "refreshMonitorRecords") {
      const records = await refreshMonitorRecords(input.recordIds);
      return { records, library: await getGrossMarginLibrary() };
    }
    if (input.action === "updateMonitorPlayTarget") {
      const record = await updateMonitorPlayTarget(input.recordId, input.target);
      return { record, library: await getGrossMarginLibrary() };
    }
    if (input.action === "updateMonitorPlayCurrent") {
      const record = await updateMonitorPlayCurrent(input.recordId, input.current);
      return { record, library: await getGrossMarginLibrary() };
    }
    if (input.action === "deleteMonitorRecord") {
      const result = await deleteGrossMarginMonitorRecord(input.recordId);
      return { ...result, library: await getGrossMarginLibrary() };
    }
    const table = await saveGrossMarginPriceTable(input);
    return { table, library: await getGrossMarginLibrary() };
  }, {
    fallbackMessage: "保存毛利单价表失败",
    formatError: formatGrossMarginError
  });
}

function formatGrossMarginError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message || "毛利单价表参数不完整或格式不正确。";
  }

  if (isMissingOpenCliError(error)) {
    return "未检测到 opencli。数据维护 / 数据监控页面可以继续使用，但刷新 B站/抖音数据前请先运行 install-deps.cmd 安装 opencli。";
  }

  return error instanceof Error ? error.message : "保存毛利单价表失败";
}

function isMissingOpenCliError(error: unknown) {
  return error instanceof Error && /opencli/i.test(error.message) && /未检测到|not found|enoent/i.test(error.message);
}

type MonitorPlatform = GrossMarginPriceTable["platform"];

async function saveMonitorRecordFromInput(input: z.infer<typeof mutationSchema> & { action: "saveMonitorRecord" }) {
  const parsed = parseMaintenanceTemplate(input.sourceText);
  const targetStats = {
    ...parsed.stats,
    ...(input.targetStats || {})
  };
  const resolvedVideo = resolveVideoUrl(input.videoUrl, input.sourceText);
  const videoUrl = normalizeVideoUrlInput(resolvedVideo.url);
  const platform = resolveMonitorPlatform(videoUrl, parsed.platform, input.platform);
  const videoKey = getVideoComparableKey(videoUrl);
  return upsertGrossMarginMonitorRecord({
    platform,
    accountName: input.accountName || parsed.accountName,
    videoUrl,
    videoKey,
    sourceText: input.sourceText,
    targetStats,
    warnings: resolvedVideo.warnings
  });
}

async function bulkSaveMonitorRecordsFromInput(input: z.infer<typeof mutationSchema> & { action: "bulkSaveMonitorRecords" }) {
  const parsed = parseGrossMarginBulkMonitorTemplate(input.template);
  if (!parsed.items.length) {
    throw new Error(parsed.warnings[0] || "没有识别到可添加的监控模板。");
  }

  const trimmedProjectName = input.projectName?.trim() || "";
  const shouldCreateProject = Boolean(input.createProject && parsed.items.length > 1);
  const projectName = shouldCreateProject ? trimmedProjectName || makeDefaultGrossMarginProjectName(parsed.items.length) : "";
  const projectId = projectName ? safeSegment(`${projectName}-${shortHash(input.template)}`, shortHash(projectName)) : "";
  const records = await Promise.all(
    parsed.items.map((item) =>
      upsertGrossMarginMonitorRecord({
        platform: item.platform,
        accountName: item.accountName,
        projectId: projectId || undefined,
        projectName: projectName || undefined,
        videoUrl: item.videoUrl,
        videoKey: getVideoComparableKey(item.videoUrl),
        sourceText: item.sourceText,
        targetStats: item.targetStats
      })
    )
  );

  return {
    records,
    parsed,
    project: projectId ? { id: projectId, name: projectName } : null
  };
}

async function refreshMonitorRecord(recordId: string) {
  const logger = createMonitorRefreshLogger("refresh-one", { recordId });
  let refreshed: GrossMarginMonitorRecord | null = null;
  try {
    const record = await timeMonitorOperation(
      logger.onTiming,
      "storage.resolve-monitor-record",
      () => resolveGrossMarginMonitorRecord(recordId),
      { recordId }
    );
    refreshed = await refreshMonitorRecordSnapshot(record, logger.onTiming);
    return refreshed;
  } finally {
    logger.finish(refreshed?.status || "failed", refreshed ? recordTimingMeta(refreshed) : { recordId });
  }
}

async function refreshMonitorRecordSnapshot(
  record: GrossMarginMonitorRecord,
  onTiming?: OpenCliTimingSink
) {
  const meta = recordTimingMeta(record);
  try {
    const fetched = await timeMonitorOperation(
      onTiming,
      `${record.platform}.record.fetch-total`,
      () => fetchMonitorRecordStats(record, onTiming, meta),
      meta
    );
    return saveRefreshedMonitorRecord(record, fetched, onTiming);
  } catch (error) {
    return saveFailedMonitorRecord(record, error, onTiming);
  }
}

function fetchMonitorRecordStats(
  record: GrossMarginMonitorRecord,
  onTiming: OpenCliTimingSink | undefined,
  meta: MonitorTimingMeta
): Promise<MonitorFetchedStats> {
  if (record.platform === "bilibili") {
    return getBilibiliVideoStatsByUrl(record.videoUrl, {
      onTiming,
      timingMeta: meta
    });
  }
  return getDouyinMonitorStats({
    accountName: record.accountName,
    url: record.videoUrl
  }, {
    onTiming,
    timingMeta: meta
  });
}

async function saveRefreshedMonitorRecord(
  record: GrossMarginMonitorRecord,
  fetched: MonitorFetchedStats,
  onTiming?: OpenCliTimingSink
) {
  const warnings: string[] = [];
  try {
    if ("warning" in fetched && fetched.warning) warnings.push(fetched.warning);
    const fetchedStats = normalizeFetchedStatsForMonitor(record.platform, fetched.stats);
    const currentStats =
      record.platform === "douyin" && typeof record.currentStats?.play === "number"
        ? { ...fetchedStats, play: record.currentStats.play }
        : fetchedStats;
    const refreshedAt = new Date().toISOString();
    const shouldCapturePlaySample =
      typeof fetchedStats.play === "number" && Number.isFinite(fetchedStats.play) && currentStats.play === fetchedStats.play;
    const playSamples = shouldCapturePlaySample
      ? appendGrossMarginPlaySample(record.playSamples, currentStats.play, refreshedAt, "refresh")
      : record.playSamples;
    return timeMonitorOperation(
      onTiming,
      "storage.save-monitor-record",
      () => saveGrossMarginMonitorRecord({
        ...record,
        accountName: record.accountName || getFetchedAuthorName(fetched),
        title: fetched.title || record.title,
        videoUrl: fetched.url || record.videoUrl,
        videoKey:
          "videoKey" in fetched && typeof fetched.videoKey === "string" && fetched.videoKey
            ? fetched.videoKey
            : fetched.url
              ? getVideoComparableKey(fetched.url)
              : record.videoKey,
        publishedAt: fetched.publishedAt || record.publishedAt,
        previousStats: record.currentStats,
        currentStats,
        playSamples,
        status: warnings.length ? "partial" : "completed",
        warnings,
        lastRefreshedAt: refreshedAt,
        updatedAt: refreshedAt
      }),
      recordTimingMeta(record)
    );
  } catch (error) {
    return saveFailedMonitorRecord(record, error, onTiming);
  }
}

function getFetchedAuthorName(
  fetched:
    | Awaited<ReturnType<typeof getBilibiliVideoStatsByUrl>>
    | Awaited<ReturnType<typeof getDouyinVideoStatsByUrl>>
    | Awaited<ReturnType<typeof getDouyinMonitorStats>>
) {
  return "authorName" in fetched ? fetched.authorName?.trim() || "" : "";
}

function saveFailedMonitorRecord(record: GrossMarginMonitorRecord, error: unknown, onTiming?: OpenCliTimingSink) {
  return timeMonitorOperation(
    onTiming,
    "storage.save-failed-monitor-record",
    () => saveGrossMarginMonitorRecord({
      ...record,
      status: "failed",
      warnings: [error instanceof Error ? error.message : "刷新监控数据失败"],
      lastRefreshedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
    recordTimingMeta(record)
  );
}

async function refreshMonitorRecords(recordIds?: string[]) {
  const logger = createMonitorRefreshLogger("refresh-many", {
    requestedRecordCount: recordIds?.length || "all"
  });
  let refreshed: GrossMarginMonitorRecord[] = [];
  let status = "completed";
  const requestedIds = recordIds?.length ? new Set(recordIds.map((recordId) => recordId.trim())) : null;
  try {
    const records = await timeMonitorOperation(
      logger.onTiming,
      "storage.load-monitor-records",
      async () => (await getGrossMarginMonitorRecords()).filter((record) => !requestedIds || requestedIds.has(record.id)),
      { requestedRecordCount: recordIds?.length || "all" }
    );
    logger.info("records-selected", {
      recordCount: records.length,
      douyinCount: records.filter((record) => record.platform === "douyin").length,
      bilibiliCount: records.filter((record) => record.platform === "bilibili").length
    });
    const douyinRecords = records.filter((record) => record.platform === "douyin");
    const douyinResults = douyinRecords.length
      ? await timeMonitorOperation(
          logger.onTiming,
          "douyin.batch.fetch-total",
          () => getDouyinVideoStatsBatchByUrl(douyinRecords.map((record) => record.videoUrl), {
            onTiming: logger.onTiming,
            timingMeta: { platform: "douyin", mode: "batch", count: douyinRecords.length }
          }),
          { count: douyinRecords.length }
        ).catch(() => [])
      : [];
    const douyinFetchedById = new Map(
      douyinRecords.flatMap((record, index) => {
        const result = douyinResults[index];
        return result ? [[record.id, result] as const] : [];
      })
    );

    const concurrency = monitorRefreshConcurrency();
    refreshed = await timeMonitorOperation(
      logger.onTiming,
      "monitor.records.process",
      () => runWithConcurrency(records, concurrency, async (record) => {
        const fetched = douyinFetchedById.get(record.id);
        if (fetched) return saveRefreshedMonitorRecord(record, fetched, logger.onTiming);
        return refreshMonitorRecordSnapshot(record, logger.onTiming);
      }),
      { recordCount: records.length, concurrency }
    );
    return refreshed;
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    logger.finish(status, {
      refreshedCount: refreshed.length,
      failedCount: refreshed.filter((record) => record.status === "failed").length
    });
  }
}

function monitorRefreshConcurrency() {
  const parsed = Number.parseInt(process.env.GROSS_MARGIN_MONITOR_REFRESH_CONCURRENCY || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MONITOR_REFRESH_CONCURRENCY;
  return Math.max(1, Math.min(parsed, MAX_MONITOR_REFRESH_CONCURRENCY));
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

async function updateMonitorPlayTarget(recordId: string, target: number) {
  const record = await resolveGrossMarginMonitorRecord(recordId);
  return saveGrossMarginMonitorRecord({
    ...record,
    targetStats: {
      ...record.targetStats,
      play: Math.round(target)
    },
    updatedAt: new Date().toISOString()
  });
}

async function updateMonitorPlayCurrent(recordId: string, current: number) {
  const record = await resolveGrossMarginMonitorRecord(recordId);
  if (record.platform !== "douyin") {
    throw new Error("只有抖音监控需要手动填写当前播放量。");
  }
  const updatedAt = new Date().toISOString();
  const roundedCurrent = Math.round(current);
  return saveGrossMarginMonitorRecord({
    ...record,
    currentStats: {
      ...(record.currentStats || {}),
      play: roundedCurrent
    },
    playSamples: appendGrossMarginPlaySample(record.playSamples, roundedCurrent, updatedAt, "manual"),
    updatedAt
  });
}

function normalizeFetchedStatsForMonitor(
  platform: MonitorPlatform,
  stats: Partial<Record<GrossMarginServiceKind, number>>
) {
  if (platform === "bilibili") {
    return {
      play: stats.play,
      like: stats.like,
      coin: stats.coin,
      favorite: stats.favorite,
      comment: stats.comment,
      share: stats.share,
      danmaku: stats.danmaku
    };
  }
  const normalized: Partial<Record<GrossMarginServiceKind, number>> = {
    like: stats.like,
    comment: stats.comment,
    favorite: stats.favorite,
    share: stats.share
  };
  if (typeof stats.play === "number" && Number.isFinite(stats.play)) {
    normalized.play = stats.play;
  }
  return normalized;
}

function parseMaintenanceTemplate(template: string) {
  const normalized = template.replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const stats: Partial<Record<GrossMarginServiceKind, number>> = {};
  const lineRules: Array<{ service: GrossMarginServiceKind; patterns: RegExp[] }> = [
    { service: "play", patterns: [/播放量(?:（[^）]+）)?\s*[：:]\s*([^\n]+)/i] },
    { service: "like", patterns: [/点赞(?:（[^）]+）)?\s*[：:]\s*([^\n]+)/i] },
    { service: "coin", patterns: [/投币\s*[：:]\s*([^\n]+)/i] },
    { service: "favorite", patterns: [/收藏\s*[：:]\s*([^\n]+)/i] },
    { service: "comment", patterns: [/评论(?:（[^）]+）)?\s*[：:]\s*([^\n]+)/i] },
    { service: "share", patterns: [/分享\s*[：:]\s*([^\n]+)/i, /转发\s*[：:]\s*([^\n]+)/i] },
    { service: "danmaku", patterns: [/弹幕\s*[：:]\s*([^\n]+)/i] },
    { service: "blueLink", patterns: [/蓝链点击\s*[：:]\s*([^\n]+)/i] }
  ];

  for (const rule of lineRules) {
    for (const pattern of rule.patterns) {
      const match = normalized.match(pattern);
      if (!match?.[1]) continue;
      stats[rule.service] = toNumber(match[1].trim());
      break;
    }
  }

  return {
    accountName: extractLineValue(lines, ["账号", "账号名", "账号名称", "账号昵称", "达人", "达人名称", "博主"]),
    platform: (normalized.includes("【抖音】") ? "douyin" : normalized.includes("【B站】") ? "bilibili" : undefined) as
      | MonitorPlatform
      | undefined,
    stats
  };
}

async function getDouyinMonitorStats(input: {
  accountName: string;
  url: string;
}, options: {
  timingMeta?: MonitorTimingMeta;
  onTiming?: OpenCliTimingSink;
} = {}) {
  const fallback = await getCachedDouyinVideoStatsByUrl(input.url, options).catch((error) => ({
    platform: "douyin" as const,
    title: "",
    url: input.url,
    publishedAt: "",
    stats: {},
    warning: error instanceof Error ? error.message : "抖音当前数据抓取失败，请手动补充。"
  }));

  return {
    ...fallback,
    warning: "warning" in fallback && fallback.warning ? fallback.warning : ""
  };
}

function getCachedDouyinVideoStatsByUrl(url: string, options: {
  timingMeta?: MonitorTimingMeta;
  onTiming?: OpenCliTimingSink;
} = {}) {
  const cacheKey = extractDouyinAwemeId(url) || normalizeVideoUrlInput(url);
  const now = Date.now();
  const existing = douyinSingleVideoStatsCache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    options.onTiming?.({
      stage: "douyin.single-cache-hit",
      ms: 0,
      ok: true,
      meta: options.timingMeta
    });
    return existing.promise;
  }

  const pending = getDouyinVideoStatsByUrl(url, {
    onTiming: options.onTiming,
    timingMeta: options.timingMeta
  }).catch((error) => {
    const current = douyinSingleVideoStatsCache.get(cacheKey);
    if (current?.promise === pending) douyinSingleVideoStatsCache.delete(cacheKey);
    throw error;
  });
  douyinSingleVideoStatsCache.set(cacheKey, {
    expiresAt: now + DOUYIN_VIDEO_STATS_CACHE_TTL_MS,
    promise: pending
  });
  return pending;
}

type MonitorTimingMeta = Record<string, string | number | boolean | null | undefined>;

function createMonitorRefreshLogger(action: string, meta: MonitorTimingMeta = {}) {
  const runId = `${Date.now().toString(36)}-${shortHash(`${action}-${JSON.stringify(meta)}`)}`;
  const startedAt = Date.now();
  logMonitorRefreshEvent("start", {
    runId,
    action,
    meta: compactMonitorMeta(meta)
  });

  const onTiming: OpenCliTimingSink = (entry) => {
    logMonitorRefreshEvent("timing", {
      runId,
      action,
      stage: entry.stage,
      ms: entry.ms,
      ok: entry.ok,
      meta: compactMonitorMeta(entry.meta),
      error: entry.error
    });
  };

  return {
    onTiming,
    info(event: string, payload: MonitorTimingMeta = {}) {
      logMonitorRefreshEvent(event, {
        runId,
        action,
        meta: compactMonitorMeta(payload)
      });
    },
    finish(status: string, payload: MonitorTimingMeta = {}) {
      logMonitorRefreshEvent("finish", {
        runId,
        action,
        status,
        totalMs: Date.now() - startedAt,
        meta: compactMonitorMeta(payload)
      });
    }
  };
}

async function timeMonitorOperation<T>(
  onTiming: OpenCliTimingSink | undefined,
  stage: string,
  operation: () => Promise<T>,
  meta?: MonitorTimingMeta
) {
  const startedAt = Date.now();
  try {
    const result = await operation();
    onTiming?.({
      stage,
      ms: Date.now() - startedAt,
      ok: true,
      meta: compactMonitorMeta(meta)
    });
    return result;
  } catch (error) {
    onTiming?.({
      stage,
      ms: Date.now() - startedAt,
      ok: false,
      meta: compactMonitorMeta(meta),
      error: formatMonitorTimingError(error)
    });
    throw error;
  }
}

function recordTimingMeta(record: GrossMarginMonitorRecord): MonitorTimingMeta {
  return {
    recordId: record.id,
    platform: record.platform,
    videoKey: record.videoKey || getVideoComparableKey(record.videoUrl),
    accountName: record.accountName || ""
  };
}

function compactMonitorMeta(meta?: MonitorTimingMeta) {
  if (!meta) return undefined;
  const compact: MonitorTimingMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== "") compact[key] = value;
  }
  return Object.keys(compact).length ? compact : undefined;
}

function logMonitorRefreshEvent(event: string, payload: Record<string, unknown>) {
  const compactPayload = Object.fromEntries(
    Object.entries({
      at: new Date().toISOString(),
      event,
      ...payload
    }).filter(([, value]) => value !== undefined)
  );
  console.log(`${MONITOR_REFRESH_LOG_PREFIX} ${JSON.stringify(compactPayload)}`);
}

function formatMonitorTimingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.replace(/\s+/g, " ").trim().slice(0, 220);
}

function extractLineValue(lines: string[], labels: string | string[]) {
  const labelList = Array.isArray(labels) ? labels : [labels];
  for (const label of labelList) {
    const pattern = new RegExp(`^${escapeRegExp(label)}\\s*[：:]\\s*(.+)$`, "i");
    const matched = lines.find((line) => pattern.test(line));
    if (matched) return matched.replace(pattern, "$1").trim();
  }
  return "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveMonitorPlatform(url: string, templatePlatform?: MonitorPlatform, platformHint?: MonitorPlatform) {
  const platformFromUrl = detectVideoPlatform(url);
  if (platformFromUrl) return platformFromUrl;
  if (extractBvid(url)) return "bilibili" as const;
  if (extractDouyinAwemeId(url)) return "douyin" as const;
  if (templatePlatform) return templatePlatform;
  if (platformHint) return platformHint;
  throw new Error("没有识别到平台，请粘贴视频链接。");
}

function resolveVideoUrl(explicitUrl: string, template: string) {
  const direct = extractVideoUrl(explicitUrl) || explicitUrl.trim();
  const urlMatch = extractTemplateUrl(template);
  const warnings: string[] = [];
  if (direct && urlMatch && getVideoComparableKey(direct) !== getVideoComparableKey(urlMatch)) {
    warnings.push("视频链接与维护模板里的链接不一致，已优先使用维护模板里的链接。");
  }
  if (urlMatch) return { url: urlMatch, warnings };
  if (direct) return { url: direct, warnings };
  throw new Error("没有从模板里识别到视频链接，请补充链接后再查询。");
}

function extractTemplateUrl(template: string) {
  return extractVideoUrl(template);
}

function makeDefaultGrossMarginProjectName(count: number) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${month}${day} 批量监控 ${count} 条`;
}
