import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { readAiSettings, saveAiSettings, validateAiSettings } from "../src/lib/storage/ai-settings";
import { applyAiPolicy, aiPolicySignature, getAiSettingsView } from "../src/lib/ai-policy-runtime";
import { chatCompleteStrict, streamResponseText, analyzeMaterialFrames } from "../src/lib/ai";
import { getChatConfig } from "../src/lib/model-runtime";

async function isolated(run: (root: string) => Promise<void>) {
  const env = { ...process.env };
  const root = await mkdtemp(path.join(tmpdir(), "ai-settings-test-"));
  for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|WEB_RESEARCH_|IMAGE_|FHL_|SITES_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, CHAT_MODEL: "gpt-6-astra", CHAT_REASONING_EFFORT: "low", CHAT_FALLBACK_ENABLED: "0" });
  try { await run(root); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await rm(root, { recursive: true, force: true });
  }
}

test("配置原子保存、热读取与并发版本冲突，恢复默认不改其他链路", () => isolated(async (root) => {
  const initial = await readAiSettings();
  const signature = await aiPolicySignature(["comment_plan"]);
  const results = await Promise.allSettled([
    saveAiSettings({ ...initial, overrides: { comment_plan: { model: "gpt-6-astra", effort: "high" } } }),
    saveAiSettings({ ...initial, overrides: { comment_plan: { model: "gpt-5.5", effort: "medium" } } })
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const failed = results.find((r) => r.status === "rejected");
  assert.ok(failed?.status === "rejected" && failed.reason.status === 409);
  const saved = await readAiSettings();
  assert.equal(saved.revision, 1);
  assert.notEqual(await aiPolicySignature(["comment_plan"]), signature);
  const [config] = await applyAiPolicy([getChatConfig()], "comment_plan");
  assert.equal(config.model, saved.overrides.comment_plan?.model);
  assert.equal(config.reasoningEffort, saved.overrides.comment_plan?.effort);
  const view = await getAiSettingsView();
  assert.equal(view.effective.comment_generate.model, "gpt-6-astra");
  assert.equal(view.effective.comment_generate.effort, "low");
  assert.equal(view.effective.danmaku.model, "gpt-6.1-sol");
  assert.equal(view.effective.danmaku.effort, "medium");
  assert.equal(view.inheritedEfforts.transcript_clean, "low");
  assert.equal(view.inheritedEfforts.image_generate, "none");
  assert.equal(JSON.stringify(view).includes("apiKey"), false);
  await saveAiSettings({ ...saved, overrides: {} });
  assert.equal(await aiPolicySignature(["comment_plan"]), signature);
  assert.equal(JSON.parse(await readFile(path.join(root, "settings/ai-models.json"), "utf8")).schemaVersion, 1);
}));

test("损坏配置和未知字段显式失败，不静默回退", () => isolated(async (root) => {
  const value = await readAiSettings();
  assert.throws(() => validateAiSettings({ ...value, overrides: { unknown: { model: "x", effort: "low" } } }), /未知链路/);
  assert.throws(() => validateAiSettings({ ...value, overrides: { image_generate: { model: "gpt-image-2", effort: "high" } } }), /图片模型/);
  assert.throws(() => validateAiSettings({ ...value, overrides: { comment_plan: { model: "bad name", effort: "low" } } }), /模型名称/);
  await mkdir(path.join(root, "settings"), { recursive: true });
  await writeFile(path.join(root, "settings/ai-models.json"), "{broken");
  await assert.rejects(readAiSettings(), /JSON 文件损坏/);
}));

test("真实请求体使用保存的模型及等级，覆盖旧调用参数并支持流式和视觉", () => isolated(async () => {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); bodies.push(body);
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end('data: {"choices":[{"delta":{"content":"测试完成"}}]}\n\ndata: [DONE]\n\n');
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ visualNotes: "画面", structureNotes: "镜头", titleNotes: "标题" }) } }] }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  Object.assign(process.env, { CHAT_API_KEY: "synthetic-test-key", CHAT_BASE_URL: `http://127.0.0.1:${address.port}`, CHAT_WIRE_API: "chat_completions" });
  try {
    await saveAiSettings({ ...await readAiSettings(), overrides: {
      comment_plan: { model: "gpt-5.5", effort: "high" },
      writer_generate: { model: "gpt-5.5", effort: "low" },
      vision: { model: "gpt-5.5", effort: "medium" }
    } });
    await chatCompleteStrict([{ role: "user", content: "测试" }], "medium", { model: "old-model", policy: "comment_plan" });
    assert.equal(bodies[0].model, "gpt-5.5"); assert.equal(bodies[0].reasoning_effort, "high");
    await streamResponseText({ policy: "writer_generate", reasoningEffort: "high", messages: [{ role: "user", content: "测试" }], onDelta() {} });
    assert.equal(bodies[1].model, "gpt-5.5"); assert.equal(bodies[1].reasoning_effort, "low");
    await analyzeMaterialFrames({ frames: [], platform: "douyin", transcript: "测试", url: "" });
    assert.equal(bodies[2].model, "gpt-5.5"); assert.equal(bodies[2].reasoning_effort, "medium");
    await saveAiSettings({ ...await readAiSettings(), overrides: { comment_plan: { model: "gpt-6-astra", effort: "low" } } });
    await chatCompleteStrict([{ role: "user", content: "测试" }], "high", { policy: "comment_plan" });
    assert.equal(bodies[3].model, "gpt-6-astra"); assert.equal(bodies[3].reasoning_effort, "low");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}));
