import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { completePreparedWriteCopy, prepareWriteCopyContext } from "../src/lib/ai";
import { saveStyle, upsertAccount } from "../src/lib/storage";
import { writerResearchBoundaryInstruction } from "../src/lib/writer-prompts";

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
      assert.ok(prepared.messages[0].content.includes(writerResearchBoundaryInstruction()));
      assert.match(prepared.messages[1].content, /含内部检索状态，仅有依据的相关事实可用于成稿/);
      assert.ok(prepared.messages[1].content.includes(source), "素材本身的不确定性不被删词过滤");
      assert.ok(prepared.research?.includes(research), "无结果和部分结果状态都保留在参考资料中");
      assert.ok(prepared.messages[1].content.includes(research), "不丢失可用事实和来源");
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
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await fs.rm(root, { recursive: true, force: true });
  }
});
