import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { planEngagementResearchQueries, reviewResearchCommentRelevance } from "../src/lib/engagement-research";

test("调研模型有限重试、阶段进度、取消与批次保留", async () => {
  const env = { ...process.env };
  const root = await mkdtemp(path.join(tmpdir(), "engagement-retry-"));
  let mode = "recover";
  let requests = 0;
  let progressSaved = false;
  let recoveredBatchFailed = false;
  const messages: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const userContent = body.messages?.[1]?.content || body.input?.[0]?.content;
    requests += 1;
    if (!body.stream) { res.writeHead(503); res.end("non-stream unavailable"); return; }
    if (mode === "unauthorized") { res.writeHead(401); res.end("unauthorized"); return; }
    if (mode === "recover" && !recoveredBatchFailed && JSON.parse(userContent).comments[0].text === "评论60") {
      recoveredBatchFailed = true;
      req.socket.destroy(); return;
    }
    if (mode === "fail" || mode === "cancel") {
      res.writeHead(503); res.end("unavailable"); return;
    }
    if (mode === "recover" && requests === 3) assert.equal(progressSaved, true);
    const content = mode === "plan"
      ? JSON.stringify({ queries: ["折叠手机"], sources: [{ query: "折叠手机", videoType: "真实上手", discussion: "折叠手机购买取舍" }], anchors: [], eventTerms: [] })
      : JSON.stringify({ decisions: JSON.parse(userContent).comments.map((row: { id: number }) => ({ id: row.id, keep: true, natural: true, contextComplete: true, reason: "正文折叠手机购买取舍", articleEvidence: brief.fullText })) });
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify(body.input ? { type: "response.output_text.delta", delta: content } : { choices: [{ delta: { content } }] })}\n\n`);
    if (mode !== "truncated") res.write(body.input
      ? 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'
      : 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|FHL_|SITES_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, CHAT_API_KEY: "fixture", CHAT_BASE_URL: `http://127.0.0.1:${address.port}`, CHAT_MODEL: "gpt-5.5", CHAT_WIRE_API: "chat_completions", CHAT_FALLBACK_ENABLED: "0" });
  const brief = { fullText: "折叠手机是否值得购买", summary: "", topic: "", subjects: [], keyFacts: [], discussionAngles: [], skepticalAngles: [], anchorTerms: [] };
  const samples = Array.from({ length: 61 }, (_, i) => ({ platform: "bilibili" as const, query: "折叠手机", videoId: "fixture", videoTitle: "折叠手机", text: `评论${i}`, likes: 0, replies: 0, videoMetric: 0, collectedAt: "2026-09-17" }));
  try {
    const selected = await reviewResearchCommentRelevance(samples, brief, undefined, async (message) => {
      messages.push(message);
      if (message.includes("自动重试")) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        progressSaved = true;
      }
    });
    assert.equal(selected.length, 61);
    assert.equal(requests, 3);
    assert.ok(messages.some((message) => message.includes("2/2") && message.includes("自动重试 1/1")));
    mode = "fail"; requests = 0;
    await assert.rejects(reviewResearchCommentRelevance(samples.slice(0, 1), brief), /AI 筛选评论 1\/1 批.*失败/);
    assert.equal(requests, 2);
    mode = "truncated"; requests = 0;
    await assert.rejects(reviewResearchCommentRelevance(samples.slice(0, 1), brief), /失败/);
    assert.equal(requests, 2, "可解析的半截流也不能保存为已审成功；最多重试一次");
    mode = "unauthorized"; requests = 0;
    await assert.rejects(reviewResearchCommentRelevance(samples.slice(0, 1), brief), /失败/);
    assert.equal(requests, 1);
    mode = "cancel"; requests = 0;
    const controller = new AbortController();
    await assert.rejects(reviewResearchCommentRelevance(samples.slice(0, 1), brief, controller.signal, (message) => {
      if (message.includes("自动重试")) controller.abort(new Error("用户取消"));
    }), /用户取消/);
    assert.equal(requests, 1);
    mode = "plan"; requests = 0; messages.length = 0;
    await planEngagementResearchQueries(brief, undefined, undefined, "bilibili", (message) => { messages.push(message); });
    assert.deepEqual(messages, ["正在AI 规划搜索关键词"]);
    assert.equal(requests, 1);
    process.env.CHAT_WIRE_API = "responses";
    requests = 0;
    await planEngagementResearchQueries(brief, undefined, undefined, "bilibili");
    assert.equal(requests, 1, "Responses 规划同样必须走可用的流式入口");
    mode = "review-response"; requests = 0;
    assert.equal((await reviewResearchCommentRelevance(samples.slice(0, 1), brief)).length, 1);
    assert.equal(requests, 1);
    mode = "truncated"; requests = 0;
    await assert.rejects(reviewResearchCommentRelevance(samples.slice(0, 2), brief), /失败/);
    assert.equal(requests, 2, "Responses 有文本但无 completed 事件不得被当成成功结果");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await rm(root, { recursive: true, force: true });
  }
});
