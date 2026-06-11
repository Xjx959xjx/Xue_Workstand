const DOUYIN_BROWSER_SEARCH_LIMIT = 12;
const DOUYIN_POST_PAGE_SIZE = 20;

export const DOUYIN_SEARCH_EXTRACT_JS = `
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

export const DOUYIN_RELATED_VIDEO_EXTRACT_JS = `
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

export const DOUYIN_VIDEO_COMMENT_EXTRACT_JS = `
(async () => {
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

export type DouyinBatchPostExtractAccount = {
  id: string;
  name: string;
  uid: string;
};

export function buildDouyinPostExtractJs(options: {
  secUid: string;
  limit: number;
  fromDate?: string;
  toDate?: string;
}) {
  return buildDouyinPostExtractRuntimeJs({
    accounts: [{ id: "", name: "", uid: options.secUid }],
    concurrency: 1,
    fromDate: options.fromDate,
    limit: options.limit,
    returnRowsOnly: true,
    toDate: options.toDate
  });
}

export function buildDouyinBatchPostExtractJs(options: {
  accounts: DouyinBatchPostExtractAccount[];
  concurrency: number;
  limit: number;
  fromDate?: string;
  toDate?: string;
}) {
  return buildDouyinPostExtractRuntimeJs({
    accounts: options.accounts,
    concurrency: options.concurrency,
    fromDate: options.fromDate,
    limit: options.limit,
    returnRowsOnly: false,
    toDate: options.toDate
  });
}

function buildDouyinPostExtractRuntimeJs(options: {
  accounts: DouyinBatchPostExtractAccount[];
  concurrency: number;
  limit: number;
  fromDate?: string;
  returnRowsOnly: boolean;
  toDate?: string;
}) {
  const fromEpoch = boundaryDateToEpochSeconds(options.fromDate, "start");
  const toEpoch = boundaryDateToEpochSeconds(options.toDate, "end");
  const accounts = options.accounts.map((account) => ({
    id: String(account.id || ""),
    name: String(account.name || ""),
    uid: String(account.uid || "")
  }));
  const concurrency = clampPositiveInteger(options.concurrency, 1);
  const limit = clampPositiveInteger(options.limit, 1);
  const returnStatement = options.returnRowsOnly
    ? `
  const first = await fetchAccount(accounts[0]);
  if (first.status === "completed") return first.rows;
  throw new Error(first.error || "抖音账号抓取失败");`
    : `
  const results = new Array(accounts.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), accounts.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < accounts.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await fetchAccount(accounts[currentIndex]);
    }
  }));
  return results;`;

  return `
(async () => {
  const accounts = ${JSON.stringify(accounts)};
  const limit = ${limit};
  const concurrency = ${concurrency};
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
  const normalizeItem = (item, index, secUid) => {
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
      authorName: String(author.nickname || author.name || author.unique_id || ""),
      avatar_url: firstUrl(author.avatar_thumb || author.avatar_medium || author.avatar_larger),
      video_url: firstUrl(item.video && (item.video.play_addr || item.video.download_addr)),
      raw_statistics: stats,
      source: "douyin_aweme_post_api"
    };
  };

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

  const fetchAccount = async (account) => {
    const rows = [];
    const seen = new Set();
    let cursor = 0;
    let hasMore = true;
    let page = 0;
    let reachedBeforeFrom = false;

    try {
      while (hasMore && !reachedBeforeFrom && rows.length < limit && page < 80) {
        const url = new URL("https://www.douyin.com/aweme/v1/web/aweme/post/");
        url.searchParams.set("sec_user_id", account.uid);
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
          const row = normalizeItem(item, rows.length + 1, account.uid);
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

      return {
        accountId: account.id,
        name: account.name,
        uid: account.uid,
        status: "completed",
        rawCount: rows.length,
        rows
      };
    } catch (error) {
      return {
        accountId: account.id,
        name: account.name,
        uid: account.uid,
        status: "failed",
        rawCount: 0,
        rows: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  };

${returnStatement}
})()
`;
}

export function buildDouyinDetailExtractJs(options: { awemeId: string; commentLimit: number }) {
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

export function buildDouyinStatsExtractJs(awemeId: string) {
  return `
(async () => {
  const detailUrl = new URL("https://www.douyin.com/aweme/v1/web/aweme/detail/");
  detailUrl.searchParams.set("aweme_id", ${JSON.stringify(awemeId)});
  detailUrl.searchParams.set("aid", "6383");
  const response = await fetch(detailUrl.toString(), {
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*"
    }
  });
  const payload = await response.json().catch(() => ({}));
  const awemeDetail = payload && typeof payload === "object" ? payload.aweme_detail || {} : {};
  const statistics = awemeDetail && typeof awemeDetail === "object" ? awemeDetail.statistics || {} : {};
  const hasStats = Boolean(statistics && typeof statistics === "object" && Object.keys(statistics).length);
  return {
    hasStats,
    title: awemeDetail.desc || awemeDetail.title || "",
    likeCount: Number(statistics.digg_count || 0),
    commentCount: Number(statistics.comment_count || 0),
    favoriteCount: Number(statistics.collect_count || 0),
    shareCount: Number(statistics.share_count || 0),
    publishedAt: awemeDetail.create_time || awemeDetail.createTime || "",
    authorName: (awemeDetail.author && (awemeDetail.author.nickname || awemeDetail.author.name || awemeDetail.author.unique_id)) || "",
    authorSecUid: (awemeDetail.author && (awemeDetail.author.sec_uid || awemeDetail.author.secUid || awemeDetail.author.sec_user_id)) || ""
  };
})()
`;
}

export function buildDouyinBatchStatsExtractJs(awemeIds: string[]) {
  return `
(async () => {
  const awemeIds = ${JSON.stringify(awemeIds)};
  const fetchOne = async (awemeId) => {
    const detailUrl = new URL("https://www.douyin.com/aweme/v1/web/aweme/detail/");
    detailUrl.searchParams.set("aweme_id", awemeId);
    detailUrl.searchParams.set("aid", "6383");
    const response = await fetch(detailUrl.toString(), {
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*"
      }
    });
    const payload = await response.json().catch(() => ({}));
    const awemeDetail = payload && typeof payload === "object" ? payload.aweme_detail || {} : {};
    const statistics = awemeDetail && typeof awemeDetail === "object" ? awemeDetail.statistics || {} : {};
    const hasStats = Boolean(statistics && typeof statistics === "object" && Object.keys(statistics).length);
    return {
      awemeId,
      hasStats,
      title: awemeDetail.desc || awemeDetail.title || "",
      likeCount: Number(statistics.digg_count || 0),
      commentCount: Number(statistics.comment_count || 0),
      favoriteCount: Number(statistics.collect_count || 0),
      shareCount: Number(statistics.share_count || 0),
      publishedAt: awemeDetail.create_time || awemeDetail.createTime || "",
      authorName: (awemeDetail.author && (awemeDetail.author.nickname || awemeDetail.author.name || awemeDetail.author.unique_id)) || "",
      authorSecUid: (awemeDetail.author && (awemeDetail.author.sec_uid || awemeDetail.author.secUid || awemeDetail.author.sec_user_id)) || ""
    };
  };
  const results = [];
  const concurrency = 6;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, awemeIds.length) }, async () => {
    while (cursor < awemeIds.length) {
      const index = cursor++;
      try {
        results[index] = await fetchOne(awemeIds[index]);
      } catch {
        results[index] = { awemeId: awemeIds[index], hasStats: false };
      }
    }
  }));
  return results;
})()
`;
}

export const DOUYIN_AWEME_ID_EXTRACT_JS = `
(() => {
  const candidates = [location.href];
  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.href || anchor.getAttribute("href") || "";
    if (href) candidates.push(href);
  }
  for (const entry of performance.getEntriesByType("resource")) {
    if (entry.name) candidates.push(entry.name);
  }
  const html = document.documentElement?.innerHTML || "";
  const textMatches = html.match(/(?:\\/video\\/|aweme_id["'=:\\s]+)(\\d{10,})/g) || [];
  candidates.push(...textMatches);

  const extract = (value) => {
    const text = String(value || "");
    return (
      text.match(/\\/video\\/(\\d{10,})/)?.[1] ||
      text.match(/[?&]aweme_id=(\\d{10,})/)?.[1] ||
      text.match(/aweme_id["'=:\\s]+(\\d{10,})/)?.[1] ||
      text.match(/awemeId["'=:\\s]+(\\d{10,})/)?.[1] ||
      ""
    );
  };
  const awemeId = candidates.map(extract).find(Boolean) || "";
  return {
    awemeId,
    url: awemeId ? "https://www.douyin.com/video/" + awemeId : location.href
  };
})()
`;

export const DOUYIN_MEDIA_EXTRACT_JS = `
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

function boundaryDateToEpochSeconds(value: string | undefined, boundary: "start" | "end") {
  if (!value) return null;
  const date = new Date(`${value}T${boundary === "start" ? "00:00:00" : "23:59:59"}+08:00`);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

function clampPositiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}
