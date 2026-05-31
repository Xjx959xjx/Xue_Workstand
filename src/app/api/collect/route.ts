import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { collectVideos, resolveAccountUid } from "@/lib/opencli";
import { findAccountByName, getAccountSummary, saveVideos, upsertAccount } from "@/lib/storage";
import { collectOrders, CollectOrder, Platform, platforms, Video } from "@/lib/types";
import { normalizeLinkInput } from "@/lib/link-input";
import { nowIso } from "@/lib/utils";

export const runtime = "nodejs";
const BILIBILI_CANDIDATE_LIMIT = 50;
const DOUYIN_CANDIDATE_LIMIT = 120;
const MIN_LOCAL_SORT_CANDIDATE_LIMIT = 20;
const MAX_DATE_FILTER_PAGES = 8;
const collectOrderSchemaValues = [...collectOrders, "like", "click", "stow"] as const;
const bilibiliCollectOrders = ["views", "likes", "favorites", "comments", "pubdate"] as const;
const douyinCollectOrders = ["likes", "comments", "pubdate"] as const;
type LegacyCollectOrder = CollectOrder | "like" | "click" | "stow";

const schema = z.object({
  platform: z.enum(platforms),
  name: z.string().min(1),
  uidOrUrl: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  order: z.enum(collectOrderSchemaValues).default("likes"),
  fromDate: z.string().optional(),
  toDate: z.string().optional()
});

export async function POST(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, schema);
    const uidOrUrl = input.uidOrUrl ? normalizeLinkInput(input.uidOrUrl, { kind: "account" }) : "";
    const order = normalizeCollectOrder(input.order);
    validateCollectOrder(input.platform, order);
    const existing = !uidOrUrl ? await findAccountByName(input.platform, input.name) : null;
    const uid = existing?.uid || (await resolveAccountUid(input.platform, input.name, uidOrUrl));
    const account = await upsertAccount({
      platform: input.platform,
      name: input.name,
      uid,
      sourceUrl: uidOrUrl || input.name
    });

    const collectPlan = makeCollectPlan(input.platform, input.limit, order, input.fromDate, input.toDate);
    const result = await collectVideos({
      platform: input.platform,
      account,
      limit: collectPlan.limit,
      order: collectPlan.order,
      hydrateDetails: collectPlan.hydrateDetails,
      fromDate: input.platform === "douyin" ? input.fromDate : undefined,
      toDate: input.platform === "douyin" ? input.toDate : undefined
    });
    if (collectPlan.pageByPubdate && input.platform === "bilibili") {
      result.videos = await collectDateWindowCandidates({
        account,
        fromDate: input.fromDate,
        toDate: input.toDate,
        firstPageVideos: result.videos,
        hydrateDetails: collectPlan.hydrateDetails
      });
      result.rawCount = result.videos.length;
    }

    const updatedAccount = await upsertAccount({
      platform: input.platform,
      name: input.name,
      uid,
      sourceUrl: uidOrUrl || input.name,
      lastCollectedAt: nowIso()
    });

    const dateFilter = buildDateFilterResult(result.videos, input.fromDate, input.toDate);
    const filteredVideos = selectVideosForSave({
      videos: dateFilter.filteredVideos,
      limit: input.limit,
      order
    });
    const videos = sortVideos(await saveVideos(updatedAccount, filteredVideos), order);

    return {
      account: await getAccountSummary(updatedAccount),
      videos,
      command: result.command,
      rawCount: result.rawCount,
      filteredCount: filteredVideos.length,
      dateFilter: dateFilter.summary
    };
  }, {
    fallbackMessage: "采集失败"
  });
}

function normalizeCollectOrder(order: LegacyCollectOrder): CollectOrder {
  if (order === "click") return "views";
  if (order === "stow") return "favorites";
  if (order === "like") return "likes";
  return order;
}

function validateCollectOrder(platform: Platform, order: CollectOrder) {
  const allowedOrders = platform === "bilibili" ? bilibiliCollectOrders : douyinCollectOrders;
  if ((allowedOrders as readonly CollectOrder[]).includes(order)) return;
  const readable = platform === "bilibili" ? "播放、点赞、收藏、评论、时间" : "点赞、评论、时间";
  throw new Error(`${platform === "bilibili" ? "B站" : "抖音"}只支持按${readable}筛选。`);
}

function makeCollectPlan(
  platform: Platform,
  limit: number,
  order: CollectOrder,
  fromDate?: string,
  toDate?: string
): {
  limit: number;
  order: CollectOrder;
  pageByPubdate: boolean;
  hydrateDetails: boolean;
} {
  const hasDateFilter = Boolean(fromDate || toDate);
  const needsLocalMetricSort = order === "likes" || order === "comments";
  return {
    limit: needsLocalMetricSort ? localSortCandidateLimit(platform, limit) : limit,
    order: hasDateFilter ? "pubdate" : getCollectionOrder(order),
    pageByPubdate: platform === "bilibili" && hasDateFilter,
    hydrateDetails: false
  };
}

function localSortCandidateLimit(platform: Platform, limit: number) {
  const cap = platform === "douyin" ? DOUYIN_CANDIDATE_LIMIT : BILIBILI_CANDIDATE_LIMIT;
  return Math.min(cap, Math.max(limit, limit * 2, MIN_LOCAL_SORT_CANDIDATE_LIMIT));
}

function getCollectionOrder(order: CollectOrder): CollectOrder {
  if (order === "favorites") return "favorites";
  if (order === "pubdate") return "pubdate";
  return "views";
}

async function collectDateWindowCandidates(input: {
  account: Parameters<typeof collectVideos>[0]["account"];
  fromDate?: string;
  toDate?: string;
  firstPageVideos: Video[];
  hydrateDetails: boolean;
}) {
  const from = parseBoundaryDate(input.fromDate, "start");
  const to = parseBoundaryDate(input.toDate, "end");
  const videos = [...input.firstPageVideos];

  for (let page = 2; page <= MAX_DATE_FILTER_PAGES; page += 1) {
    if (shouldStopPaging(videos, from, to)) break;
    const nextPage = await collectVideos({
      platform: "bilibili",
      account: input.account,
      limit: BILIBILI_CANDIDATE_LIMIT,
      order: "pubdate",
      page,
      hydrateDetails: input.hydrateDetails
    });
    if (!nextPage.videos.length) break;
    videos.push(...nextPage.videos);
  }

  return dedupeVideos(videos);
}

function selectVideosForSave(input: {
  videos: Video[];
  limit: number;
  order: CollectOrder;
}) {
  return sortVideos(input.videos, input.order).slice(0, input.limit);
}

function shouldStopPaging(videos: Video[], from: Date | null, to: Date | null) {
  const dated = videos.map((video) => parsePublishedAt(video.publishedAt)).filter((date): date is Date => Boolean(date));
  if (!dated.length) return false;
  const oldest = dated.reduce((min, date) => (date < min ? date : min), dated[0]);
  if (!from) return Boolean(to && oldest <= to);
  const hasCandidateInWindow = !to || dated.some((date) => date <= to);
  return hasCandidateInWindow && oldest < from;
}

function dedupeVideos(videos: Video[]) {
  const seen = new Set<string>();
  return videos.filter((video) => {
    const key = video.id || video.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDateFilterResult(videos: Video[], fromDate?: string, toDate?: string) {
  const from = parseBoundaryDate(fromDate, "start");
  const to = parseBoundaryDate(toDate, "end");
  const datedVideos = videos
    .map((video) => ({ video, publishedAt: parsePublishedAt(video.publishedAt) }))
    .filter((item): item is { video: Video; publishedAt: Date } => Boolean(item.publishedAt));

  if (!from && !to) {
    return {
      filteredVideos: videos,
      summary: {
        applied: false,
        rawCount: videos.length,
        matchedCount: videos.length,
        filteredOutCount: 0,
        missingDateCount: videos.length - datedVideos.length,
        ...dateSpan(datedVideos.map((item) => item.publishedAt))
      }
    };
  }

  const filteredVideos = datedVideos
    .filter(({ publishedAt }) => {
      if (from && publishedAt < from) return false;
      if (to && publishedAt > to) return false;
      return true;
    })
    .map(({ video }) => video);

  return {
    filteredVideos,
    summary: {
      applied: true,
      fromDate,
      toDate,
      rawCount: videos.length,
      matchedCount: filteredVideos.length,
      filteredOutCount: videos.length - filteredVideos.length,
      missingDateCount: videos.length - datedVideos.length,
      ...dateSpan(datedVideos.map((item) => item.publishedAt))
    }
  };
}

function sortVideos(videos: Video[], order: CollectOrder) {
  const sorted = [...videos];
  if (order === "pubdate") {
    return sorted.sort((a, b) => compareDates(b.publishedAt, a.publishedAt) || compareByMetric(b, a, "likes"));
  }
  return sorted.sort(
    (a, b) =>
      compareByMetric(b, a, order) ||
      compareByMetric(b, a, "views") ||
      compareByMetric(b, a, "likes") ||
      compareDates(b.publishedAt, a.publishedAt)
  );
}

function compareByMetric(a: Video, b: Video, order: CollectOrder) {
  if (order === "pubdate") return compareDates(a.publishedAt, b.publishedAt);
  return statValue(a, order) - statValue(b, order);
}

function statValue(video: Video, order: Exclude<CollectOrder, "pubdate">) {
  if (order === "views") return video.stats.views;
  if (order === "likes") return video.stats.likes;
  if (order === "favorites") return video.stats.favorites;
  return video.stats.comments;
}

function compareDates(a?: string, b?: string) {
  return (parsePublishedAt(a)?.getTime() || 0) - (parsePublishedAt(b)?.getTime() || 0);
}

function parseBoundaryDate(value: string | undefined, boundary: "start" | "end") {
  if (!value) return null;
  const date = new Date(`${value}T${boundary === "start" ? "00:00:00" : "23:59:59"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePublishedAt(value: string | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const dateOnly = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
  }

  const date = new Date(normalized.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateSpan(dates: Date[]) {
  if (!dates.length) return {};
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  return {
    earliestPublishedAt: toDateInputValue(sorted[0]),
    latestPublishedAt: toDateInputValue(sorted[sorted.length - 1])
  };
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
