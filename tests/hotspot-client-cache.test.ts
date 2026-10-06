import assert from "node:assert/strict";
import test from "node:test";
import { getCachedHotspotRadar, getHotspotRadar, invalidateHotspotRadarCache, saveHotspotFeedback } from "../src/lib/client";

test("热点快照去重、复用与失效；旧请求不能恢复过期缓存", async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  let finishOld: ((response: Response) => void) | undefined;
  invalidateHotspotRadarCache();
  try {
    globalThis.fetch = async () => {
      requests += 1;
      if (requests === 1) return new Promise<Response>((resolve) => { finishOld = resolve; });
      return Response.json({ generatedAt: "new" });
    };
    const old = getHotspotRadar();
    assert.equal(getHotspotRadar(), old);
    invalidateHotspotRadarCache();
    const current = await getHotspotRadar();
    finishOld!(Response.json({ generatedAt: "old" }));
    await old;
    assert.equal(getCachedHotspotRadar(), current);
    assert.equal(await getHotspotRadar(), current);
    assert.equal(requests, 2, "切回页面无需再请求已有快照");
    invalidateHotspotRadarCache();
    await getHotspotRadar();
    assert.equal(requests, 3, "任务更新失效后重新读取");
  } finally {
    invalidateHotspotRadarCache();
    globalThis.fetch = previousFetch;
  }
});

test("热点评分返回的最新快照直接复用，读取失败仍可重试", async () => {
  const previousFetch = globalThis.fetch;
  invalidateHotspotRadarCache();
  let requests = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      requests += 1;
      assert.equal(options?.method, "POST");
      return Response.json({ generatedAt: "rated", hotspots: [] });
    };
    const updated = await saveHotspotFeedback("topic-1", "还行");
    assert.equal(getCachedHotspotRadar(), updated);
    assert.equal(await getHotspotRadar(), updated);
    assert.equal(requests, 1, "评分后不再重复请求已返回的数据");
    invalidateHotspotRadarCache();
    globalThis.fetch = async () => Response.json({ error: "热点快照读取失败" }, { status: 500 });
    await assert.rejects(getHotspotRadar(), /热点快照读取失败/);
    assert.equal(getCachedHotspotRadar(), null);
    globalThis.fetch = async () => Response.json({ hotspots: [] });
    assert.deepEqual((await getHotspotRadar()).hotspots, []);
  } finally {
    invalidateHotspotRadarCache();
    globalThis.fetch = previousFetch;
  }
});
