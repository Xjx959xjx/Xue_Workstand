import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildDouyinBatchPostExtractJs } from "../src/lib/opencli-douyin-scripts";

async function run(fetch: (url: string) => Promise<unknown>, count = 1) {
  return vm.runInNewContext(buildDouyinBatchPostExtractJs({
    accounts: Array.from({ length: count }, (_, i) => ({ id: String(i), uid: String(i), name: String(i) })),
    concurrency: 1, limit: 20, fromDate: "2026-09-06", toDate: "2026-09-08"
  }), { document: { cookie: "UIFID=test-token" }, URL, AbortSignal, fetch, setTimeout: (fn: () => void) => fn() });
}

test("共享批量接口保留真实时间和互动字段，旧置顶作品不阻断分页", async () => {
  let calls = 0;
  const created = Math.floor(Date.parse("2026-09-07T10:00:00Z") / 1000);
  const result = await run(async (url) => {
    assert.equal(new URL(url).searchParams.get("uifid"), "test-token");
    calls++;
    return { ok: true, text: async () => JSON.stringify({ status_code: 0, aweme_list: calls === 1
      ? [{ aweme_id: "old", create_time: 1, is_top: 1 }]
      : [{ aweme_id: "new", create_time: created, statistics: { comment_count: 12, collect_count: 8 } }],
    has_more: calls === 1, max_cursor: calls === 1 ? 123 : 0 }) };
  });
  assert.equal(calls, 2);
  assert.equal(result[0].rows[0].create_time, created);
  assert.equal(result[0].rows[0].comment_count, 12);
  assert.equal(result[0].rows[0].collect_count, 8);
});

test("接口缺字段不能伪装成空账号成功", async () => {
  const result = await run(async () => ({ ok: true, text: async () => "{}" }));
  assert.equal(result[0].status, "failed");
  assert.match(result[0].error, /缺少作品列表/);
});

test("日期筛选拒绝缺少真实时间的作品", async () => {
  const result = await run(async () => ({ ok: true, text: async () => JSON.stringify({ aweme_list: [{ aweme_id: "123" }] }) }));
  assert.equal(result[0].status, "failed");
  assert.match(result[0].error, /真实发布时间/);
});

test("访问受限后不再发送排队账号请求", async () => {
  for (const status of [401, 403, 444, 429]) {
    let calls = 0;
    const result = await run(async () => { calls++; return { ok: false, status, text: async () => "Access Denied" }; }, 3);
    assert.equal(calls, 1);
    assert.ok(result.every((item: { status: string }) => item.status === "failed"));
  }
});
