import nextEnv from "@next/env";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { getChatConfig, postModelRequest, chatCompletionPayload, classifyModelFailure } from "../src/lib/model-runtime";
import { writeJsonFile } from "../src/lib/storage/fs";

(nextEnv as unknown as { loadEnvConfig: (dir: string, dev: boolean, logger: { info(): void; error(): never }) => unknown }).loadEnvConfig(process.cwd(), true, { info() {}, error() { throw new Error("模型配置读取失败"); } });
const base = getChatConfig();
if (!base.apiKey || !base.proxyUrl) throw new Error("测速需要已配置的模型密钥和代理地址。");
const destination = path.resolve("outputs/model-connection-benchmark", new Date().toISOString().replace(/[:.]/g, "-"), "results.json");
const results: Record<string, unknown>[] = [];
const prompt = "这是连接速度测试。请用中文写六条整理书桌的建议，每条约20字，直接输出建议，不写前言。";
// Synthetic material only. Do not persist credentials, URLs or response text.
for (let round = 1; round <= 3; round++) {
  for (const route of round % 2 ? ["proxy", "direct"] : ["direct", "proxy"]) {
    const config = { ...base, proxyUrl: route === "proxy" ? base.proxyUrl : "" };
    const start = performance.now();
    const result: Record<string, unknown> = { round, route, status: "running" };
    const chunks: number[] = [];
    let chars = 0;
    let firstTextMs: number | null = null;
    let finished = false;
    let buffer = "";
    console.log(`第 ${round}/3 轮：${route === "proxy" ? "代理" : "不使用显式代理"}，开始请求`);
    try {
      const response = await postModelRequest(config, "/chat/completions", chatCompletionPayload({
        config, messages: [{ role: "user", content: prompt }], reasoningEffort: "low", stream: true, maxOutputTokens: 512
      }), AbortSignal.timeout(45_000));
      result.headersMs = Math.round(performance.now() - start);
      if (!response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel();
        throw new Error("中转站未返回 SSE 流式响应");
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const consume = (line: string) => {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (!data) return;
        if (data === "[DONE]") { finished = true; return; }
        const event = JSON.parse(data);
        if (event.error) throw new Error("中转站返回流内错误");
        const text = (event.choices || []).map((choice: { delta?: { content?: string } }) => choice.delta?.content || "").join("");
        if (text) { firstTextMs ??= Math.round(performance.now() - start); chars += text.length; }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Math.round(performance.now() - start));
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
          lines.forEach(consume);
        }
        buffer += decoder.decode();
        consume(buffer);
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      result.status = chars && finished ? "completed" : "failed";
      if (result.status === "failed") result.message = "响应正文为空或缺少流结束标记";
    } catch (error) {
      result.status = "failed";
      result.failureKind = classifyModelFailure(error).kind;
    }
    Object.assign(result, { totalMs: Math.round(performance.now() - start), firstTextMs, outputChars: chars,
      chunksMs: chunks, maxChunkGapMs: chunks.length > 1 ? Math.max(...chunks.slice(1).map((t, i) => t - chunks[i])) : null });
    results.push(result);
    await writeJsonFile(destination, { schemaVersion: 1, model: base.model, protocol: "chat_completions", reasoningEffort: "low", prompt, results });
    console.log(JSON.stringify(result));
  }
}
console.log(`测速结果：${destination}`);
