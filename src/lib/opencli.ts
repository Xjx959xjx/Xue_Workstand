import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { Account, CollectOrder, Platform, Video } from "./types";
import {
  buildDouyinVideoUrl,
  extractBilibiliUid,
  extractBvid,
  extractDouyinAwemeId,
  extractDouyinSecUid,
  isLikelyDirectMediaUrl,
  nowIso,
  safeSegment,
  shortHash,
  toNumber
} from "./utils";

const execFileAsync = promisify(execFile);
const DOUYIN_BROWSER_SEARCH_LIMIT = 12;
const DOUYIN_BROWSER_VIDEO_SCAN_LIMIT = 500;
const DOUYIN_POST_PAGE_SIZE = 20;

type RunOpenCliOptions = {
  timeout?: number;
};

function opencliBin() {
  return process.env.OPENCLI_BIN || "opencli";
}

async function runOpenCli(args: string[], options: RunOpenCliOptions = {}) {
  const { stdout, stderr } = await execFileAsync(opencliBin(), args, {
    maxBuffer: 1024 * 1024 * 20,
    timeout: options.timeout
  });

  if (stderr && stderr.toLowerCase().includes("error")) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
}

function parseJsonish(stdout: string): unknown {
  if (!stdout) return [];
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    for (const key of ["data", "items", "results", "videos", "list", "users", "user_list"]) {
      if (Array.isArray(object[key])) return object[key] as unknown[];
    }
  }
  return [];
}

export function normalizeAccountInput(platform: Platform, uidOrUrl: string) {
  return platform === "bilibili" ? extractBilibiliUid(uidOrUrl) : extractDouyinSecUid(uidOrUrl);
}

export async function resolveAccountUid(platform: Platform, name: string, uidOrUrl?: string) {
  const explicit = uidOrUrl?.trim();
  if (explicit) return normalizeAccountInput(platform, explicit);

  if (platform === "bilibili") {
    return searchBilibiliUserUid(name);
  }

  return searchDouyinUserSecUid(name);
}

async function searchBilibiliUserUid(name: string) {
  const stdout = await runOpenCli(["bilibili", "search", name, "--type", "user", "--limit", "8", "-f", "json"]);
  const rows = asArray(parseJsonish(stdout));
  const normalizedName = name.trim().toLowerCase();
  const candidates = rows
    .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : null))
    .filter(Boolean) as Array<Record<string, unknown>>;
  const matched = candidates.sort((a, b) => userSearchRank(b, normalizedName) - userSearchRank(a, normalizedName))[0];

  if (!matched || typeof matched !== "object") {
    throw new Error(`没有搜索到 B站账号：${name}`);
  }

  const object = matched as Record<string, unknown>;
  const uid = extractBilibiliUid(String(object.url || object.uid || object.mid || ""));
  if (!uid) {
    throw new Error(`没有从搜索结果里解析到 B站 UID：${name}`);
  }

  return uid;
}

function userSearchRank(row: Record<string, unknown>, normalizedName: string) {
  const hasAuthor = String(row.author || "").trim() ? 10_000 : 0;
  const title = String(row.title || "").trim().toLowerCase();
  const exactTitle = title === normalizedName ? 5_000 : 0;
  const containsTitle = title.includes(normalizedName) || normalizedName.includes(title) ? 2_000 : 0;
  return hasAuthor + exactTitle + containsTitle + toNumber(row.score);
}

async function searchDouyinUserSecUid(name: string) {
  return searchDouyinUserSecUidWithBrowser(name);
}

async function searchDouyinUserSecUidWithBrowser(name: string) {
  const workspace = `douyin-search-${process.pid}-${Date.now()}-${shortHash(name)}`;
  const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(name)}?type=user`;

  try {
    const openResult = parseJsonish(
      await runOpenCli(
        ["browser", "--workspace", workspace, "--window", "background", "--keep-tab", "true", "open", searchUrl],
        { timeout: 30_000 }
      )
    );
    const tab = openResult && typeof openResult === "object" ? String((openResult as Record<string, unknown>).page || "") : "";
    const evalArgs = ["browser", "--workspace", workspace, "eval", DOUYIN_SEARCH_EXTRACT_JS];
    if (tab) evalArgs.push("--tab", tab);
    const rows = asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 20_000 })));
    return selectDouyinSecUidFromRows(rows, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `opencli browser 没有解析到抖音账号「${name}」：${message || "没有返回结果"}。请确认账号名能在抖音搜索到，或临时填写主页链接 / sec_uid。`
    );
  } finally {
    await runOpenCli(["browser", "--workspace", workspace, "close"], { timeout: 5_000 }).catch(() => undefined);
  }
}

function selectDouyinSecUidFromRows(rows: unknown[], name: string) {
  const normalizedName = name.trim().toLowerCase();
  const candidates = rows
    .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : null))
    .filter(Boolean) as Array<Record<string, unknown>>;
  const matched = candidates.sort((a, b) => douyinUserSearchRank(b, normalizedName) - douyinUserSearchRank(a, normalizedName))[0];

  if (!matched) {
    throw new Error(`没有搜索到抖音账号：${name}`);
  }

  const secUid = extractSecUidFromSearchRow(matched);
  if (!secUid) {
    throw new Error(`没有从搜索结果里解析到抖音 sec_uid：${name}`);
  }

  return secUid;
}

function douyinUserSearchRank(row: Record<string, unknown>, normalizedName: string) {
  const userInfo = row.user_info && typeof row.user_info === "object" ? (row.user_info as Record<string, unknown>) : {};
  const nickname = String(row.nickname || row.name || row.title || userInfo.nickname || "").trim().toLowerCase();
  const exactName = nickname === normalizedName ? 10_000 : 0;
  const containsName = nickname && (nickname.includes(normalizedName) || normalizedName.includes(nickname)) ? 3_000 : 0;
  const rankPenalty = toNumber(row.rank) ? Math.max(0, 500 - toNumber(row.rank)) : 0;
  return exactName + containsName + rankPenalty + toNumber(row.follower_count ?? userInfo.follower_count ?? row.followers);
}

function extractSecUidFromSearchRow(row: Record<string, unknown>) {
  const userInfo = row.user_info && typeof row.user_info === "object" ? (row.user_info as Record<string, unknown>) : {};
  return String(row.sec_uid || row.sec_user_id || row.secUid || userInfo.sec_uid || userInfo.sec_user_id || extractDouyinSecUid(String(row.url || "")));
}

const DOUYIN_SEARCH_EXTRACT_JS = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const normalizeUrl = (href) => {
    if (!href) return "";
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("/")) return location.origin + href;
    return href;
  };
  const followerValue = (text) => {
    const match = clean(text).match(/([0-9.]+\\s*[万億亿kKmM]?)\\s*粉丝/);
    return match ? match[1] : "";
  };
  const extract = () => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href*="/user/"]'))
      .map((anchor, index) => {
        const href = normalizeUrl(anchor.getAttribute("href") || anchor.href || "");
        const match = href.match(/\\/user\\/([^/?#]+)/);
        const secUid = match ? decodeURIComponent(match[1]) : "";
        if (!secUid || secUid === "self" || seen.has(secUid)) return null;
        seen.add(secUid);
        const lines = String(anchor.innerText || anchor.textContent || "")
          .split(/\\n+/)
          .map(clean)
          .filter(Boolean);
        const nickname = lines.find((line) => line !== "关注" && !/^抖音号[:：]/.test(line)) || "";
        const rawText = clean(lines.join(" "));
        return {
          rank: index + 1,
          nickname,
          name: nickname,
          title: nickname,
          sec_uid: secUid,
          sec_user_id: secUid,
          follower_count: followerValue(rawText),
          url: href,
          raw_text: rawText
        };
      })
      .filter(Boolean);
  };

  for (let i = 0; i < 8; i += 1) {
    const rows = extract();
    if (rows.length) return rows.slice(0, ${DOUYIN_BROWSER_SEARCH_LIMIT});
    await sleep(1000);
  }
  return extract().slice(0, ${DOUYIN_BROWSER_SEARCH_LIMIT});
})()
`;

export async function collectVideos(input: {
  platform: Platform;
  account: Account;
  limit: number;
  order?: CollectOrder;
  page?: number;
  hydrateDetails?: boolean;
  fromDate?: string;
  toDate?: string;
}) {
  const args =
    input.platform === "bilibili"
      ? [
          "bilibili",
          "user-videos",
          input.account.uid,
          "--limit",
          String(input.limit),
          "--order",
          getBilibiliOpenCliOrder(input.order),
          "--page",
          String(input.page || 1),
          "-f",
          "json"
        ]
      : [
          "browser",
          "aweme-post",
          `https://www.douyin.com/user/${input.account.uid}`,
          "--limit",
          String(input.limit),
          ...(input.fromDate ? ["--from", input.fromDate] : []),
          ...(input.toDate ? ["--to", input.toDate] : [])
        ];

  if (input.platform === "douyin") {
    const rows = await scanDouyinPostVideoRows(input.account, {
      limit: input.limit,
      fromDate: input.fromDate,
      toDate: input.toDate
    });
    return {
      command: `${opencliBin()} ${args.join(" ")}`,
      rawCount: rows.length,
      raw: rows,
      videos: rows.map((row) => normalizeDouyinVideo(row, input.account))
    };
  }

  const stdout = await runOpenCli(args);
  const raw = parseJsonish(stdout);
  const rows = asArray(raw);
  const videos = await Promise.all(
    rows.map((row) =>
      normalizeBilibiliVideo(row, input.account, {
        hydrateDetails: input.hydrateDetails ?? true
      })
    )
  );

  return {
    command: `${opencliBin()} ${args.join(" ")}`,
    rawCount: rows.length,
    raw,
    videos
  };
}

async function scanDouyinPostVideoRows(
  account: Account,
  options: {
    limit: number;
    fromDate?: string;
    toDate?: string;
  }
) {
  const workspace = `douyin-post-${process.pid}-${Date.now()}-${shortHash(account.uid)}`;
  const profileUrl = `https://www.douyin.com/user/${encodeURIComponent(account.uid)}`;
  const scanLimit = Math.min(Math.max(options.limit, 1), DOUYIN_BROWSER_VIDEO_SCAN_LIMIT);

  try {
    await runOpenCli(
      ["browser", "--workspace", workspace, "--window", "background", "--keep-tab", "true", "open", profileUrl],
      { timeout: 30_000 }
    );
    await runOpenCli(["browser", "--workspace", workspace, "wait", "time", "2"], { timeout: 10_000 }).catch(() => undefined);
    const evalArgs = [
      "browser",
      "--workspace",
      workspace,
      "eval",
      buildDouyinPostExtractJs({
        secUid: account.uid,
        limit: scanLimit,
        fromDate: options.fromDate,
        toDate: options.toDate
      })
    ];
    return asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 90_000 })));
  } finally {
    await runOpenCli(["browser", "--workspace", workspace, "close"], { timeout: 5_000 }).catch(() => undefined);
  }
}

function buildDouyinPostExtractJs(options: {
  secUid: string;
  limit: number;
  fromDate?: string;
  toDate?: string;
}) {
  const fromEpoch = boundaryDateToEpochSeconds(options.fromDate, "start");
  const toEpoch = boundaryDateToEpochSeconds(options.toDate, "end");
  return `
(async () => {
  const secUid = ${JSON.stringify(options.secUid)};
  const limit = ${options.limit};
  const fromEpoch = ${fromEpoch ?? "null"};
  const toEpoch = ${toEpoch ?? "null"};
  const pageSize = ${DOUYIN_POST_PAGE_SIZE};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const toNumber = (value) => {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  };
  const normalizeUrl = (url) => {
    if (!url) return "";
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return location.origin + url;
    return url;
  };
  const firstUrl = (value) => {
    if (!value) return "";
    if (typeof value === "string") return normalizeUrl(value);
    if (Array.isArray(value)) return normalizeUrl(String(value[0] || ""));
    if (Array.isArray(value.url_list)) return normalizeUrl(String(value.url_list[0] || ""));
    return "";
  };
  const normalizeItem = (item, index) => {
    const awemeId = String(item.aweme_id || item.awemeId || item.id || "");
    const stats = item.statistics || {};
    const author = item.author || {};
    return {
      index,
      aweme_id: awemeId,
      id: awemeId,
      title: String(item.desc || item.caption || item.title || "未命名视频"),
      desc: String(item.desc || item.caption || item.title || "未命名视频"),
      duration: toNumber(item.duration) ? Math.round(toNumber(item.duration) / 1000) : "",
      create_time: toNumber(item.create_time || item.createTime),
      digg_count: toNumber(stats.digg_count ?? item.digg_count),
      comment_count: toNumber(stats.comment_count ?? item.comment_count),
      share_count: toNumber(stats.share_count ?? item.share_count),
      collect_count: toNumber(stats.collect_count ?? item.collect_count),
      play_count: toNumber(stats.play_count ?? item.play_count),
      share_url: item.share_url || (awemeId ? "https://www.douyin.com/video/" + awemeId : ""),
      web_url: awemeId ? "https://www.douyin.com/video/" + awemeId : "",
      url: awemeId ? "https://www.douyin.com/video/" + awemeId : "",
      author_uid: String(author.uid || ""),
      sec_uid: String(author.sec_uid || secUid),
      video_url: firstUrl(item.video && (item.video.play_addr || item.video.download_addr)),
      raw_statistics: stats,
      source: "douyin_aweme_post_api"
    };
  };

  const rows = [];
  const seen = new Set();
  let cursor = 0;
  let hasMore = true;
  let page = 0;
  let reachedBeforeFrom = false;

  const fetchPage = async (targetUrl) => {
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(targetUrl, {
        credentials: "include",
        headers: {
          accept: "application/json, text/plain, */*"
        }
      });
      const text = await response.text();
      if (!response.ok) throw new Error("aweme/post " + response.status + (text ? ": " + text.slice(0, 120) : ""));
      if (text.trim()) {
        try {
          return JSON.parse(text);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      } else {
        lastError = "empty response";
      }
      await sleep(800 * (attempt + 1));
    }
    throw new Error("aweme/post JSON parse failed: " + lastError);
  };

  while (hasMore && !reachedBeforeFrom && rows.length < limit && page < 80) {
    const url = new URL("https://www.douyin.com/aweme/v1/web/aweme/post/");
    url.searchParams.set("sec_user_id", secUid);
    url.searchParams.set("max_cursor", String(cursor));
    url.searchParams.set("count", String(pageSize));
    url.searchParams.set("aid", "6383");
    const data = await fetchPage(url.toString());
    const list = Array.isArray(data.aweme_list) ? data.aweme_list : [];
    if (!list.length) break;

    for (const item of list) {
      const createTime = toNumber(item.create_time || item.createTime);
      if (fromEpoch && createTime && createTime < fromEpoch) {
        reachedBeforeFrom = true;
        continue;
      }
      if (toEpoch && createTime && createTime > toEpoch) continue;
      const row = normalizeItem(item, rows.length + 1);
      if (!row.aweme_id || seen.has(row.aweme_id)) continue;
      seen.add(row.aweme_id);
      rows.push(row);
      if (rows.length >= limit) break;
    }

    cursor = data.max_cursor || data.maxCursor || 0;
    hasMore = !reachedBeforeFrom && Boolean(data.has_more || data.hasMore) && Boolean(cursor);
    page += 1;
    if (hasMore && rows.length < limit) await sleep(250);
  }

  return rows;
})()
`;
}

function boundaryDateToEpochSeconds(value: string | undefined, boundary: "start" | "end") {
  if (!value) return null;
  const date = new Date(`${value}T${boundary === "start" ? "00:00:00" : "23:59:59"}+08:00`);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

function getBilibiliOpenCliOrder(order: CollectOrder | undefined) {
  if (order === "pubdate") return "pubdate";
  if (order === "favorites") return "stow";
  return "click";
}

export async function getBilibiliSubtitle(video: Video) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return "";

  const stdout = await runOpenCli(["bilibili", "subtitle", bvid, "-f", "json"]);
  const raw = parseJsonish(stdout);
  return extractSubtitleText(raw);
}

export async function downloadBilibiliVideo(video: Video) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) {
    throw new Error("无法解析 B站视频 BV 号，不能下载音视频文件");
  }

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "style-library-bilibili-"));
  const stdout = await runOpenCli(["bilibili", "download", bvid, "--output", outputDir, "-f", "json"]);
  const raw = parseJsonish(stdout);
  const rows = asArray(raw);
  const failed = rows.find((row) => {
    if (!row || typeof row !== "object") return false;
    return String((row as Record<string, unknown>).status || "").toLowerCase() === "failed";
  }) as Record<string, unknown> | undefined;

  if (failed) {
    const detail = String(failed.size || failed.message || failed.error || "下载失败");
    throw new Error(`B站视频下载失败：${detail}`);
  }

  const files = await collectMediaFiles(outputDir);
  if (!files.length) {
    throw new Error("B站视频下载后没有找到可转写的本地媒体文件");
  }

  return files[0];
}

export async function refreshDouyinVideoDownloadUrl(
  account: Account,
  video: Pick<Video, "id" | "url" | "raw">,
  options: { preferBrowser?: boolean; excludeUrls?: string[] } = {}
) {
  const awemeId = resolveDouyinAwemeId(video);
  if (!awemeId) return "";
  const excludedUrls = new Set(options.excludeUrls || []);
  if (options.preferBrowser) {
    const browserUrl = await getDouyinVideoDownloadUrlWithBrowser(awemeId);
    if (browserUrl && !excludedUrls.has(browserUrl)) return browserUrl;
  }

  const limit = resolveDouyinVideoLookupLimit(video);
  const urls = await getDouyinVideoDownloadUrlsWithUserVideos(account, { limit });
  const opencliUrl = urls.get(awemeId);
  if (opencliUrl && !excludedUrls.has(opencliUrl)) return opencliUrl;
  const browserUrl = await getDouyinVideoDownloadUrlWithBrowser(awemeId);
  return browserUrl && !excludedUrls.has(browserUrl) ? browserUrl : "";
}

export async function getDouyinVideoDownloadUrls(account: Account, options: { limit?: number } = {}) {
  return getDouyinVideoDownloadUrlsWithUserVideos(account, options);
}

export function getDouyinVideoDownloadLookupLimit(videos: Array<Pick<Video, "id" | "url" | "raw">>) {
  return videos.reduce((limit, video) => Math.max(limit, resolveDouyinVideoLookupLimit(video)), 20);
}

async function getDouyinVideoDownloadUrlsWithUserVideos(account: Account, options: { limit?: number } = {}) {
  const urls = new Map<string, string>();

  try {
    const rows = await getDouyinVideoRows(account, options);
    for (const row of rows) {
      const awemeId = getDouyinRowAwemeId(row);
      if (!awemeId) continue;
      const mediaUrl = findDouyinMediaUrl(row);
      if (mediaUrl) urls.set(awemeId, mediaUrl);
    }
    return urls;
  } catch (error) {
    const message = error instanceof Error ? error.message : "opencli 未返回结果";
    throw new Error(`刷新抖音媒体地址失败：${message}`);
  }
}

async function getDouyinVideoRows(account: Account, options: { limit?: number } = {}) {
  const stdout = await runOpenCli([
    "douyin",
    "user-videos",
    account.uid,
    "--limit",
    String(Math.max(1, Math.min(options.limit || 20, 50))),
    "--with_comments",
    "false",
    "-f",
    "json"
  ]);
  return asArray(parseJsonish(stdout))
    .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : null))
    .filter(Boolean) as Array<Record<string, unknown>>;
}

function resolveDouyinVideoLookupLimit(video: Pick<Video, "id" | "url" | "raw">) {
  const raw = video.raw && typeof video.raw === "object" ? (video.raw as Record<string, unknown>) : {};
  const index = toNumber(raw.index);
  return Math.min(Math.max(index || 20, 20), 50);
}

async function getDouyinVideoDownloadUrlWithBrowser(awemeId: string) {
  const workspace = `douyin-media-${process.pid}-${Date.now()}-${shortHash(awemeId)}`;
  const videoUrl = buildDouyinVideoUrl(awemeId);
  if (!videoUrl) return "";

  try {
    const openResult = parseJsonish(
      await runOpenCli(
        ["browser", "--workspace", workspace, "--window", "background", "--keep-tab", "true", "open", videoUrl],
        { timeout: 30_000 }
      )
    );
    const tab = openResult && typeof openResult === "object" ? String((openResult as Record<string, unknown>).page || "") : "";
    const evalArgs = ["browser", "--workspace", workspace, "eval", DOUYIN_MEDIA_EXTRACT_JS];
    if (tab) evalArgs.push("--tab", tab);
    const candidates = asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 20_000 })))
      .map((value) => String(value || "").trim())
      .filter(isLikelyDirectMediaUrl);
    return selectBestDouyinMediaUrl(candidates);
  } finally {
    await runOpenCli(["browser", "--workspace", workspace, "close"], { timeout: 5_000 }).catch(() => undefined);
  }
}

const DOUYIN_MEDIA_EXTRACT_JS = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const collect = () => {
    const urls = [];
    for (const video of Array.from(document.querySelectorAll("video"))) {
      for (const value of [video.currentSrc, video.src]) {
        if (value) urls.push(value);
      }
      for (const source of Array.from(video.querySelectorAll("source"))) {
        const value = source.src || source.getAttribute("src") || "";
        if (value) urls.push(value);
      }
    }
    for (const entry of performance.getEntriesByType("resource")) {
      const name = entry.name || "";
      if (/douyinvod|mime_type=video|\\/aweme\\/v1\\/play\\//i.test(name)) urls.push(name);
    }
    return Array.from(new Set(urls)).filter((url) => /^https?:\\/\\//i.test(url));
  };

  for (let i = 0; i < 8; i += 1) {
    const urls = collect();
    if (urls.length) return urls;
    const video = document.querySelector("video");
    if (video) video.play().catch(() => undefined);
    await sleep(1000);
  }
  return collect();
})()
`;

export function getDouyinAwemeId(video: Pick<Video, "id" | "url" | "raw">) {
  return resolveDouyinAwemeId(video);
}

function resolveDouyinAwemeId(video: Pick<Video, "id" | "url" | "raw">) {
  const raw = video.raw && typeof video.raw === "object" ? (video.raw as Record<string, unknown>) : {};
  return (
    extractDouyinAwemeId(video.id) ||
    extractDouyinAwemeId(video.url) ||
    getDouyinRowAwemeId(raw)
  );
}

function getDouyinRowAwemeId(row: Record<string, unknown>) {
  const explicit = extractDouyinAwemeId(
    String(row.aweme_id || row.awemeId || row.awemeID || row.video_id || row.videoId || "")
  );
  if (explicit) return explicit;

  for (const key of ["share_url", "shareUrl", "web_url", "link", "page_url", "pageUrl", "uri"]) {
    const awemeId = extractDouyinAwemeId(String(row[key] || ""));
    if (awemeId) return awemeId;
  }

  return "";
}

function findDouyinMediaUrl(row: Record<string, unknown>) {
  const candidates = [
    row.play_url,
    row.download_url,
    row.video_url,
    row.media_url,
    row.video_play_url,
    row.url
  ]
    .map((value) => String(value || "").trim())
    .filter(isLikelyDirectMediaUrl);

  const video = row.video && typeof row.video === "object" ? (row.video as Record<string, unknown>) : {};
  const playAddr = video.play_addr && typeof video.play_addr === "object" ? (video.play_addr as Record<string, unknown>) : {};
  const downloadAddr =
    video.download_addr && typeof video.download_addr === "object" ? (video.download_addr as Record<string, unknown>) : {};

  for (const source of [playAddr, downloadAddr]) {
    const urlList = source.url_list;
    if (!Array.isArray(urlList)) continue;
    candidates.push(...urlList.map((value) => String(value || "").trim()).filter(isLikelyDirectMediaUrl));
  }

  return selectBestDouyinMediaUrl(candidates);
}

function selectBestDouyinMediaUrl(urls: string[]) {
  const unique = [...new Set(urls.filter(Boolean))];
  return unique.sort((a, b) => douyinMediaUrlScore(b) - douyinMediaUrlScore(a))[0] || "";
}

function douyinMediaUrlScore(url: string) {
  let score = 0;
  try {
    const parsed = new URL(url);
    const text = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    const mimeType = (parsed.searchParams.get("mime_type") || "").toLowerCase();

    if (mimeType.startsWith("audio_")) score += 1000;
    if (mimeType === "video_mp4") score -= 300;
    if (/\.(m4a|mp3|aac|wav|flac|ogg)(\?|$)/i.test(parsed.pathname)) score += 900;
    if (/playwm|play_addr|download_addr|music|audio/.test(text)) score += 120;
    if (/mime_type=video_mp4|\/video\/tos\//.test(text)) score -= 120;

    const bitrate = Number(parsed.searchParams.get("br") || parsed.searchParams.get("bt") || 0);
    if (Number.isFinite(bitrate)) score += Math.min(bitrate, 2000) / 100;
  } catch {
    if (/\.(m4a|mp3|aac|wav|flac|ogg)(\?|$)/i.test(url)) score += 900;
  }

  return score;
}

export async function hydrateBilibiliVideoStats(video: Video) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return video;

  const metadata = await getBilibiliVideoFields(bvid);
  return {
    ...video,
    duration: String(metadata.duration || video.duration || ""),
    stats: {
      views: toNumber(metadata.view ?? video.stats.views),
      likes: toNumber(metadata.like ?? video.stats.likes),
      comments: toNumber(metadata.reply ?? video.stats.comments),
      favorites: toNumber(metadata.favorite ?? video.stats.favorites),
      shares: toNumber(metadata.share ?? video.stats.shares)
    },
    raw: { ...(typeof video.raw === "object" && video.raw ? video.raw : {}), metadata },
    updatedAt: nowIso()
  };
}

async function normalizeBilibiliVideo(
  row: unknown,
  account: Account,
  options: { hydrateDetails?: boolean } = {}
): Promise<Video> {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const title = String(object.title || object.name || "未命名视频");
  const url = String(object.url || object.link || "");
  const bvid = extractBvid(url) || String(object.bvid || object.BVID || object.aid || "");
  const metadata: Record<string, unknown> =
    options.hydrateDetails !== false && bvid ? await getBilibiliVideoFields(bvid).catch(() => ({})) : {};
  const views = toNumber(object.plays ?? object.views ?? object.play ?? object.view ?? metadata.view);
  const likes = toNumber(object.likes ?? object.like ?? metadata.like);
  const comments = toNumber(object.comments ?? object.reply ?? object.replies ?? metadata.reply);
  const favorites = toNumber(object.favorites ?? object.stow ?? object.collect ?? metadata.favorite);

  return {
    id: safeSegment(bvid || shortHash(`${title}-${url}`)),
    platform: "bilibili",
    accountId: account.id,
    title,
    url,
    duration: String(metadata.duration || object.duration || ""),
    publishedAt: String(object.date || object.pubdate || object.created_at || metadata.publish_time || ""),
    stats: { views, likes, comments, favorites },
    hotScore: 0,
    relativeViewRate: 0,
    transcriptStatus: "not_started",
    raw: { ...(typeof row === "object" && row ? row : { value: row }), metadata },
    updatedAt: nowIso()
  };
}

async function getBilibiliVideoFields(bvid: string) {
  const stdout = await runOpenCli(["bilibili", "video", bvid, "-f", "json"]);
  const raw = parseJsonish(stdout);
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const object = item as Record<string, unknown>;
          return [String(object.field || ""), object.value] as const;
        })
        .filter((entry): entry is readonly [string, unknown] => Boolean(entry?.[0]))
    ) as Record<string, unknown>;
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function normalizeDouyinVideo(row: unknown, account: Account): Video {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const title = String(object.title || object.desc || object.caption || "未命名视频");
  const awemeId = getDouyinRowAwemeId(object);
  const sourceUrls = [
    object.play_url,
    object.download_url,
    object.video_url,
    object.share_url,
    object.shareUrl,
    object.web_url,
    object.link,
    object.url
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const downloadUrl = sourceUrls.find(isLikelyDirectMediaUrl) || "";
  const pageUrl =
    sourceUrls.find((url) => /^https?:\/\//i.test(url) && !isLikelyDirectMediaUrl(url)) ||
    buildDouyinVideoUrl(awemeId) ||
    downloadUrl;
  const rawStatistics =
    object.raw_statistics && typeof object.raw_statistics === "object" ? (object.raw_statistics as Record<string, unknown>) : {};
  const statistics =
    object.statistics && typeof object.statistics === "object" ? (object.statistics as Record<string, unknown>) : {};
  const nestedStats = object.stats && typeof object.stats === "object" ? (object.stats as Record<string, unknown>) : {};
  const topComments = Array.isArray(object.top_comments)
    ? object.top_comments.map((comment) => (typeof comment === "string" ? comment : JSON.stringify(comment)))
    : [];

  return {
    id: safeSegment(awemeId || shortHash(`${title}-${downloadUrl}`)),
    platform: "douyin",
    accountId: account.id,
    title,
    url: pageUrl,
    duration: String(object.duration || ""),
    publishedAt: normalizeTimestamp(object.date || object.create_time || object.created_at),
    stats: {
      views: firstNumber(
        object.play_count,
        object.view_count,
        object.video_play_count,
        object.total_play_count,
        object.play,
        object.views,
        object.view,
        rawStatistics.play_count,
        rawStatistics.view_count,
        rawStatistics.video_play_count,
        rawStatistics.total_play_count,
        statistics.play_count,
        statistics.view_count,
        statistics.video_play_count,
        statistics.total_play_count,
        nestedStats.play_count,
        nestedStats.view_count,
        nestedStats.video_play_count,
        nestedStats.total_play_count,
        nestedStats.views
      ),
      likes: firstNumber(object.digg_count, rawStatistics.digg_count, statistics.digg_count, nestedStats.digg_count, object.likes, object.like),
      comments: firstNumber(object.comment_count, rawStatistics.comment_count, statistics.comment_count, nestedStats.comment_count, object.comments),
      favorites: firstNumber(object.collect_count, rawStatistics.collect_count, statistics.collect_count, nestedStats.collect_count, object.favorites, object.collect),
      shares: firstNumber(object.share_count, rawStatistics.share_count, statistics.share_count, nestedStats.share_count, object.shares)
    },
    hotScore: 0,
    relativeViewRate: 0,
    transcriptStatus: "not_started",
    downloadUrl,
    topComments,
    raw: row,
    updatedAt: nowIso()
  };
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = toNumber(value);
    if (number > 0) return number;
  }
  return 0;
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return normalizeTimestamp(Number(trimmed));
    return trimmed;
  }

  return "";
}

function extractSubtitleText(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const object = item as Record<string, unknown>;
          return String(object.content || object.text || object.body || "").trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    for (const key of ["text", "subtitle", "content", "body"]) {
      if (typeof object[key] === "string") return object[key] as string;
    }
    for (const key of ["data", "items", "body", "subtitles"]) {
      const nested = extractSubtitleText(object[key]);
      if (nested) return nested;
    }
  }

  return "";
}

async function collectMediaFiles(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const mediaFiles: string[] = [];

  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      mediaFiles.push(...(await collectMediaFiles(target)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (/\.(mp4|m4a|mp3|wav|aac|flac|ogg|webm|mov|mkv)$/i.test(entry.name)) {
      mediaFiles.push(target);
    }
  }

  return mediaFiles;
}
