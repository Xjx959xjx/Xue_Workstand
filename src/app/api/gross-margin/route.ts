import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getBilibiliVideoStatsByUrl,
  getDouyinVideoStatsByUrl,
} from "@/lib/opencli";
import {
  deleteGrossMarginMonitorRecord,
  getGrossMarginLibrary,
  getGrossMarginMonitorRecords,
  resolveGrossMarginMonitorRecord,
  saveGrossMarginMonitorRecord,
  saveGrossMarginPriceTable,
  upsertGrossMarginMonitorRecord
} from "@/lib/storage";
import type {
  GrossMarginDifferenceQueryResult,
  GrossMarginMonitorRecord,
  GrossMarginPriceTable,
  GrossMarginServiceKind
} from "@/lib/types";
import { extractBvid, extractDouyinAwemeId, toNumber } from "@/lib/utils";
import { detectVideoPlatform, extractVideoUrl, getVideoComparableKey, normalizeVideoUrlInput } from "@/lib/video-links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const platformSchema = z.enum(["douyin", "bilibili"]);
const serviceSchema = z.enum(["play", "like", "douPlus", "coin", "comment", "share", "favorite", "danmaku", "blueLink"]);
const amountSchema = z.coerce.number().finite().min(0, "金额不能小于 0").max(100_000_000, "金额过大，请检查输入");
const minimumQuantitySchema = z.coerce.number().finite().gt(0, "起量必须大于 0").max(100_000_000, "起量过大，请检查输入");
const DOUYIN_VIDEO_STATS_CACHE_TTL_MS = 3 * 60 * 1000;

const douyinSingleVideoStatsCache = new Map<
  string,
  {
    expiresAt: number;
    promise: ReturnType<typeof getDouyinVideoStatsByUrl>;
  }
>();

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
    action: z.literal("queryDifference"),
    template: z.string().trim().min(1, "请先粘贴维护模板"),
    platformHint: platformSchema.optional(),
    videoUrl: z.string().trim().optional(),
    manualCurrentStats: z
      .object({
        play: z.coerce.number().finite().min(0).optional(),
        like: z.coerce.number().finite().min(0).optional(),
        douPlus: z.coerce.number().finite().min(0).optional(),
        coin: z.coerce.number().finite().min(0).optional(),
        comment: z.coerce.number().finite().min(0).optional(),
        share: z.coerce.number().finite().min(0).optional(),
        favorite: z.coerce.number().finite().min(0).optional(),
        danmaku: z.coerce.number().finite().min(0).optional(),
        blueLink: z.coerce.number().finite().min(0).optional()
      })
      .optional()
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
    action: z.literal("refreshMonitorRecord"),
    recordId: z.string().trim().min(1, "缺少监控记录 ID")
  }),
  z.object({
    action: z.literal("refreshMonitorRecords")
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
  try {
    return NextResponse.json(await getGrossMarginLibrary());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取毛利单价表失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = mutationSchema.parse(await request.json());
    if (input.action === "queryDifference") {
      return NextResponse.json(await queryGrossMarginDifference(input));
    }
    if (input.action === "saveMonitorRecord") {
      const record = await saveMonitorRecordFromInput(input);
      return NextResponse.json({ record, library: await getGrossMarginLibrary() });
    }
    if (input.action === "refreshMonitorRecord") {
      const record = await refreshMonitorRecord(input.recordId);
      return NextResponse.json({ record, library: await getGrossMarginLibrary() });
    }
    if (input.action === "refreshMonitorRecords") {
      const records = await refreshMonitorRecords();
      return NextResponse.json({ records, library: await getGrossMarginLibrary() });
    }
    if (input.action === "updateMonitorPlayTarget") {
      const record = await updateMonitorPlayTarget(input.recordId, input.target);
      return NextResponse.json({ record, library: await getGrossMarginLibrary() });
    }
    if (input.action === "updateMonitorPlayCurrent") {
      const record = await updateMonitorPlayCurrent(input.recordId, input.current);
      return NextResponse.json({ record, library: await getGrossMarginLibrary() });
    }
    if (input.action === "deleteMonitorRecord") {
      const result = await deleteGrossMarginMonitorRecord(input.recordId);
      return NextResponse.json({ ...result, library: await getGrossMarginLibrary() });
    }
    const table = await saveGrossMarginPriceTable(input);
    return NextResponse.json({ table, library: await getGrossMarginLibrary() });
  } catch (error) {
    return NextResponse.json(
      { error: formatGrossMarginError(error) },
      { status: 400 }
    );
  }
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

type DifferencePlatform = GrossMarginPriceTable["platform"];

async function queryGrossMarginDifference(input: z.infer<typeof mutationSchema> & { action: "queryDifference" }) {
  const parsed = parseMaintenanceTemplate(input.template);
  const resolvedVideo = resolveVideoUrl(input.videoUrl || "", input.template);
  const url = await normalizeDifferenceVideoUrl(resolvedVideo.url);
  const platform = resolveDifferencePlatform(url, parsed.platform, input.platformHint);
  const fetched =
    platform === "bilibili"
      ? await getBilibiliVideoStatsByUrl(url)
      : await getDouyinDifferenceStats({
          accountName: parsed.accountName,
          url
        });
  const currentStats = {
    ...fetched.stats,
    ...(input.manualCurrentStats || {})
  };
  const result = buildDifferenceResult({
    currentStats,
    fetchedTitle: fetched.title,
    platform,
    templateStats: parsed.stats,
    templateText: input.template,
    url: fetched.url || url,
    warnings: [...resolvedVideo.warnings, "warning" in fetched && fetched.warning ? fetched.warning : ""].filter(Boolean)
  });
  return result satisfies GrossMarginDifferenceQueryResult;
}

async function saveMonitorRecordFromInput(input: z.infer<typeof mutationSchema> & { action: "saveMonitorRecord" }) {
  const parsed = parseMaintenanceTemplate(input.sourceText);
  const targetStats = {
    ...parsed.stats,
    ...(input.targetStats || {})
  };
  const resolvedVideo = resolveVideoUrl(input.videoUrl, input.sourceText);
  const videoUrl = await normalizeDifferenceVideoUrl(resolvedVideo.url);
  const platform = resolveDifferencePlatform(videoUrl, parsed.platform, input.platform);
  const videoKey = getVideoComparableKey(videoUrl);
  return upsertGrossMarginMonitorRecord({
    platform,
    accountName: input.accountName || parsed.accountName,
    videoUrl,
    videoKey,
    sourceText: input.sourceText,
    targetStats
  });
}

async function refreshMonitorRecord(recordId: string) {
  const record = await resolveGrossMarginMonitorRecord(recordId);
  return refreshMonitorRecordSnapshot(record);
}

async function refreshMonitorRecordSnapshot(
  record: GrossMarginMonitorRecord
) {
  const warnings: string[] = [];
  try {
    const fetched =
      record.platform === "bilibili"
        ? await getBilibiliVideoStatsByUrl(record.videoUrl)
        : await getDouyinDifferenceStats({
            accountName: record.accountName,
            url: record.videoUrl
          });
    if ("warning" in fetched && fetched.warning) warnings.push(fetched.warning);
    const fetchedStats = normalizeFetchedStatsForMonitor(record.platform, fetched.stats);
    const currentStats =
      record.platform === "douyin" && typeof record.currentStats?.play === "number"
        ? { ...fetchedStats, play: record.currentStats.play }
        : fetchedStats;
    return saveGrossMarginMonitorRecord({
      ...record,
      title: fetched.title || record.title,
      videoUrl: fetched.url || record.videoUrl,
      publishedAt: fetched.publishedAt || record.publishedAt,
      previousStats: record.currentStats,
      currentStats,
      status: "completed",
      warnings,
      lastRefreshedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return saveGrossMarginMonitorRecord({
      ...record,
      status: "failed",
      warnings: [error instanceof Error ? error.message : "刷新监控数据失败"],
      lastRefreshedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}

async function refreshMonitorRecords() {
  const records = await getGrossMarginMonitorRecords();
  const refreshed: GrossMarginMonitorRecord[] = [];
  for (const record of records) {
    refreshed.push(await refreshMonitorRecordSnapshot(record));
  }
  return refreshed;
}

async function updateMonitorPlayTarget(recordId: string, target: number) {
  const record = await resolveGrossMarginMonitorRecord(recordId);
  if (record.platform !== "bilibili") {
    throw new Error("抖音播放量抓不到，请在监控卡片里填写当前播放量。");
  }
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
  return saveGrossMarginMonitorRecord({
    ...record,
    currentStats: {
      ...(record.currentStats || {}),
      play: Math.round(current)
    },
    updatedAt: new Date().toISOString()
  });
}

function normalizeFetchedStatsForMonitor(
  platform: DifferencePlatform,
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
      | DifferencePlatform
      | undefined,
    stats
  };
}

async function getDouyinDifferenceStats(input: {
  accountName: string;
  url: string;
}) {
  const fallback = await getCachedDouyinVideoStatsByUrl(input.url).catch((error) => ({
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

function getCachedDouyinVideoStatsByUrl(url: string) {
  const cacheKey = extractDouyinAwemeId(url) || normalizeVideoUrlInput(url);
  const now = Date.now();
  const existing = douyinSingleVideoStatsCache.get(cacheKey);
  if (existing && existing.expiresAt > now) return existing.promise;

  const pending = getDouyinVideoStatsByUrl(url).catch((error) => {
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

function resolveDifferencePlatform(url: string, templatePlatform?: DifferencePlatform, platformHint?: DifferencePlatform) {
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

async function normalizeDifferenceVideoUrl(url: string) {
  const trimmed = normalizeVideoUrlInput(url);
  if (!trimmed || !/v\.douyin\.com/i.test(trimmed)) return trimmed;

  try {
    const response = await fetch(trimmed, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 style-library",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    return normalizeVideoUrlInput(response.url || trimmed);
  } catch {
    return trimmed;
  }
}

function extractTemplateUrl(template: string) {
  return extractVideoUrl(template);
}

function buildDifferenceResult(input: {
  platform: DifferencePlatform;
  url: string;
  fetchedTitle?: string;
  templateText: string;
  templateStats: Partial<Record<GrossMarginServiceKind, number>>;
  currentStats: Partial<Record<GrossMarginServiceKind, number>>;
  warnings?: string[];
}) {
  const orderedServices: Array<{ service: GrossMarginServiceKind; label: string }> =
    input.platform === "bilibili"
      ? [
          { service: "play", label: "播放量" },
          { service: "like", label: "点赞" },
          { service: "coin", label: "投币" },
          { service: "favorite", label: "收藏" },
          { service: "comment", label: "评论" },
          { service: "share", label: "分享" },
          { service: "danmaku", label: "弹幕" },
          { service: "blueLink", label: "蓝链点击" }
        ]
      : [
          { service: "play", label: "播放量" },
          { service: "like", label: "点赞" },
          { service: "comment", label: "评论" },
          { service: "favorite", label: "收藏" },
          { service: "share", label: "转发" }
        ];
  const warnings: string[] = [...(input.warnings || [])];

  const lines = orderedServices
    .map(({ service, label }) => {
      const current = input.currentStats[service];
      const templateValue = input.templateStats[service];
      const hasTemplateValue = typeof templateValue === "number" && !Number.isNaN(templateValue);

      if (service === "blueLink" && (!hasTemplateValue || templateValue <= 0)) {
        return "";
      }

      const hasCurrent = typeof current === "number" && !Number.isNaN(current);
      if (input.platform === "douyin" && service === "play" && !hasCurrent) {
        warnings.push("抖音播放量抓不到，请手动补充当前播放量后再生成播放差额。");
        return "";
      }
      if (!hasCurrent && service !== "blueLink") {
        warnings.push(`${label} 没有抓到当前数据，暂时按 0 处理。`);
      }
      if (!hasTemplateValue) {
        warnings.push(`${label} 没有从维护模板里识别到，暂时按 0 处理。`);
      }

      const difference = Math.max(0, (templateValue || 0) - (hasCurrent ? current : 0));
      return `${label}：${formatDifferenceValue(service, difference, input.platform)}`;
    })
    .filter(Boolean);

  return {
    platform: input.platform,
    title: input.fetchedTitle || "",
    url: input.url,
    warnings: uniqueWarnings(warnings),
    result: ["@罗月琴 目前差额：", "", ...lines].join("\n")
  };
}

function formatDifferenceValue(service: GrossMarginServiceKind, value: number, platform: DifferencePlatform) {
  if (service === "play" && value >= 10_000) {
    return `${stripTrailingZeros((value / 10_000).toFixed(2))}${platform === "bilibili" ? "W" : "万"}`;
  }
  return String(Math.round(value));
}

function stripTrailingZeros(value: string) {
  return value.replace(/\.?0+$/, "");
}

function uniqueWarnings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
