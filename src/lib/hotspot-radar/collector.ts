import { parseRadarFeed } from "./rss";
import type { HotspotEvent } from "../types";
import { execFile } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { mapWithConcurrency } from "../concurrency";
import * as rules from "./source-rules.mjs";
import type { RadarSignal, RadarSource } from "./source-rules.mjs";

export type RadarProgress = { completed: number; total: number; sourceName: string; failed: boolean; stage?: string; dataChanged?: boolean };
export type RadarRefreshOptions = { retryReport?: boolean; signal?: AbortSignal; onProgress?: (progress: RadarProgress) => void | Promise<void>; onPartial?: (items: HotspotEvent[], analyzed: number, total: number) => Promise<void> };
export type CollectedSource = { source: RadarSource; items: RadarSignal[]; error?: string; checkedAt: string };
const parsers: Record<string, typeof rules.parseRss> = {
  rss: rules.parseRss, mrs: rules.parseMrs, famitsu: rules.parseFamitsu,
  gamersky: rules.parseGamersky, "5eplay": rules.parse5EPlay, "17173": rules.parse17173,
  dianjinghu: rules.parseDianjinghu, "3dm": rules.parse3DM, "sina-esports": rules.parseSinaEsports,
  "dota2-cn": rules.parseDota2CN, "qq-news": rules.parseQQNews, "generic-news": rules.parseGenericNewsPage
};

export function safeSourceUrl(value: string) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("资讯链接必须是公开 HTTP(S) 地址");
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error("资讯链接不能指向本机或内网");
  return url.toString();
}

export async function fetchRadarText(url: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  // 系统 curl 同时支持 Mac、Linux、Windows，参数数组避免 shell 注入；可复用用户代理。
  const args = ["--fail", "--silent", "--show-error", "--location", "--max-redirs", "4", "--proto", "=http,https", "--proto-redir", "=http,https", "--connect-timeout", "8", "--max-time", "24", "--user-agent", "Mozilla/5.0", safeSourceUrl(url)];
  const proxy = process.env.HOTSPOT_RADAR_PROXY;
  if (proxy) args.unshift("--proxy", proxy);
  return new Promise((resolve, reject) => {
    execFile(process.platform === "win32" ? "curl.exe" : "curl", args, { signal, timeout: 26000, maxBuffer: 12 * 1024 * 1024, encoding: "utf8", windowsHide: true }, (error, stdout) => {
      if (error) return reject(new Error(signal?.aborted ? "热点采集已取消" : `资讯请求失败：${new URL(url).hostname}，请检查网络或 HOTSPOT_RADAR_PROXY`, { cause: error }));
      resolve(stdout);
    });
  });
}

const communitySchema = z.object({ items: z.array(z.object({ title: z.string(), url: z.string(), summary: z.string(), publishedAt: z.string() })) });
async function collectCommunity(source: RadarSource, signal?: AbortSignal) {
  const text = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, [path.join(process.cwd(), "scripts", "collect-xiaoheihe-hotspots.mjs")], { signal, timeout: 45000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`小黑盒采集失败：${stderr.trim().slice(0, 400) || "请检查已安装的 Chrome 或 CHROME_BIN 路径"}`, { cause: error }));
      resolve(stdout);
    });
  });
  return communitySchema.parse(JSON.parse(text)).items.map(item => rules.makeSignal(source, item.title, item.url, item.summary, item.publishedAt));
}

export async function collectRadarSources(options: RadarRefreshOptions, sources = rules.SOURCES): Promise<CollectedSource[]> {
  let completed = 0;
  return mapWithConcurrency(sources, 4, async source => {
    options.signal?.throwIfAborted();
    const checkedAt = new Date().toISOString();
    let result: CollectedSource;
    try {
      const parsed = source.type === "xiaoheihe" ? await collectCommunity(source, options.signal) : source.type === "rss" ? await parseRadarFeed(await fetchRadarText(source.url, options.signal), source) : parsers[source.type](await fetchRadarText(source.url, options.signal), source);
      const candidates = rules.filterSourceItems(parsed, source).slice(0, source.itemLimit || 30);
      if (!candidates.length) throw new Error("未解析到资讯，请检查来源页面是否改版或受限");
      const dateErrors: string[] = [];
      const dated = await mapWithConcurrency(candidates, 3, async item => {
        options.signal?.throwIfAborted();
        safeSourceUrl(item.url);
        if (Number.isFinite(Date.parse(item.publishedAt))) return item;
        try {
          return { ...item, publishedAt: rules.extractArticleDate(await fetchRadarText(item.url, options.signal), item.url) };
        } catch {
          options.signal?.throwIfAborted();
          // 单篇日期补查失败不阻塞整个源，但必须在来源诊断中可见。
          dateErrors.push(item.title);
          return item;
        }
      });
      result = { source, checkedAt, items: dated.filter(rules.isRecentVerifiedSignal), ...(dateErrors.length ? { error: `${dateErrors.length} 条资讯日期补查失败，已排除无日期条目` } : {}) };
    } catch (error) {
      options.signal?.throwIfAborted();
      result = { source, checkedAt, items: [], error: error instanceof Error ? error.message : "资讯采集失败" };
    }
    completed += 1;
    await options.onProgress?.({ completed, total: sources.length, sourceName: source.name, failed: Boolean(result.error), stage: "collect" });
    return result;
  });
}

export function mergeRadarSignals(items: RadarSignal[]) {
  const kept: RadarSignal[] = [];
  for (const item of items) {
    const duplicate = kept.find(existing => existing.url === item.url || rules.sameHotspotEvent(existing, item) || rules.sameEvent(existing.title, item.title, existing.publishedAt, item.publishedAt));
    if (duplicate) duplicate.related = [...(duplicate.related || []), item];
    else kept.push({ ...item, related: [] });
  }
  return kept;
}
