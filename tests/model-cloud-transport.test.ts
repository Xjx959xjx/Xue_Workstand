import assert from "node:assert/strict";
import test from "node:test";
import { getChatConfig, postModelRequest } from "../src/lib/model-runtime";

test("云端模型请求使用原生 fetch 并保留凭证、取消和流式响应", async () => {
  const previousMode = process.env.SITES_STORAGE_MODE;
  const previousFetch = globalThis.fetch;
  try {
    process.env.SITES_STORAGE_MODE = "cloud";
    const controller = new AbortController();
    let called = false;
    globalThis.fetch = async (input, init) => {
      called = true;
      assert.equal(String(input), "https://model.example.test/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-test-key");
      assert.equal(init?.signal, controller.signal);
      assert.equal(JSON.parse(String(init?.body)).stream, true);
      assert.equal("dispatcher" in (init || {}), false);
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    };
    const config = { ...getChatConfig(), apiKey: "synthetic-test-key", baseUrl: "https://model.example.test/v1", chatCompletionsUrl: "", proxyUrl: "" };
    const response = await postModelRequest(config, "/chat/completions", { stream: true }, controller.signal);
    assert.equal(called, true);
    assert.match(await response.text(), /"content":"ok"/);
    await assert.rejects(() => postModelRequest({ ...config, proxyUrl: "http://127.0.0.1:7890" }, "/chat/completions", {}), /不能使用本机模型代理/);
    globalThis.fetch = async () => new Response('{"error":"rate limited"}', { status: 429 });
    await assert.rejects(() => postModelRequest(config, "/chat/completions", {}), { status: 429 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.SITES_STORAGE_MODE;
    else process.env.SITES_STORAGE_MODE = previousMode;
  }
});
