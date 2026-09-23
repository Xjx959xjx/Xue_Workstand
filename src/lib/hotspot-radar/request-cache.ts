import { createHash } from "node:crypto";
import path from "node:path";
import { libraryRoot } from "../storage/core";
import { readJsonFile, writeJsonFile } from "../storage/fs";
import { withMutationLock } from "../storage/mutation-lock";
import { hotspotRequestCacheSchema } from "../storage/schemas";

const locks = new Map<string, Promise<unknown>>();
const freshMs = 10 * 60000;
const staleMs = 72 * 3600000;
export type RadarHttpResponse = { status: number; body: string; etag?: string; lastModified?: string };
export type RadarCachedResponse = { body: string; cacheStatus: "fresh" | "validated" | "network" | "stale"; fallback: boolean; fallbackReason?: string };

// 复用存储层原子写与串行锁；同一 URL 的并发请求只产生一次网络读取。
export async function cachedRadarRequest(url: string, fetcher: (headers: Record<string, string>) => Promise<RadarHttpResponse>, options: { signal?: AbortSignal; now?: number; validate?: (body: string) => Promise<void> } = {}): Promise<RadarCachedResponse> {
  const key = createHash("sha256").update(url).digest("hex");
  const target = path.join(libraryRoot(), ".cache", "hotspot-requests", `${key}.json`);
  return withMutationLock(locks, target, async () => {
    options.signal?.throwIfAborted();
    const now = options.now ?? Date.now();
    const raw = await readJsonFile<unknown>(target);
    const parsed = raw === null ? null : hotspotRequestCacheSchema.safeParse(raw);
    if (parsed && (!parsed.success || parsed.data.url !== url)) throw new Error("热点来源请求缓存损坏，请检查 .cache/hotspot-requests；未覆盖文件");
    const saved = parsed?.success ? parsed.data : undefined;
    const canReuse = saved?.body !== undefined && now - saved.checkedAt < staleMs;
    function stale(reason: string): RadarCachedResponse {
      if (!canReuse) throw new Error(reason);
      return { body: saved!.body!, cacheStatus: "stale", fallback: true, fallbackReason: `${reason}；使用上次成功缓存（${new Date(saved!.checkedAt).toLocaleString("zh-CN")}）` };
    }
    if (saved && saved.nextRetryAt > now) return stale(`来源暂缓请求，下次重试 ${new Date(saved.nextRetryAt).toLocaleString("zh-CN")}。${saved.error || "上次请求失败"}`);
    if (canReuse && now - saved!.checkedAt < freshMs) return { body: saved!.body!, cacheStatus: "fresh", fallback: false };
    const headers: Record<string, string> = {};
    if (canReuse && saved?.etag) headers["If-None-Match"] = saved.etag;
    if (canReuse && saved?.lastModified) headers["If-Modified-Since"] = saved.lastModified;
    let response: RadarHttpResponse;
    try {
      response = await fetcher(headers);
      options.signal?.throwIfAborted();
      if (response.status === 304) {
        if (!canReuse) throw new Error("来源返回未修改，但本地无可用缓存，请重试");
      } else {
        if (response.status < 200 || response.status >= 300) throw new Error(`来源请求失败：HTTP ${response.status}`);
        await options.validate?.(response.body);
      }
    } catch (error) {
      // 用户取消不计入来源失败，不能污染重试状态。
      options.signal?.throwIfAborted();
      const failures = Math.min((saved?.failures || 0) + 1, 10);
      const nextRetryAt = now + Math.min(60, 5 * 2 ** (failures - 1)) * 60000;
      const reason = error instanceof Error ? error.message : "来源请求失败";
      await writeJsonFile(target, hotspotRequestCacheSchema.parse({ ...saved, schemaVersion: 1, url, checkedAt: saved?.checkedAt || 0, failures, nextRetryAt, error: reason }));
      return stale(`${reason}；下次重试 ${new Date(nextRetryAt).toLocaleString("zh-CN")}`);
    }
    const body = response.status === 304 ? saved!.body! : response.body;
    await writeJsonFile(target, hotspotRequestCacheSchema.parse({ schemaVersion: 1, url, body, checkedAt: now, failures: 0, nextRetryAt: 0, etag: response.etag || (response.status === 304 ? saved?.etag : undefined), lastModified: response.lastModified || (response.status === 304 ? saved?.lastModified : undefined) }));
    return { body, cacheStatus: response.status === 304 ? "validated" : "network", fallback: false };
  });
}
