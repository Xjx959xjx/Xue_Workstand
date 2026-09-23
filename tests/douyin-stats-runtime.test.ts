import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildDouyinBatchStatsExtractJs, buildDouyinStatsExtractJs } from "../src/lib/opencli-douyin-scripts";

test("详情批量请求保留成功数据和每条失败原因", async () => {
  const rows = await vm.runInNewContext(buildDouyinBatchStatsExtractJs(["1", "2"]), {
    URL,
    fetch: async (url: string) => new URL(url).searchParams.get("aweme_id") === "1"
      ? { ok: true, json: async () => ({ aweme_detail: { create_time: 1788524143, statistics: { digg_count: 12, comment_count: 0, collect_count: 3, share_count: 4 } } }) }
      : { ok: false, status: 403 }
  });
  assert.equal(rows[0].hasStats, true);
  assert.equal(rows[0].publishedAt, 1788524143);
  assert.equal(rows[0].commentCount, 0);
  assert.equal(rows[1].hasStats, false);
  assert.match(rows[1].error, /HTTP 403/);
});

test("详情接口非 JSON 和业务错误不可伪装成无数据", async () => {
  for (const [response, expected] of [
    [{ ok: true, json: async () => { throw new Error("Unexpected token"); } }, /非 JSON/],
    [{ ok: true, json: async () => ({ status_code: 8, status_msg: "登录失效" }) }, /8：登录失效/]
  ] as const) {
    const rows = await vm.runInNewContext(buildDouyinBatchStatsExtractJs(["1"]), { URL, fetch: async () => response });
    assert.equal(rows[0].hasStats, false);
    assert.match(rows[0].error, expected);
    await assert.rejects(vm.runInNewContext(buildDouyinStatsExtractJs("1"), { URL, fetch: async () => response }), expected);
  }
});
