import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { cachedRadarRequest } from "../src/lib/hotspot-radar/request-cache";

test("来源请求复用、条件请求、失败冷却、旧缓存回退与损坏边界", async () => {
  const previous = process.env.STYLE_LIBRARY_DIR;
  const root = await mkdtemp(path.join(tmpdir(), "radar-http-cache-test-"));
  process.env.STYLE_LIBRARY_DIR = root;
  const start = Date.now();
  let requests = 0;
  const url = "https://example.com/feed";
  const fetcher = async () => { requests++; return { status: 200, body: "feed-v1", etag: '"v1"', lastModified: "Mon, 21 Sep 2026 00:00:00 GMT" }; };
  try {
    const initial = await Promise.all([cachedRadarRequest(url, fetcher, { now: start }), cachedRadarRequest(url, fetcher, { now: start })]);
    assert.equal(requests, 1, "并发请求不能重复联网");
    assert.equal(initial[1].cacheStatus, "fresh");
    const checked = await cachedRadarRequest(url, async headers => {
      requests++;
      assert.equal(headers["If-None-Match"], '"v1"');
      assert.ok(headers["If-Modified-Since"]);
      return { status: 304, body: "" };
    }, { now: start + 11 * 60000 });
    assert.equal(checked.body, "feed-v1");
    assert.equal(checked.cacheStatus, "validated");
    const failing = async () => { requests++; throw new Error("来源暂时不可用"); };
    const stale = await cachedRadarRequest(url, failing, { now: start + 22 * 60000 });
    assert.equal(stale.fallback, true);
    assert.match(stale.fallbackReason!, /上次成功缓存/);
    const count = requests;
    const cooling = await cachedRadarRequest(url, fetcher, { now: start + 23 * 60000 });
    assert.equal(requests, count);
    assert.match(cooling.fallbackReason!, /下次重试/);
    await cachedRadarRequest(url, fetcher, { now: start + 28 * 60000 });
    assert.equal(requests, count + 1, "冷却到期后应再次请求");
    await assert.rejects(cachedRadarRequest(url, failing, { now: start + 74 * 3600000 }), /来源暂时不可用/);
    const failedUrl = "https://example.com/failed";
    await assert.rejects(cachedRadarRequest(failedUrl, failing, { now: start }), /下次重试/);
    const beforeCooldown = requests;
    await assert.rejects(cachedRadarRequest(failedUrl, fetcher, { now: start + 1000 }), /暂缓请求/);
    assert.equal(requests, beforeCooldown);
    const beforeCancel = requests;
    await assert.rejects(cachedRadarRequest("https://example.com/cancel", fetcher, { signal: AbortSignal.abort(new Error("用户取消")) }), /用户取消/);
    assert.equal(requests, beforeCancel);
    await cachedRadarRequest("https://example.com/cancel", fetcher, { now: start });
    assert.equal(requests, beforeCancel + 1, "取消不应引入失败冷却");
    await assert.rejects(cachedRadarRequest("https://example.com/parse", fetcher, { now: start, validate: async () => { throw new Error("页面结构无法解析"); } }), /无法解析/);
    await assert.rejects(cachedRadarRequest("https://example.com/parse", fetcher, { now: start + 1000 }), /暂缓请求/);
    const directory = path.join(root, ".cache/hotspot-requests");
    const file = (await readdir(directory))[0];
    const recordPath = path.join(directory, file);
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    await writeFile(recordPath, JSON.stringify({ schemaVersion: 99 }));
    await assert.rejects(cachedRadarRequest(record.url, fetcher), /缓存损坏/);
    assert.equal(await readFile(recordPath, "utf8"), '{"schemaVersion":99}');
  } finally {
    if (previous === undefined) delete process.env.STYLE_LIBRARY_DIR; else process.env.STYLE_LIBRARY_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
