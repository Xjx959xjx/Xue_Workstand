import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { Account, Platform, Video } from "./types";
import {
  extractBilibiliUid,
  extractBvid,
  extractDouyinSecUid,
  nowIso,
  safeSegment,
  shortHash,
  toNumber
} from "./utils";

const execFileAsync = promisify(execFile);

function opencliBin() {
  return process.env.OPENCLI_BIN || "opencli";
}

async function runOpenCli(args: string[]) {
  const { stdout, stderr } = await execFileAsync(opencliBin(), args, {
    maxBuffer: 1024 * 1024 * 20
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
    for (const key of ["data", "items", "results", "videos", "list"]) {
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

  throw new Error("抖音账号名搜索暂未接入 opencli；当前只能继续采集已经保存过 sec_uid 的抖音账号。");
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

export async function collectVideos(input: {
  platform: Platform;
  account: Account;
  limit: number;
  order?: "pubdate" | "click" | "stow";
  page?: number;
  hydrateDetails?: boolean;
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
          input.order || "click",
          "--page",
          String(input.page || 1),
          "-f",
          "json"
        ]
      : [
          "douyin",
          "user-videos",
          input.account.uid,
          "--limit",
          String(input.limit),
          "--with_comments",
          "true",
          "--comment_limit",
          "10",
          "-f",
          "json"
        ];

  const stdout = await runOpenCli(args);
  const raw = parseJsonish(stdout);
  const rows = asArray(raw);
  const videos =
    input.platform === "bilibili"
      ? await Promise.all(
          rows.map((row) =>
            normalizeBilibiliVideo(row, input.account, {
              hydrateDetails: input.hydrateDetails ?? true
            })
          )
        )
      : rows.map((row) => normalizeDouyinVideo(row, input.account));

  return {
    command: `${opencliBin()} ${args.join(" ")}`,
    rawCount: rows.length,
    raw,
    videos
  };
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
  const awemeId = String(object.aweme_id || object.id || "");
  const downloadUrl = String(object.play_url || object.download_url || object.video_url || object.url || "");
  const topComments = Array.isArray(object.top_comments)
    ? object.top_comments.map((comment) => (typeof comment === "string" ? comment : JSON.stringify(comment)))
    : [];

  return {
    id: safeSegment(awemeId || shortHash(`${title}-${downloadUrl}`)),
    platform: "douyin",
    accountId: account.id,
    title,
    url: downloadUrl,
    duration: String(object.duration || ""),
    publishedAt: String(object.date || object.create_time || object.created_at || ""),
    stats: {
      views: toNumber(object.play_count ?? object.views ?? object.play),
      likes: toNumber(object.digg_count ?? object.likes ?? object.like),
      comments: toNumber(object.comment_count ?? object.comments),
      favorites: toNumber(object.collect_count ?? object.favorites ?? object.collect),
      shares: toNumber(object.share_count ?? object.shares)
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
