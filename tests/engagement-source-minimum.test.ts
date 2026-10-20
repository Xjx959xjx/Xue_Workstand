import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { selectEligibleCommentSources, sourceCommentCount } from "../src/lib/engagement-source-selection";
import { getDouyinRelatedTopicComments } from "../src/lib/opencli";
import { getBilibiliRelatedTopicComments } from "../src/lib/opencli-bilibili";

test("来源门槛拒绝200及以下和未知，201、224、266条入选", async () => {
  const fetched: string[] = [];
  const result = await selectEligibleCommentSources([
    { id: "low", commentCount: 199 }, { id: "boundary", commentCount: 200 }, { id: "missing" }, { id: "valid" },
    { id: "middle", commentCount: 224 }, { id: "higher", commentCount: 266 }, { id: "unused" }
  ], 3, async (video) => { fetched.push(video.id); return video.id === "valid" ? 201 : undefined; });
  assert.deepEqual(result.videos, [{ id: "valid", commentCount: 201 }, { id: "middle", commentCount: 224 }, { id: "higher", commentCount: 266 }]);
  assert.deepEqual(fetched, ["missing", "valid"]);
  assert.match(result.errors.join("；"), /199.*超过 200.*评论总数 200.*无法确认评论总数/);
  for (const value of [undefined, null, "", "很多", NaN, -1, 299.9, [], true]) assert.equal(sourceCommentCount(value), undefined);
  assert.equal(sourceCommentCount("300"), 300);
});

test("计数核验取消和访问限制不会放行未知来源", async () => {
  const controller = new AbortController();
  await assert.rejects(selectEligibleCommentSources([{ id: "a" }], 1, async () => {
    controller.abort(new Error("用户取消")); return 300;
  }, controller.signal), /用户取消/);
  let calls = 0;
  const result = await selectEligibleCommentSources([{ id: "a" }, { id: "b" }], 2, async () => {
    calls++; throw new Error("HTTP 403，请检查登录");
  });
  assert.equal(calls, 1); assert.equal(result.videos.length, 0);
  assert.match(result.errors[0], /核验失败.*403/);
});

test("双平台真实适配链路先核验详情，200条来源跳过、201条来源进入评论分页", async () => {
  const env = { ...process.env };
  for (const key of Object.keys(process.env)) if (/^OPENCLI_/.test(key)) delete process.env[key];
  Object.assign(process.env, { OPENCLI_NODE_BIN: process.execPath,
    OPENCLI_SCRIPT: path.resolve("tests/fixtures/engagement-c-cli.mjs"),
    OPENCLI_BROWSER_SESSION: "source-minimum-fixture", COMMENT_TEST_CORPUS: "threshold" });
  try {
    const douyin = await getDouyinRelatedTopicComments("手机", { videoLimit: 2, commentLimit: 200 });
    const bili = await getBilibiliRelatedTopicComments("手机", { videoLimit: 2, commentLimit: 200, replyLimit: 0 });
    assert.deepEqual(douyin.videos.map((v) => [v.id, v.commentCount]), [["2222222222222222222", 201]]);
    assert.equal(bili.videos[0].views, 999);
    assert.deepEqual(bili.videos.map((v) => [v.id, v.commentCount]), [["BV2xx411c7mD", 201]]);
    for (const result of [douyin, bili]) {
      assert.equal(result.comments.length, 200);
      assert.equal(result.collectionAttempts?.length, 1, "低评论和未知来源不得发起评论分页");
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
