import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOpenCliSearchQuery, buildWriterWebResearchMessages, completePreparedWriteCopy, prepareWriteCopyContext, webSearchCompleteStrict } from "../src/lib/ai";
import { saveStyle, upsertAccount } from "../src/lib/storage";
import { writerResearchBoundaryInstruction } from "../src/lib/writer-prompts";

test("备用搜索优先使用明确作品名，避免搜索写作指令", () => {
  assert.equal(buildOpenCliSearchQuery({ mode: "rewrite", prompt:
    "按当前所选参考风格改写，保留素材核心信息和话题角度。写一期游戏《篮球少女》的杂谈，自来水一点，然后要有内容" }), "篮球少女 游戏");
  assert.equal(buildOpenCliSearchQuery({ mode: "topic", prompt: "杭州秋季活动" }), "杭州秋季活动");
});

test("主题检索保留素材中的对象和时间条件，支持资料与要求分开传递", () => {
  const input = { mode: "topic" as const, prompt: "写一期游戏杂谈", sourceText: "《篮球少女》2026年5月测试的玩家讨论",
    supportDocContext: "官方说明：本次是测试版本" };
  const messages = buildWriterWebResearchMessages(input);
  assert.equal(messages.length, 2);
  for (const content of [input.prompt, input.sourceText, input.supportDocContext]) {
    assert.ok(messages[1].content.includes(content));
  }
  assert.ok(buildOpenCliSearchQuery(input).includes("篮球少女"));
  const withoutMaterials = buildWriterWebResearchMessages({ mode: "topic", prompt: "杭州活动" });
  assert.ok(!withoutMaterials[1].content.includes("undefined"));
});

test("首选搜索兼容 auto 工具选择，断流仅重试一次；参数、限流、鉴权和取消不重试", async () => {
  const originalEnv = { ...process.env };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "writer-research-recovery-"));
  let scenario = "disconnect";
  const requests: Record<string, unknown>[] = [];
  let controller = new AbortController();
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    // Reproduce relays which reject forced built-in tool selection.
    if (payload.tool_choice === "required" || scenario === "invalid" || scenario === "auth") {
      res.writeHead(scenario === "auth" ? 401 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: scenario === "auth" ? "unauthorized" : "invalid upstream request" } }));
      return;
    }
    if (scenario === "rate-limit") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ type: "response.failed", response: { error: { message: "Rate limit exceeded", code: "rate_limit_exceeded" } } })}\n\n`);
      return;
    }
    if (scenario === "no-tool") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end('data: {"type":"response.output_text.delta","delta":"仅凭记忆的回答 https://example.com/source"}\n\ndata: {"type":"response.completed","response":{}}\n\n');
      return;
    }
    if (payload.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "不完整资料" })}\n\n`);
      if (scenario === "cancel") controller.abort();
      if (scenario === "disconnect") setTimeout(() => res.destroy(), 20);
      else res.end(); // A clean EOF without response.completed is also incomplete.
      return;
    }
    if (scenario === "retry-eof") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end('data: {"type":"response.output_item.done","item":{"type":"web_search_call","status":"completed"}}\n\ndata: {"type":"response.output_text.delta","delta":"半截资料"}\n\n');
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "completed", output: [
      { type: "web_search_call", status: "completed" },
      { type: "message", content: [{ type: "output_text", text: "完整资料 https://example.com/source" }] }
    ] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  for (const key of Object.keys(process.env)) {
    if (/^(CHAT_|OPENAI_|FHL_|WEB_RESEARCH_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, WEB_RESEARCH_ENABLED: "1",
    WEB_RESEARCH_API_KEY: "fixture-key", WEB_RESEARCH_MODEL: "fixture",
    WEB_RESEARCH_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    CHAT_FALLBACK_ENABLED: "0" });
  try {
    for (scenario of ["disconnect", "eof", "retry-eof", "invalid", "rate-limit", "auth", "cancel", "no-tool"]) {
      requests.length = 0;
      controller = new AbortController();
      const run = () => webSearchCompleteStrict([{ role: "user", content: "搜索篮球少女" }], "low", { signal: controller.signal });
      if (scenario === "retry-eof") {
        await assert.rejects(run, /联网搜索连接中断/);
        assert.equal(requests.length, 2, "重试仍不完整时明确失败，不继续无限重试");
      } else if (["invalid", "rate-limit", "auth", "cancel", "no-tool"].includes(scenario)) {
        if (scenario === "no-tool") await assert.rejects(run, /模型没有实际调用 web_search 工具/);
        else await assert.rejects(run);
        assert.equal(requests.length, 1);
      } else {
        const result = await run();
        assert.equal(result.text, "完整资料 https://example.com/source");
        assert.deepEqual(result.usedTools, ["web_search"]);
        assert.deepEqual(requests.map(request => request.stream), [true, false]);
        assert.deepEqual(requests[1].tools, [{ type: "web_search" }]);
        for (const request of requests) assert.equal("max_output_tokens" in request, false, "首次和重试均不注入固定输出上限");
      }
      for (const request of requests) assert.equal(request.tool_choice, "auto");
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("联网无结果与部分命中：首稿和续改区分检索状态与事实，状态仍可查看", async () => {
  const originalEnv = { ...process.env };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "writer-research-boundary-"));
  let researchText = "";
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const event of [
      { type: "response.output_item.done", item: { type: "web_search_call", status: "completed" } },
      { type: "response.output_text.delta", delta: researchText },
      { type: "response.completed", response: {} }
    ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  for (const key of Object.keys(process.env)) {
    if (/^(CHAT_|OPENAI_|FHL_|WEB_RESEARCH_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    STYLE_LIBRARY_DIR: root,
    WEB_RESEARCH_ENABLED: "1",
    WEB_RESEARCH_API_KEY: "fixture-key",
    WEB_RESEARCH_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    WEB_RESEARCH_MODEL: "fixture",
    CHAT_FALLBACK_ENABLED: "0"
  });
  try {
    const account = await upsertAccount({ platform: "douyin", name: "资料边界测试", uid: "research-boundary" });
    await saveStyle(account.platform, account.id, "用自然口语介绍活动。");
    const source = "主办方宣布活动周六开始。嘉宾说：我还不确定周日是否参加。";
    const input = { platform: account.platform, accountId: account.id, mode: "rewrite" as const,
      prompt: "介绍活动，保留嘉宾原话", sourceText: source, useWebResearch: true };
    for (const research of [
      "检索结论：信息不足，没找到相关信息。\n关键信息：无。\n来源：无。",
      "检索结论：部分命中，未找到周日安排。\n关键信息：官方宣布周六开始。\n来源：主办方 https://example.com/event"
    ]) {
      researchText = research;
      const count = requests.length;
      const prepared = await prepareWriteCopyContext(input);
      assert.equal(requests.length, count + 1, "准备首稿只请求一次联网研究");
      assert.deepEqual(requests.at(-1)?.tools, [{ type: "web_search" }]);
      assert.equal(requests.at(-1)?.tool_choice, "auto");
      assert.equal("max_output_tokens" in requests.at(-1)!, false);
      assert.ok(prepared.messages[0].content.includes(writerResearchBoundaryInstruction()));
      assert.match(prepared.messages[1].content, /含内部检索状态，仅有依据的相关事实可用于成稿/);
      assert.ok(prepared.messages[1].content.includes(source), "素材本身的不确定性不被删词过滤");
      assert.ok(prepared.research?.includes(research), "无结果和部分结果状态都保留在参考资料中");
      assert.ok(prepared.messages[1].content.includes(research), "不丢失可用事实和来源");
      await saveStyle(account.platform, account.id, "简短开场，再按时间顺序介绍活动。");
      const reused = await prepareWriteCopyContext(input);
      assert.equal(requests.length, count + 1, "重新生成或改变风格卡仍复用联网资料");
      assert.equal(reused.research, prepared.research);
      const result = await completePreparedWriteCopy({ prepared, save: true,
        result: { text: source, model: "fixture", ok: true, fallback: false } });
      assert.equal(result.content, source, "不通过后处理删除合法的“不确定”原话");
      const draft = result.draft!;
      const revised = await prepareWriteCopyContext({ ...input, action: "revise", parentDraftId: draft.id,
        currentContent: draft.content, revisionInstruction: "开头更自然", revisionScope: "selection", selectedText: "主办方宣布活动周六开始。" });
      assert.equal(requests.length, count + 1, "续改复用资料，不重新联网");
      assert.ok(revised.messages[0].content.includes(writerResearchBoundaryInstruction()));
      assert.match(revised.messages[1].content, /含内部检索状态及检查备注，不作为正文复述/);
      assert.match(revised.messages[1].content, /其他段落保持不变/);
      assert.ok(revised.research?.includes(research));
      assert.ok(revised.messages[1].content.includes(source));
      input.prompt += "。补充核实周日安排";
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await fs.rm(root, { recursive: true, force: true });
  }
});
