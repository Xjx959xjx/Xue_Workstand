import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareWriteCopyBatchContext, prepareWriteCopyContext } from "../src/lib/ai";
import { saveStyle, upsertAccount } from "../src/lib/storage";

test("分组检索覆盖全部对象，最多三路并发；失败或取消不返回部分资料、不缓存", async () => {
  const original = { ...process.env };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "writer-parallel-research-"));
  const subjects = Array.from({ length: 7 }, (_, i) => `型号${i + 1}`);
  const questions = ["屏幕规格及对应版本", "蒸汽档位及安装条件"];
  let scenario = "success";
  let planningCalls = 0, active = 0, peak = 0;
  const requests: Record<string, unknown>[] = [];
  const failureClosed: Promise<void>[] = [];
  let controller = new AbortController();
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (!payload.tools?.length) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      planningCalls++;
      const plan = { subjects: scenario === "invalid" ? [] : subjects, questions };
      res.end(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(plan) })}\n\ndata: {"type":"response.completed","response":{}}\n\n`);
      return;
    }
    requests.push(payload);
    active++;
    peak = Math.max(peak, active);
    res.on("close", () => { active--; });
    if (scenario === "cancel") {
      controller.abort();
      return;
    }
    const scope = payload.input[0].content.match(/本路仅负责的对象：\n([\s\S]*?)\n需要逐项核实的问题：/)[1];
    if (scenario === "group-failure") {
      failureClosed.push(new Promise<void>(resolve => res.once("close", resolve)));
      // The last group fails while both earlier groups remain pending.
      if (scope.includes("型号3")) setTimeout(() => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "invalid upstream request" } }));
      }, 30);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const requestScenario = scenario;
    // Finish out of order to ensure evidence is still merged in plan order.
    setTimeout(() => {
      if (res.destroyed) return;
      if (requestScenario !== "no-tool") res.write('data: {"type":"response.output_item.done","item":{"type":"web_search_call","status":"completed"}}\n\n');
      res.end(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: `${scope}\n已核实屏幕规格 https://example.com/${encodeURIComponent(scope)}\n蒸汽档位：未找到可核实资料` })}\n\ndata: {"type":"response.completed","response":{}}\n\n`);
    }, scope.includes("型号1") ? 30 : 10);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|FHL_|WEB_RESEARCH_|SITES_|OPENCLI_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, WEB_RESEARCH_ENABLED: "1", WEB_RESEARCH_API_KEY: "fixture",
    WEB_RESEARCH_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, WEB_RESEARCH_MODEL: "fixture" });
  try {
    const account = await upsertAccount({ platform: "douyin", uid: "parallel", name: "分组验证" });
    await saveStyle(account.platform, account.id, "自然说明产品。");
    const input = { platform: account.platform, accountId: account.id, mode: "rewrite" as const,
      prompt: "比较各型号", sourceText: `${subjects.join("、")}，需要比较屏幕规格、蒸汽档位和安装条件。`, useWebResearch: true };
    const progress: string[] = [];
    const prepared = await prepareWriteCopyBatchContext(input, { onProgress: message => progress.push(message) });
    assert.equal(planningCalls, 1);
    assert.equal(requests.length, 3, "超过三个对象时分组保留，不丢弃多出的对象");
    assert.equal(peak, 3);
    assert.ok(progress.some(message => message.includes("3/3")));
    for (const subject of subjects) assert.ok(prepared.research?.includes(subject));
    assert.equal((prepared.research?.match(/已核实屏幕规格/g) || []).length, 3, "保留各路原始证据，不二次摘要丢失");
    for (const request of requests) {
      const content = (request.input as { content: string }[])[0].content;
      assert.ok(content.includes(input.sourceText), "每路保留完整材料作为上下文");
      for (const question of questions) assert.ok(content.includes(question));
    }
    await prepareWriteCopyContext(input);
    assert.equal(planningCalls, 1, "完整成功结果直接复用，不重新规划");
    assert.equal(requests.length, 3);

    const cacheDir = path.join(root, ".cache", "writer-research");
    scenario = "group-failure";
    const failureDeadline = setTimeout(() => controller.abort(), 2000);
    try {
      await assert.rejects(prepareWriteCopyContext({ ...input, prompt: "单组失败应立即结束" }, { signal: controller.signal }), /接口不兼容.*本次未生成草稿/);
      await Promise.all(failureClosed);
      assert.equal(controller.signal.aborted, false, "单组失败后主动中断其余请求，未等测试取消或总预算到期");
      assert.equal(failureClosed.length, 3);
      assert.equal((await fs.readdir(cacheDir)).length, 1, "整组失败不缓存部分资料");
    } finally {
      clearTimeout(failureDeadline);
    }
    for (scenario of ["invalid", "no-tool", "cancel"]) {
      const before = requests.length;
      controller = new AbortController();
      await assert.rejects(prepareWriteCopyContext({ ...input, prompt: `测试${scenario}` }, { signal: controller.signal }),
        (error: unknown) => error instanceof Error && (scenario === "cancel" ? controller.signal.aborted : /本次未生成草稿/.test(error.message)));
      assert.equal((await fs.readdir(cacheDir)).length, 1, "失败和取消均未写入缓存");
      assert.ok(requests.length - before <= 3, "失败不再启动剩余分组");
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    await fs.rm(root, { recursive: true, force: true });
  }
});
