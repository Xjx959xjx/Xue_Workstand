import assert from "node:assert/strict";
import test from "node:test";
import { getCopySources, refreshCopySources } from "../src/lib/client";

test("素材请求合并后仍校验 revision，旧请求与共享调用都返回刷新后的列表", async () => {
  const previousFetch = globalThis.fetch;
  const pending: Array<(response: Response) => void> = [];
  try {
    globalThis.fetch = async () => new Promise<Response>(resolve => { pending.push(resolve); });
    const first = getCopySources();
    const merged = getCopySources();
    assert.equal(first, merged);
    const current = refreshCopySources();
    pending[0](Response.json({ sources: [{ id: "old" }] }));
    pending[1](Response.json({ sources: [{ id: "new" }] }));
    const results = await Promise.all([first, merged, current]);
    assert.ok(results.every(result => result.sources[0].id === "new"));
    assert.equal((await getCopySources()).sources[0].id, "new");
    assert.equal(pending.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("素材共享请求失败后清理请求，下一次读取可以重试", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => ++calls === 1
      ? Response.json({ error: "素材读取失败" }, { status: 500 })
      : Response.json({ sources: [{ id: "retry" }] });
    const failed = refreshCopySources();
    assert.equal(getCopySources(), failed);
    await assert.rejects(failed, /素材读取失败/);
    assert.equal((await getCopySources()).sources[0].id, "retry");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
