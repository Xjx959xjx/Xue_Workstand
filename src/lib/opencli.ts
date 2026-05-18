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
const DOUYIN_RELATED_COMMENT_VIDEO_LIMIT = 6;
const DOUYIN_RELATED_COMMENT_PER_VIDEO_LIMIT = 20;
const DOUYIN_POST_PAGE_SIZE = 20;

type RunOpenCliOptions = {
  timeout?: number;
};

type OpenCliBrowserWindowMode = "foreground" | "background";

export type BilibiliCommentSample = {
  rank: number;
  author: string;
  text: string;
  likes: number;
  replies: number;
  time: string;
};

export type BilibiliVideoReference = {
  bvid: string;
  aid?: string;
  cid?: string;
  thumbnail?: string;
  title?: string;
};

export type DouyinRelatedCommentVideo = {
  id: string;
  title: string;
  likes: number;
  url: string;
};

export type DouyinRelatedCommentResult = {
  query: string;
  videos: DouyinRelatedCommentVideo[];
  comments: string[];
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

export function buildOpenCliBrowserArgs(
  session: string,
  command: string,
  commandArgs: string[] = [],
  options: {
    tab?: string;
    window?: OpenCliBrowserWindowMode;
  } = {}
) {
  const args = ["browser", session];
  if (options.window) {
    args.push("--window", options.window);
  }
  args.push(command);
  if (options.tab) {
    args.push("--tab", options.tab);
  }
  args.push(...commandArgs);
  return args;
}

export function parseOpenCliJsonish(stdout: string): unknown {
  return parseJsonish(stdout);
}

export function openCliRows(raw: unknown): unknown[] {
  return asArray(raw);
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
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [searchUrl], { window: "background" }), {
        timeout: 30_000
      })
    );
    const tab = openResult && typeof openResult === "object" ? String((openResult as Record<string, unknown>).page || "") : "";
    const evalArgs = buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_SEARCH_EXTRACT_JS], tab ? { tab } : {});
    const rows = asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 20_000 })));
    return selectDouyinSecUidFromRows(rows, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `opencli browser 没有解析到抖音账号「${name}」：${message || "没有返回结果"}。请确认账号名能在抖音搜索到，或临时填写主页链接 / sec_uid。`
    );
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }
}

export async function getDouyinRelatedTopicComments(
  query: string,
  options: { videoLimit?: number; commentLimit?: number } = {}
): Promise<DouyinRelatedCommentResult> {
  const cleanQuery = query.replace(/\s+/g, " ").trim();
  if (!cleanQuery) {
    return { query: "", videos: [], comments: [] };
  }

  const workspace = `douyin-topic-comments-${process.pid}-${Date.now()}-${shortHash(cleanQuery)}`;
  const videoLimit = Math.max(1, Math.min(options.videoLimit || DOUYIN_RELATED_COMMENT_VIDEO_LIMIT, 8));
  const commentLimit = Math.max(1, Math.min(options.commentLimit || DOUYIN_RELATED_COMMENT_PER_VIDEO_LIMIT, 30));
  const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(cleanQuery)}?type=general`;

  try {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [searchUrl], { window: "background" }), {
      timeout: 30_000
    });
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "wait", ["time", "5"]), { timeout: 12_000 }).catch(() => undefined);

    const videos = asArray(parseJsonish(await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_RELATED_VIDEO_EXTRACT_JS]), { timeout: 20_000 })))
      .map(normalizeDouyinRelatedVideo)
      .filter((video): video is DouyinRelatedCommentVideo => Boolean(video?.id))
      .filter((video) => isDouyinRelatedVideoRelevant(video.title, cleanQuery))
      .sort((a, b) => b.likes - a.likes)
      .slice(0, videoLimit);

    const comments: string[] = [];
    for (const video of videos) {
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [video.url]), { timeout: 30_000 }).catch(() => undefined);
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "wait", ["time", "5"]), { timeout: 12_000 }).catch(() => undefined);
      const rows = asArray(parseJsonish(await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_VIDEO_COMMENT_EXTRACT_JS]), { timeout: 35_000 })));
      comments.push(...rows.map(normalizeCommentText).filter(Boolean).slice(0, commentLimit));
    }

    return {
      query: cleanQuery,
      videos,
      comments: uniqueStrings(comments)
    };
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }
}

function normalizeDouyinRelatedVideo(row: unknown): DouyinRelatedCommentVideo | null {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const id = String(object.id || object.aweme_id || extractDouyinAwemeId(String(object.url || ""))).trim();
  if (!id) return null;
  const title = String(object.title || "").replace(/\s+/g, " ").trim();
  return {
    id,
    title,
    likes: toNumber(object.likes),
    url: `https://www.douyin.com/video/${encodeURIComponent(id)}`
  };
}

function isDouyinRelatedVideoRelevant(title: string, query: string) {
  const normalizedTitle = normalizeSearchComparableText(title);
  if (!normalizedTitle) return false;
  const terms = extractRelatedSearchTerms(query);
  if (!terms.length) return true;

  const matched = terms.filter((term) => normalizedTitle.includes(normalizeSearchComparableText(term)));
  if (matched.length >= Math.min(2, terms.length)) return true;
  return matched.some((term) => Array.from(term).length >= 4);
}

function extractRelatedSearchTerms(query: string) {
  return uniqueStrings(
    query
      .split(/[\s，,。.!！?？；;：:、｜|/\\()[\]{}<>《》“”"‘’#]+/)
      .map((term) => term.trim())
      .filter((term) => Array.from(term).length >= 2)
      .filter((term) => !RELATED_SEARCH_TERM_STOP_WORDS.has(term.toLowerCase()))
  ).slice(0, 8);
}

function normalizeSearchComparableText(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9._-]+/g, "")
    .toLowerCase();
}

const RELATED_SEARCH_TERM_STOP_WORDS = new Set([
  "视频",
  "评论",
  "弹幕",
  "文案",
  "素材",
  "热点",
  "话题",
  "生成",
  "douyin",
  "抖音"
]);

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

const DOUYIN_RELATED_VIDEO_EXTRACT_JS = `
(() => {
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const isTitleLike = (line) => {
    const text = clean(line);
    if (!text || text === "相关搜索") return false;
    if (/^@/.test(text)) return false;
    if (/^(关注|粉丝|合集|直播中|广告|查看更多|搜索|大家都在搜|用户|音乐)$/.test(text)) return false;
    if (/^\\d{1,2}:\\d{2}$/.test(text)) return false;
    if (/^\\d+(\\.\\d+)?\\s*[万億亿kKmM]?$/.test(text)) return false;
    if (/^(点赞|评论|分享|收藏|转发)\\s*\\d*/.test(text)) return false;
    if (/^(\\d+\\s*)?(分钟前|小时前|天前|周前|月前|年前)$/.test(text)) return false;
    return /[\\u4e00-\\u9fa5A-Za-z]/.test(text) && text.length >= 2;
  };
  const pickTitle = (lines, fallback = "") => {
    const values = lines.map(clean).filter(Boolean);
    return values.find((line) => isTitleLike(line) && !/^#/.test(line)) ||
      values.find(isTitleLike) ||
      clean(fallback);
  };
  const numberValue = (text) => {
    const match = clean(text).match(/([0-9.]+)\\s*([万億亿kKmM]?)/);
    if (!match) return 0;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return 0;
    const unit = String(match[2] || "").toLowerCase();
    if (unit === "万") return Math.round(base * 10000);
    if (unit === "亿" || unit === "億") return Math.round(base * 100000000);
    if (unit === "k") return Math.round(base * 1000);
    if (unit === "m") return Math.round(base * 1000000);
    return Math.round(base);
  };
  const seen = new Set();
  const byWaterfall = Array.from(document.querySelectorAll('[id^="waterfall_item_"]'))
    .map((element) => {
      const id = String(element.id || "").replace(/^waterfall_item_/, "");
      const lines = String(element.innerText || element.textContent || "")
        .split(/\\n+/)
        .map(clean)
        .filter(Boolean);
      const title = pickTitle(lines);
      const likes = numberValue(lines.find((line) => /^\\d/.test(line) && !/^\\d{1,2}:\\d{2}/.test(line)) || "");
      if (!id || seen.has(id) || !title || title === "相关搜索") return null;
      seen.add(id);
      return { id, aweme_id: id, title, likes, url: location.origin + "/video/" + id };
    })
    .filter(Boolean);

  const byLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
    .map((anchor) => {
      const href = anchor.getAttribute("href") || anchor.href || "";
      const match = href.match(/\\/video\\/(\\d+)/);
      const id = match ? match[1] : "";
      if (!id || seen.has(id)) return null;
      seen.add(id);
      const container = anchor.closest("li") || anchor.closest("div");
      const lines = String(container?.innerText || anchor.innerText || anchor.textContent || "")
        .split(/\\n+/)
        .map(clean)
        .filter(Boolean);
      const title = pickTitle(lines, anchor.innerText || anchor.textContent || "");
      const likes = numberValue(lines.find((line) => /^\\d/.test(line) && !/^\\d{1,2}:\\d{2}/.test(line)) || "");
      return title ? { id, aweme_id: id, title, likes, url: location.origin + "/video/" + id } : null;
    })
    .filter(Boolean);

  return [...byWaterfall, ...byLinks].slice(0, 30);
})()
`;

const DOUYIN_VIDEO_COMMENT_EXTRACT_JS = `
async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const collect = () => {
    const text = String(document.body?.innerText || "");
    const marker = text.indexOf("全部评论");
    const source = marker >= 0 ? text.slice(marker) : text;
    const stopWords = [
      "推荐视频",
      "广告投放",
      "用户服务协议",
      "隐私政策",
      "2026 © 抖音",
      "热门：",
      "加载中"
    ];
    let section = source;
    for (const word of stopWords) {
      const index = section.indexOf(word);
      if (index > 0) section = section.slice(0, index);
    }
    const noise = /^(全部评论|留下你的精彩评论吧|分享|回复|举报|发布时间：|展开\\d+条回复|\\d+(\\.\\d+)?万?|\\d+小时前.*|\\d+分钟前.*|\\d+天前.*|IP属地.*|\\.\\.\\.)$/;
    const lines = section
      .split(/\\n+/)
      .map(clean)
      .filter(Boolean)
      .filter((line) => !noise.test(line));
    const seen = new Set();
    const comments = [];
    let skipSearchHints = false;
    for (const line of lines) {
      if (line === "大家都在搜：") {
        skipSearchHints = true;
        continue;
      }
      if (line === "...") {
        skipSearchHints = false;
        continue;
      }
      if (skipSearchHints) continue;
      if (line.length < 1 || line.length > 240) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      comments.push(line);
    }
    return comments;
  };

  const scrollTargets = Array.from(document.querySelectorAll('[class*="comment"], [id*="comment"], div'))
    .filter((element) => {
      const text = clean(element.innerText || element.textContent || "");
      return text.includes("全部评论") && text.length > 100;
    })
    .sort((a, b) => (a.scrollHeight - a.clientHeight) - (b.scrollHeight - b.clientHeight));
  const target = scrollTargets.find((element) => element.scrollHeight > element.clientHeight + 80) || document.scrollingElement || document.documentElement;
  for (let i = 0; i < 3; i += 1) {
    target.scrollTop += Math.max(500, target.clientHeight || 700);
    target.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(900);
  }
  return collect().slice(0, 80);
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
    let rows: unknown[];
    try {
      rows = await scanDouyinPostVideoRows(input.account, {
        limit: input.limit,
        fromDate: input.fromDate,
        toDate: input.toDate
      });
    } catch {
      rows = await getDouyinVideoRows(input.account, { limit: input.limit });
    }
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
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [profileUrl], { window: "background" }), {
      timeout: 30_000
    });
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "wait", ["time", "2"]), { timeout: 10_000 }).catch(() => undefined);
    const evalArgs = buildOpenCliBrowserArgs(workspace, "eval", [
      buildDouyinPostExtractJs({
        secUid: account.uid,
        limit: scanLimit,
        fromDate: options.fromDate,
        toDate: options.toDate
      })
    ]);
    return asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 90_000 })));
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
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

export async function getBilibiliComments(video: Pick<Video, "id" | "url" | "raw">, limit = 50) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return [];

  const stdout = await runOpenCli([
    "bilibili",
    "comments",
    bvid,
    "--limit",
    String(Math.max(1, Math.min(limit, 50))),
    "-f",
    "json"
  ]);
  return asArray(parseJsonish(stdout))
    .map((row, index) => normalizeBilibiliComment(row, index))
    .filter((comment) => comment.text) as BilibiliCommentSample[];
}

export async function getBilibiliVideoReference(video: Pick<Video, "id" | "url" | "raw" | "title" | "coverUrl">) {
  const bvid = extractBvid(video.url || video.id || String(video.raw ?? ""));
  if (!bvid) return null;

  const opencliFields: Record<string, unknown> = await getBilibiliVideoFields(bvid).catch(() => ({}));
  const publicFields =
    extractBilibiliCid(opencliFields) && (stringField(opencliFields.thumbnail) || stringField(opencliFields.pic))
      ? {}
      : await getBilibiliPublicVideoFields(bvid).catch(() => ({}));
  const fields: Record<string, unknown> = {
    ...publicFields,
    ...opencliFields
  };
  const reference: BilibiliVideoReference = {
    bvid,
    aid: stringField(fields.aid),
    cid: extractBilibiliCid(fields),
    thumbnail: stringField(fields.thumbnail) || stringField(fields.pic) || video.coverUrl || findCoverUrlInRaw(video.raw),
    title: stringField(fields.title) || video.title
  };
  return reference;
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

export async function getDouyinVideoDetailMap(
  account: Account,
  videos: Array<Pick<Video, "id" | "url" | "raw">>,
  options: { commentLimit?: number } = {}
) {
  const awemeIds = [...new Set(videos.map((video) => getDouyinAwemeId(video)).filter(Boolean))];
  const details = new Map<string, { commentCount?: number; topComments: string[] }>();
  if (!awemeIds.length) return details;

  const workspace = `douyin-detail-${process.pid}-${Date.now()}-${shortHash(account.uid)}`;
  const profileUrl = `https://www.douyin.com/user/${encodeURIComponent(account.uid)}`;

  try {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [profileUrl], { window: "background" }), {
      timeout: 30_000
    });
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "wait", ["time", "2"]), { timeout: 10_000 }).catch(() => undefined);

    for (const awemeId of awemeIds) {
      const detail = await getDouyinVideoDetailWithBrowser(workspace, awemeId, options).catch(() => null);
      if (!detail) continue;
      details.set(awemeId, detail);
    }
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
  }

  return details;
}

async function getDouyinVideoDetailWithBrowser(
  workspace: string,
  awemeId: string,
  options: { commentLimit?: number } = {}
) {
  const commentLimit = Math.max(1, Math.min(options.commentLimit || 10, 20));
  const result = parseJsonish(
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "eval", [
      buildDouyinDetailExtractJs({
        awemeId,
        commentLimit
      })
    ]), { timeout: 20_000 })
  );
  const object = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
  const topComments = Array.isArray(object.topComments)
    ? object.topComments.map((comment) => normalizeCommentText(comment)).filter(Boolean)
    : [];
  const commentCount = toNumber(object.commentCount);
  if (!topComments.length && commentCount <= 0) return null;
  return {
    commentCount: commentCount > 0 ? commentCount : undefined,
    topComments
  };
}

function buildDouyinDetailExtractJs(options: { awemeId: string; commentLimit: number }) {
  return `
(async () => {
  const awemeId = ${JSON.stringify(options.awemeId)};
  const commentLimit = ${options.commentLimit};
  const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const normalizeComment = (comment) => {
    if (!comment || typeof comment !== "object") return "";
    return normalizeText(
      comment.text ||
      comment.content ||
      comment.reply_comment?.text ||
      comment.reply_comment?.content ||
      ""
    );
  };
  const detailUrl = new URL("https://www.douyin.com/aweme/v1/web/aweme/detail/");
  detailUrl.searchParams.set("aweme_id", awemeId);
  detailUrl.searchParams.set("aid", "6383");
  const detailResponse = await fetch(detailUrl.toString(), {
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });
  const detailPayload = await detailResponse.json().catch(() => ({}));
  const awemeDetail = detailPayload && typeof detailPayload === "object" ? detailPayload.aweme_detail || {} : {};
  const statistics = awemeDetail && typeof awemeDetail === "object" ? awemeDetail.statistics || {} : {};
  let topComments = [];
  try {
    const commentUrl = new URL("https://www.douyin.com/aweme/v1/web/comment/list/");
    commentUrl.searchParams.set("aweme_id", awemeId);
    commentUrl.searchParams.set("cursor", "0");
    commentUrl.searchParams.set("count", String(commentLimit));
    commentUrl.searchParams.set("item_type", "0");
    commentUrl.searchParams.set("insert_ids", "");
    commentUrl.searchParams.set("whale_cut_token", "");
    commentUrl.searchParams.set("cut_version", "1");
    commentUrl.searchParams.set("rcFT", "");
    commentUrl.searchParams.set("device_platform", "webapp");
    commentUrl.searchParams.set("aid", "6383");
    const commentResponse = await fetch(commentUrl.toString(), {
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*"
      }
    });
    const commentPayload = await commentResponse.json().catch(() => ({}));
    const comments = Array.isArray(commentPayload.comments) ? commentPayload.comments : [];
    topComments = comments.map(normalizeComment).filter(Boolean);
  } catch {}
  return {
    commentCount: Number(statistics.comment_count || 0),
    topComments
  };
})()
`;
}

export async function getDouyinTopComments(account: Account, options: { limit?: number; commentLimit?: number } = {}) {
  const stdout = await runOpenCli([
    "douyin",
    "user-videos",
    account.uid,
    "--limit",
    String(Math.max(1, Math.min(options.limit || 20, 50))),
    "--with_comments",
    "true",
    "--comment_limit",
    String(Math.max(1, Math.min(options.commentLimit || 10, 30))),
    "-f",
    "json"
  ]);
  return asArray(parseJsonish(stdout))
    .flatMap((row) => {
      const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const topComments = Array.isArray(object.top_comments) ? object.top_comments : [];
      return topComments.map((comment) => normalizeCommentText(comment)).filter(Boolean);
    })
    .filter(Boolean);
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
      await runOpenCli(buildOpenCliBrowserArgs(workspace, "open", [videoUrl], { window: "background" }), {
        timeout: 30_000
      })
    );
    const tab = openResult && typeof openResult === "object" ? String((openResult as Record<string, unknown>).page || "") : "";
    const evalArgs = buildOpenCliBrowserArgs(workspace, "eval", [DOUYIN_MEDIA_EXTRACT_JS], tab ? { tab } : {});
    const candidates = asArray(parseJsonish(await runOpenCli(evalArgs, { timeout: 20_000 })))
      .map((value) => String(value || "").trim())
      .filter(isLikelyDirectMediaUrl);
    return selectBestDouyinMediaUrl(candidates);
  } finally {
    await runOpenCli(buildOpenCliBrowserArgs(workspace, "close"), { timeout: 5_000 }).catch(() => undefined);
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
    coverUrl: String(metadata.thumbnail || video.coverUrl || ""),
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
    coverUrl: stringField(metadata.thumbnail) || stringField(object.thumbnail) || stringField(object.pic),
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

async function getBilibiliPublicVideoFields(bvid: string) {
  const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 style-library",
      Referer: `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`
    }
  });
  if (!response.ok) return {};
  const payload = (await response.json()) as unknown;
  const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = object.data && typeof object.data === "object" ? (object.data as Record<string, unknown>) : {};
  return data;
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
    ? object.top_comments.map((comment) => normalizeCommentText(comment)).filter(Boolean)
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

function normalizeBilibiliComment(row: unknown, index: number): BilibiliCommentSample {
  const object = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  return {
    rank: toNumber(object.rank) || index + 1,
    author: String(object.author || object.uname || ""),
    text: normalizeCommentText(object.text || object.content || object.message),
    likes: toNumber(object.likes || object.like),
    replies: toNumber(object.replies || object.reply),
    time: String(object.time || object.ctime || "")
  };
}

function normalizeCommentText(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["text", "content", "message", "comment", "reply"]) {
      const text: string = normalizeCommentText(object[key]);
      if (text) return text;
    }
    return JSON.stringify(value);
  }
  return "";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function stringField(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function extractBilibiliCid(fields: Record<string, unknown>) {
  const direct = stringField(fields.cid);
  if (direct) return direct;

  const pages = fields.pages || fields.parts || fields.videos;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      if (!page || typeof page !== "object") continue;
      const cid = stringField((page as Record<string, unknown>).cid);
      if (cid) return cid;
    }
  }
  return "";
}

function findCoverUrlInRaw(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const object = raw as Record<string, unknown>;
  for (const key of ["thumbnail", "pic", "cover", "cover_url", "pic_url"]) {
    const value = stringField(object[key]);
    if (value) return value;
  }
  const metadata = object.metadata && typeof object.metadata === "object" ? (object.metadata as Record<string, unknown>) : {};
  for (const key of ["thumbnail", "pic", "cover"]) {
    const value = stringField(metadata[key]);
    if (value) return value;
  }
  return "";
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
