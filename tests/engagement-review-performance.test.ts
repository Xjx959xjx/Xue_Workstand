import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildResearchReviewPayload, reviewResearchCommentRelevance } from "../src/lib/engagement-research";

const brief = { fullText: "折叠手机的使用体验与价格取舍", summary: "", topic: "", subjects: [], keyFacts: [], discussionAngles: [], skepticalAngles: [], anchorTerms: [] };
const samples = Array.from({ length: 181 }, (_, i) => ({ platform: "bilibili" as const, query: "折叠手机", videoId: "fixture", videoTitle: "折叠手机体验", text: `评论${i}`, likes: i, replies: 0, videoMetric: 0, collectedAt: "2026-09-22" }));

test("筛选输入去重来源但保留完整正文、评论与不同来源语境", () => {
  const payload = buildResearchReviewPayload([...samples.slice(0, 2), { ...samples[2], videoId: "other", videoTitle: "其他语境" }], brief);
  assert.equal(payload.article, brief.fullText);
  assert.equal(payload.sources.length, 2);
  assert.deepEqual(payload.comments.map((row) => row.sourceId), [0, 0, 1]);
  assert.deepEqual(payload.comments.map((row) => row.text), samples.slice(0, 3).map((row) => row.text));
  assert.equal(payload.sources[1].title, "其他语境");
});

test("筛选最多两批并发，缓存隔离、失败续跑、取消及损坏缓存显式失败", async () => {
  const env = { ...process.env };
  const root = await mkdtemp(path.join(tmpdir(), "engagement-review-"));
  let requests = 0;
  let active = 0;
  let maxActive = 0;
  let fail = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const messages = JSON.parse(raw).messages;
    assert.match(messages[0].content, /疑似推广或批量生成的单条评论即使相关也 keep=false/);
    assert.match(messages[0].content, /不能仅凭好评/);
    const payload = JSON.parse(messages[1].content);
    requests += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 40));
    active -= 1;
    if (fail && payload.comments[0].text === "评论60") {
      res.writeHead(401); res.end("unauthorized"); return;
    }
    const decisions = payload.comments.map((row: { id: number; text: string }) => ({ id: row.id, keep: Number(row.text.slice(2)) % 2 === 0 }));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decisions }) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|FHL_|SITES_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, CHAT_API_KEY: "fixture", CHAT_BASE_URL: `http://127.0.0.1:${address.port}`, CHAT_MODEL: "gpt-5.5", CHAT_WIRE_API: "chat_completions", CHAT_FALLBACK_ENABLED: "0" });
  try {
    const previews: number[] = [];
    const result = await reviewResearchCommentRelevance(samples, brief, undefined, undefined, (rows) => { previews.push(rows.length); });
    assert.equal(requests, 4);
    assert.equal(maxActive, 2);
    assert.equal(active, 0);
    assert.deepEqual(previews, [60, 91]);
    assert.deepEqual(result.map((row) => row.text), samples.filter((_, i) => i % 2 === 0).reverse().map((row) => row.text));
    requests = 0;
    assert.deepEqual(await reviewResearchCommentRelevance(samples, brief), result);
    assert.equal(requests, 0);
    const changed = samples.map((row, i) => i === 0 ? { ...row, videoTitle: "新来源语境" } : row);
    await reviewResearchCommentRelevance(changed, brief);
    assert.equal(requests, 1);
    requests = 0;
    process.env.CHAT_MODEL = "different-model";
    await reviewResearchCommentRelevance(samples, brief);
    assert.equal(requests, 4);
    requests = 0;
    fail = true;
    const newBrief = { ...brief, fullText: "不同正文" };
    await assert.rejects(reviewResearchCommentRelevance(samples, newBrief), /失败/);
    assert.equal(requests, 2);
    assert.equal(active, 0);
    requests = 0;
    fail = false;
    await reviewResearchCommentRelevance(samples, newBrief);
    assert.equal(requests, 3, "仅重做失败批次与未开始批次");
    requests = 0;
    const early = await reviewResearchCommentRelevance(samples, { ...brief, fullText: "提前结束" }, undefined, undefined, undefined, {
      enoughSamples: (rows) => rows.length >= 50
    });
    assert.equal(requests, 2);
    assert.equal(early.length, 60);
    requests = 0;
    fail = true;
    let partialReason = "";
    const partial = await reviewResearchCommentRelevance(samples, { ...brief, fullText: "保留通过质检部分" }, undefined, undefined, undefined, {
      onPartial: (reason) => { partialReason = reason; }
    });
    assert.equal(requests, 2);
    assert.equal(partial.length, 30);
    assert.match(partialReason, /部分评论筛选失败/);
    fail = false;
    requests = 0;
    await assert.rejects(reviewResearchCommentRelevance(samples, { ...brief, fullText: "零预算" }, undefined, undefined, undefined, { maxDurationMs: 0 }), /时间预算/);
    assert.equal(requests, 0);
    requests = 0;
    const controller = new AbortController();
    await assert.rejects(reviewResearchCommentRelevance(samples, { ...brief, fullText: "取消测试" }, controller.signal, undefined, () => {
      controller.abort(new Error("用户取消"));
    }), /用户取消/);
    assert.equal(requests, 2, "取消后不得开始下一轮");
    const cacheDir = path.join(root, "engagement", ".cache", "research");
    for (const file of await readdir(cacheDir)) await writeFile(path.join(cacheDir, file), JSON.stringify({ schemaVersion: 1 }));
    await assert.rejects(reviewResearchCommentRelevance(samples, brief), /缓存损坏/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await rm(root, { recursive: true, force: true });
  }
});
