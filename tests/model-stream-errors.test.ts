import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { streamResponseText } from "../src/lib/ai";
import { classifyModelFailure, ModelHttpError } from "../src/lib/model-runtime";

test("HTTP 503 型号不存在归为配置错误，不按暂时故障重试", () => {
  const error = new ModelHttpError(503, JSON.stringify({ error: { code: "model_not_found" } }));
  for (const value of [error, new Error("关键词规划失败", { cause: error })]) {
    const failure = classifyModelFailure(value);
    assert.equal(failure.kind, "endpoint");
    assert.match(failure.userMessage, /当前节点不支持所选模型/);
  }
});

test("HTTP 400/422 参数拒绝不归为可重试的上游故障", () => {
  for (const status of [400, 422]) {
    const failure = classifyModelFailure(new ModelHttpError(status, JSON.stringify({ error: { message: "invalid upstream request" } })));
    assert.equal(failure.kind, "endpoint");
    assert.match(failure.userMessage, /请求参数或模型配置不兼容/);
  }
  const unavailable = new ModelHttpError(503, JSON.stringify({ error: { code: "no_available_provider" } }));
  assert.equal(classifyModelFailure(unavailable).kind, "server");
});

test("HTTP200流内错误明确失败，部分文本不冒充完整成功", async () => {
  const original = { ...process.env };
  let body = "";
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|FHL_)/.test(key)) delete process.env[key];
  Object.assign(process.env, {
    CHAT_API_KEY: "fixture", CHAT_BASE_URL: `http://127.0.0.1:${address.port}`,
    CHAT_MODEL: "gpt-6-astra", CHAT_WIRE_API: "chat_completions", CHAT_FALLBACK_ENABLED: "0"
  });
  const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  const run = (onDelta: (text: string) => void = () => {}) => streamResponseText({
    messages: [{ role: "user", content: "测试" }], reasoningEffort: "low", onDelta
  });
  try {
    body = event({ error: { message: "Our servers are currently overloaded. Please try again later." } });
    await assert.rejects(run(), error => {
      const failure = classifyModelFailure(error);
      assert.equal(failure.kind, "server");
      assert.match(failure.userMessage, /过载/);
      return true;
    });
    body = event({ error: { message: "Rate limit exceeded" } });
    await assert.rejects(run(), /限流/);
    body = event({ error: { message: "private endpoint secret-value" } });
    await assert.rejects(run(), error => error instanceof Error && /流式响应返回错误/.test(error.message) && !error.message.includes("secret-value"));
    body = event({ choices: [{ delta: { content: "未完成" } }] }) + event({ error: { message: "overloaded" } });
    let partial = "";
    await assert.rejects(run(text => { partial += text; }));
    assert.equal(partial, "未完成");
    body = event({ choices: [{ delta: { content: "完成" } }] }) + "data: [DONE]\n\n";
    assert.equal((await run()).text, "完成");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
