import { buildDouyinVideoUrl } from "@/lib/platform-links";
import type {
  DouyinHotlistAccount,
  DouyinHotlistItem,
  DouyinHotlistRefreshAccountResult,
  DouyinHotlistRefreshJobResult,
  DouyinHotlistResponse,
  JobRecord,
  Platform
} from "@/lib/types";

export const DEFAULT_WINDOW = "3d";
export const MAX_REFRESH_LOGS = 6;

export type BusyState = "" | "load" | "add" | `remove:${string}`;
export type AccountSelection = "all" | string;
export type MetricTone = "views" | "likes" | "comments" | "favorites" | "shares";
export type SortMode = "heat" | "likes" | "comments" | "saves" | "recent";
export type WindowFilter = "3h" | "6h" | "12h" | "24h" | "3d";
export type RefreshLogStatus = "success" | "warning" | "failed" | "skipped";
export type RefreshLogGroupKind = "failed" | "recovered" | "unchanged";

export type RefreshLogGroup = {
  kind: RefreshLogGroupKind;
  accounts: string[];
  reason?: string;
};

export type RefreshLogEntry = {
  id: string;
  at: string;
  automatic: boolean;
  status: RefreshLogStatus;
  text: string;
  groups?: RefreshLogGroup[];
  /** 兼容旧版本已经写入 localStorage 的逐条明细。 */
  details?: string[];
};

export type RefreshHotlistOptions = {
  automatic?: boolean;
};

export type RefreshJobSettlement = {
  automatic: boolean;
  reload: boolean;
  log: Omit<RefreshLogEntry, "id" | "at">;
};

export const sortOptions: { value: SortMode; label: string }[] = [
  { value: "heat", label: "综合热度" },
  { value: "likes", label: "点赞最高" },
  { value: "comments", label: "评论最多" },
  { value: "saves", label: "收藏/转发" },
  { value: "recent", label: "最新发布" }
];

export const windowOptions: { value: WindowFilter; label: string; labelText: string }[] = [
  { value: "3h", label: "3h", labelText: "近 3 小时" },
  { value: "6h", label: "6h", labelText: "近 6 小时" },
  { value: "12h", label: "12h", labelText: "近 12 小时" },
  { value: "24h", label: "24h", labelText: "近 24 小时" },
  { value: "3d", label: "3天", labelText: "近 3 天" }
];

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const logTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

export function parseSortMode(value: string | null): SortMode {
  return sortOptions.some((option) => option.value === value) ? value as SortMode : "heat";
}

export function parseWindowFilter(value: string | null): WindowFilter {
  return windowOptions.some((option) => option.value === value) ? value as WindowFilter : DEFAULT_WINDOW;
}

export function buildHotlistHref({
  account,
  pathname,
  search,
  sort,
  window
}: {
  account: AccountSelection;
  pathname: string;
  search: string;
  sort: SortMode;
  window: WindowFilter;
}) {
  const params = new URLSearchParams(search);
  if (account === "all") params.delete("account");
  else params.set("account", account);
  if (sort === "heat") params.delete("sort");
  else params.set("sort", sort);
  if (window === DEFAULT_WINDOW) params.delete("window");
  else params.set("window", window);
  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function getVisibleHotlistItems({
  items,
  selectedAccountId,
  selectedPlatform,
  sortMode
}: {
  items: DouyinHotlistItem[];
  selectedAccountId: AccountSelection;
  selectedPlatform: Platform | null;
  sortMode: SortMode;
}) {
  return items
    .filter(
      (item) =>
        selectedAccountId === "all" ||
        item.account.id === selectedAccountId ||
        item.account.platform === selectedPlatform
    )
    .sort((left, right) => compareHotlistItems(left, right, sortMode))
    .map((item, index) => ({ item, displayRank: index + 1 }));
}

export function parseStoredRefreshLogs(value: string | null): RefreshLogEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRefreshLogEntry).slice(0, MAX_REFRESH_LOGS);
  } catch {
    return [];
  }
}

function isRefreshLogEntry(value: unknown): value is RefreshLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RefreshLogEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.at === "string" &&
    typeof entry.automatic === "boolean" &&
    typeof entry.text === "string" &&
    isRefreshLogStatus(entry.status) &&
    (entry.groups === undefined || (Array.isArray(entry.groups) && entry.groups.every(isRefreshLogGroup))) &&
    (entry.details === undefined || (Array.isArray(entry.details) && entry.details.every((detail) => typeof detail === "string")))
  );
}

function isRefreshLogGroup(value: unknown): value is RefreshLogGroup {
  if (!value || typeof value !== "object") return false;
  const group = value as Partial<RefreshLogGroup>;
  return (
    (group.kind === "failed" || group.kind === "recovered" || group.kind === "unchanged") &&
    Array.isArray(group.accounts) &&
    group.accounts.length > 0 &&
    group.accounts.every((account) => typeof account === "string" && Boolean(account.trim())) &&
    (group.reason === undefined || typeof group.reason === "string")
  );
}

function isRefreshLogStatus(value: unknown): value is RefreshLogStatus {
  return value === "success" || value === "warning" || value === "failed" || value === "skipped";
}

export function compareHotlistItems(left: DouyinHotlistItem, right: DouyinHotlistItem, mode: SortMode) {
  if (mode === "likes") {
    return right.video.stats.likes - left.video.stats.likes || right.heatScore - left.heatScore;
  }
  if (mode === "comments") {
    return right.video.stats.comments - left.video.stats.comments || right.heatScore - left.heatScore;
  }
  if (mode === "saves") {
    return getSaveShareScore(right) - getSaveShareScore(left) || right.heatScore - left.heatScore;
  }
  if (mode === "recent") {
    return getTimeValue(right.video.publishedAt) - getTimeValue(left.video.publishedAt) || right.heatScore - left.heatScore;
  }
  return right.heatScore - left.heatScore || getTimeValue(right.video.publishedAt) - getTimeValue(left.video.publishedAt);
}

export function getRankClass(rank: number) {
  if (rank === 1) return "rank-one";
  if (rank === 2) return "rank-two";
  if (rank === 3) return "rank-three";
  return "";
}

export function getSurgeClass(surge?: DouyinHotlistItem["surge"]) {
  if (!surge) return "";
  return surge.label === "猛涨" ? "is-surging surge-rapid" : "is-surging surge-rising";
}

export function getHeatStrength(score: number, maxScore: number) {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return 8;
  return Math.max(8, Math.min(100, Math.round((score / maxScore) * 100)));
}

export function getTimeValue(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function formatNumber(value: number | undefined) {
  return numberFormatter.format(value || 0);
}

export function getWindowLabel(value: string) {
  return windowOptions.find((option) => option.value === value)?.labelText ||
    windowOptions.find((option) => option.value === DEFAULT_WINDOW)?.labelText ||
    "近 3 天";
}

export function formatDate(value?: string) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return dateFormatter.format(date);
}

export function formatLogTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未知时间";
  return logTimeFormatter.format(date);
}

export function getRefreshLogStatusLabel(status: RefreshLogStatus) {
  if (status === "success") return "完成";
  if (status === "warning") return "部分失败";
  if (status === "failed") return "失败";
  return "跳过";
}

export function formatAge(ageHours: number) {
  if (ageHours < 1) return "1 小时内";
  if (ageHours < 24) return `${Math.round(ageHours)} 小时前`;
  return `${Math.round(ageHours / 24)} 天前`;
}

export function getAccountInitial(name: string) {
  return Array.from(name.trim()).at(0)?.toLocaleUpperCase("zh-CN") || "视";
}

export function getAvatarTone(id: string) {
  return Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 8;
}

export function getPlatformLabel(platform: Platform) {
  return platform === "bilibili" ? "B站" : "抖音";
}

export function getPlatformAccountSelection(platform: Platform) {
  return `platform:${platform}`;
}

export function getSelectionPlatform(value: AccountSelection): Platform | null {
  if (value === getPlatformAccountSelection("bilibili")) return "bilibili";
  if (value === getPlatformAccountSelection("douyin")) return "douyin";
  return null;
}

export function getAccountInputPlaceholder(platform: Platform) {
  return platform === "bilibili" ? "输入 B站账号名、UID 或主页链接…" : "输入抖音账号名、sec_uid 或主页链接…";
}

export function getMetricItems(video: DouyinHotlistItem["video"]): Array<{ label: string; tone: MetricTone; value: number }> {
  if (video.platform === "bilibili") {
    return [
      { label: "播放", tone: "views", value: video.stats.views },
      { label: "点赞", tone: "likes", value: video.stats.likes },
      { label: "评论", tone: "comments", value: video.stats.comments },
      { label: "收藏", tone: "favorites", value: video.stats.favorites }
    ];
  }
  return [
    { label: "点赞", tone: "likes", value: video.stats.likes },
    { label: "评论", tone: "comments", value: video.stats.comments },
    { label: "收藏", tone: "favorites", value: video.stats.favorites },
    { label: "转发", tone: "shares", value: video.stats.shares || 0 }
  ];
}

export function getVideoExternalUrl(video: DouyinHotlistItem["video"]) {
  return video.platform === "douyin" ? buildDouyinVideoUrl(video.id) || video.url : video.url;
}

export function isTerminalRefreshJob(job: JobRecord) {
  return job.kind === "hotlist-refresh" && !["queued", "running"].includes(job.status);
}

export function getRefreshJobSettlement(job: JobRecord): RefreshJobSettlement {
  const result = getRefreshJobResult(job);
  const automatic = result?.automatic ?? job.title.startsWith("自动");

  if (job.status === "completed") {
    if (!result) {
      const message = job.error || "刷新已完成，但任务明细暂未同步。";
      return {
        automatic,
        reload: true,
        log: { automatic, status: job.error ? "warning" : "success", text: message }
      };
    }
    return {
      automatic,
      reload: true,
      log: {
        automatic,
        status: result.refresh.failed ? "warning" : "success",
        text: buildRefreshLogText(result.refresh, result.summary.windowLabel),
        groups: buildRefreshLogGroups(result.refresh.accounts)
      }
    };
  }

  if (job.status === "cancelled" || job.status === "interrupted") {
    const message = job.status === "cancelled" ? "刷新任务已停止。" : "刷新任务因服务重启中断，请重新发起。";
    return {
      automatic,
      reload: false,
      log: { automatic, status: "skipped", text: message }
    };
  }

  const error = job.error || job.message || "视频热榜刷新失败";
  return {
    automatic,
    reload: false,
    log: { automatic, status: "failed", text: compactRefreshError(error) }
  };
}

function getSaveShareScore(item: DouyinHotlistItem) {
  return item.video.stats.favorites + (item.video.stats.shares || 0);
}

function getRefreshJobResult(job: JobRecord): DouyinHotlistRefreshJobResult | null {
  if (!job.result || typeof job.result !== "object") return null;
  const result = job.result as Partial<DouyinHotlistRefreshJobResult>;
  if (!result.refresh || !result.summary || typeof result.automatic !== "boolean") return null;
  return result as DouyinHotlistRefreshJobResult;
}

function buildRefreshLogGroups(accounts: DouyinHotlistRefreshAccountResult[]): RefreshLogGroup[] {
  const groups: RefreshLogGroup[] = [];
  const failedByReason = new Map<string, string[]>();

  accounts.filter((account) => account.status === "failed").forEach((account) => {
    const reason = compactRefreshError(account.error || "未返回可用结果");
    failedByReason.set(reason, [...(failedByReason.get(reason) || []), account.name]);
  });

  failedByReason.forEach((failedAccounts, reason) => {
    groups.push({ kind: "failed", accounts: failedAccounts, reason });
  });

  const recoveredAccounts = accounts
    .filter((account) => account.status === "completed" && account.retried)
    .map((account) => account.name);
  if (recoveredAccounts.length) {
    groups.push({
      kind: "recovered",
      accounts: recoveredAccounts,
      reason: "批量抓取失败后，单账号重试成功"
    });
  }

  const unchangedAccounts = accounts
    .filter((account) => account.status === "unchanged")
    .map((account) => account.name);
  if (unchangedAccounts.length) groups.push({ kind: "unchanged", accounts: unchangedAccounts });

  return groups;
}

function compactRefreshError(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  const platform = /opencli bilibili|B站/i.test(normalized) ? "B站" : /opencli douyin|抖音/i.test(normalized) ? "抖音" : "平台";
  if (/Unexpected token.*<|<!DOCTYPE|not valid JSON/i.test(normalized)) {
    return `${platform}返回异常页面，数据解析失败`;
  }
  if (/timed?\s*out|timeout|超时/i.test(normalized)) return "抓取超时";
  if (/热榜关注列表里的账号已经不存在/.test(normalized)) return "账号已不在热榜关注列表中";
  if (/没有返回这个账号的结果/.test(normalized)) return "抓取未返回该账号结果";
  if (/Command failed: opencli bilibili/i.test(normalized)) return "B站数据抓取失败";
  if (/Command failed: opencli douyin/i.test(normalized)) return "抖音数据抓取失败";
  return normalized.slice(0, 80);
}

export function isRefreshBusyMessage(message: string) {
  return /热榜正在刷新中|正在刷新中|已有.*刷新/i.test(message);
}

function buildRefreshLogText(refresh: DouyinHotlistRefreshJobResult["refresh"], windowLabel: string) {
  const handledCount = refresh.completed + refresh.unchanged + refresh.failed;
  const changedVideoCount = refresh.accounts.reduce((sum, account) => sum + (account.changedCount || 0), 0);
  const parts = [handledCount === refresh.requested ? `${handledCount} 个账号` : `已处理 ${handledCount}/${refresh.requested}`];
  if (refresh.completed) parts.push(`更新 ${refresh.completed}${changedVideoCount ? `（${changedVideoCount} 条）` : ""}`);
  if (refresh.unchanged) parts.push(`无变化 ${refresh.unchanged}`);
  if (refresh.failed) parts.push(`失败 ${refresh.failed}`);
  parts.push(windowLabel);
  return parts.join(" · ");
}

export function getSelectedAccount(
  snapshot: DouyinHotlistResponse | null,
  selectedAccountId: AccountSelection,
  selectedPlatform: Platform | null
): DouyinHotlistAccount | null {
  if (!snapshot || selectedAccountId === "all" || selectedPlatform) return null;
  return snapshot.accounts.find((account) => account.id === selectedAccountId) || null;
}
