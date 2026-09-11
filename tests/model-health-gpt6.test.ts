import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { probeChatModel } from "../src/lib/model-runtime";

test("GPT6健康检查使用low与可用预算，两个协议均兼容", async () => {
  const original = { ...process.env };
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(req.url?.endsWith("responses")
      ? 'data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: {"type":"response.completed","response":{}}\n\n'
      : 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|FHL_)/.test(key)) delete process.env[key];
    Object.assign(process.env, { CHAT_API_KEY: "fixture", CHAT_BASE_URL: `http://127.0.0.1:${address.port}`, CHAT_MODEL: "gpt-6", CHAT_FALLBACK_ENABLED: "0" });
    for (const wire of ["responses", "chat_completions"]) {
      process.env.CHAT_WIRE_API = wire;
      assert.equal((await probeChatModel()).ok, true);
      const sent = requests.at(-1)!;
      assert.equal(sent.stream, true);
      if (wire === "responses") {
        assert.deepEqual(sent.reasoning, { effort: "low" });
        assert.equal(sent.max_output_tokens, 256);
      } else {
        assert.equal(sent.reasoning_effort, "low");
        assert.equal(sent.max_tokens, 256);
        assert.equal("temperature" in sent, false);
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
