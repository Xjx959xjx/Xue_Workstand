import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseStyleEvidence, validateWriterPlan, snapshotReferences, batchCandidates,
  checkWriterConstraints, validateStyleCardCitations, referenceText, candidateIndex,
  type StyleEvidence, type WriterCandidate, type WriterPlan
} from "../src/lib/writer-context";
import { parseStoredRecord } from "../src/lib/storage/schemas";
import { prepareWriteCopyContext, prepareWriteCopyBatchContext, resolveWriteBatchOutcome, completePreparedWriteCopy, prepareAccountStyleContext, completePreparedAccountStyle } from "../src/lib/ai";
import { upsertAccount, saveStyle, readStyle, saveVideos, saveTranscript, saveDraft, resolveDraft, getDraftSummaries } from "../src/lib/storage";
import { POST as preferenceRoute } from "../src/app/api/write/preference/route";
import { POST as saveDraftRoute } from "../src/app/api/drafts/route";
import type { Account, Video, Draft } from "../src/lib/types";

const quote = "先看这座景区发生了什么，再说游戏联动的具体规则。";
const evidence: StyleEvidence = {
  genre: "活动事件讲述", purposes: ["活动介绍"], unsuitable: ["无依据的争议指控"],
  structure: "现场现象引入，解释规则，落到参与方式",
  narrative: { forms: ["吃瓜切入"], beats: [{ purpose: "现场现象带入活动", quote }], bridges: [] },
  moves: [{ quote, action: "从可感知的现象引出活动", when: "有现场素材", avoid: "没有现场证据时不编造见闻" }], limitations: ["单篇依据"]
};
const task: WriterPlan["task"] = {
  purpose: "活动推广", facts: [{ text: "活动可试驾", quote: "活动可试驾" }],
  mustKeep: [], creativeFreedom: "原框架仅供参考，可以重组", timeContext: "未指定", uncertainties: [],
  forbiddenTerms: [{ text: "联名", quote: "不用联名" }], length: { min: 4, max: 20, quote: "4—20字" }
};
const inputText = "活动可试驾，不用联名，4—20字。原框架仅供参考。";
const candidate: WriterCandidate = { id: "event", title: "低热度活动", transcript: quote, analysis: evidence };
const plan = (id = "event"): WriterPlan => ({ task, selected: [{ id, reason: "活动用途相符，借鉴现场切入" }], applicableStyle: ["先讲具体活动，再解释规则"], notes: [] });

test("风格引句与任务事实必须来自各自原文，跨账号ID不能混入", () => {
  assert.deepEqual(parseStyleEvidence(JSON.stringify(evidence), quote, "样本"), evidence);
  assert.throws(() => parseStyleEvidence(JSON.stringify(evidence), "另一篇原文", "样本"), /原文定位/);
  assert.throws(() => validateWriterPlan(plan("other-account"), [candidate], inputText), /不属于本风格/);
  assert.throws(() => validateWriterPlan({ ...plan(), task: { ...task, facts: [{ text: "销量高", quote: "旧案例销量高" }] } }, [candidate], inputText), /引句/);
  assert.throws(() => validateWriterPlan({ ...plan(), selected: [plan().selected[0], plan().selected[0]] }, [candidate], inputText), /重复/);
  assert.equal(validateWriterPlan(plan(), [candidate], inputText).selected.length, 1);
  assert.throws(() => validateStyleCardCitations("没有依据的新卡", [{ sourceId: "event", quote }]), /引用/);
  assert.throws(() => validateStyleCardCitations(`[[other]]「${quote}」`, [{ sourceId: "event", quote }]), /引用/);
  validateStyleCardCitations(`[[event]]「${quote}」`, [{ sourceId: "event", quote }]);
});

test("参考按总预算保留全文或完整证据，不截掉长文结尾也不固定篇数", () => {
  const long = { ...candidate, transcript: "前文".repeat(9000) + quote };
  const reference = snapshotReferences([long], plan())[0];
  assert.match(reference.text, /非全文/);
  assert.ok(reference.text.includes(quote));
  assert.ok(reference.text.length < 14_000);
  const candidates = Array.from({ length: 10 }, (_, i) => ({ ...candidate, id: String(i) }));
  assert.equal(batchCandidates(candidates, 1000).flat().length, 10);
  const selected = candidates.map(c => ({ id: c.id, reason: "用途相符" }));
  assert.equal(snapshotReferences(candidates, { ...plan(), selected }).length, 10);
  assert.deepEqual(checkWriterConstraints("活动可试驾", task), []);
  assert.ok(checkWriterConstraints("联名", task).length === 2);
});

const eventBefore = "当然啊，这个也有怀疑是不是有人故意搞恶作剧，呃，但真相其实很快就被揭开了，永劫无间干的。";
const eventAfter = "而他们之所以这么做呢，原因也很简单，就是给自己的新版本做宣传。";
const eventRule = "就是在地图上线首周内，只要协助游戏内的人物刘邦成功撤离，就有机会触发特殊撤离动画。";
const mixedEventText = `${eventBefore}\n${eventAfter}\n${eventRule}`;
// Manually annotated excerpts from 7669313121198376436; these validate data flow, not model judgement.
const mixedEventEvidence: StyleEvidence = {
  ...evidence, genre: "吃瓜事件讲述", purposes: ["讲述玩家趣事", "介绍版本活动"],
  narrative: {
    forms: ["吃瓜", "揭晓悬念"],
    beats: [{ purpose: "揭晓现象来源", quote: eventBefore }, { purpose: "说明活动目的", quote: eventAfter }, { purpose: "解释参与规则", quote: eventRule }],
    bridges: [{ before: eventBefore, after: eventAfter, action: "揭晓趣事与游戏的关联，再解释活动", requires: "真实的活动现象和对应关系" }]
  },
  moves: [{ ...evidence.moves[0], quote: eventRule }]
};

test("目的与讲法可并存，段落和衔接引句必须按原文顺序定位", () => {
  const parsed = parseStyleEvidence(JSON.stringify(mixedEventEvidence), mixedEventText, "吃瓜推广");
  assert.deepEqual(parsed.purposes, ["讲述玩家趣事", "介绍版本活动"]);
  assert.deepEqual(candidateIndex({ ...candidate, analysis: parsed }).narrative, parsed.narrative);
  const narrative = mixedEventEvidence.narrative!;
  assert.throws(() => parseStyleEvidence(JSON.stringify({ ...mixedEventEvidence, narrative: { ...narrative, beats: [...narrative.beats].reverse() } }), mixedEventText, "倒序"), /段落顺序/);
  assert.throws(() => parseStyleEvidence(JSON.stringify({ ...mixedEventEvidence, narrative: { ...narrative, bridges: [{ ...narrative.bridges[0], before: eventAfter, after: eventBefore }] } }), mixedEventText, "倒接"), /前后顺序/);
  assert.throws(() => parseStyleEvidence(JSON.stringify({ ...mixedEventEvidence, narrative: { ...narrative, bridges: [{ ...narrative.bridges[0], after: "网友纷纷报名" }] } }), mixedEventText, "虚构"), /原文定位/);
  const legacy = { ...evidence, narrative: undefined };
  assert.doesNotThrow(() => parseStoredRecord("旧缓存", { schemaVersion: 1, version: 1, cacheKey: "old", kind: "account-video", sourceId: "old",
    title: "旧分析", inputChars: quote.length, analysis: JSON.stringify(legacy), evidence: legacy, usedModel: "fixture", reasoningEffort: "high", generatedAt: new Date().toISOString() }, "style-analysis"));
  assert.throws(() => parseStyleEvidence(JSON.stringify(legacy), quote, "旧分析"), /讲述方式与段落衔接/);
});

test("长文优先保留衔接两端之间的原文，片段有分隔且不超预算", () => {
  const middle = "关于玩家 ID 成为景点这件事呢，他们给出的解释是这样子的啊。";
  const transcript = "前面的其他事件。".repeat(100) + `${eventBefore}\n${middle}\n${eventAfter}\n${eventRule}`;
  const sample = { ...candidate, transcript, analysis: mixedEventEvidence };
  const text = referenceText(sample, 300);
  assert.ok(text.includes(`${eventBefore}\n${middle}\n${eventAfter}`), "不能直接拼接两个端点、删除中间的原文");
  assert.match(text, /另一个原文片段/);
  assert.ok(text.indexOf(eventBefore) < text.indexOf(eventRule));
  for (const budget of [0, 20, 70, 150, 300]) assert.ok(referenceText(sample, budget).length <= budget);
});

test("吃瓜推广的衔接进入选样、首稿和风格卡引用，纯评论也允许没有推广段", async () => {
  await fixture(async ({ account, requests, setReply }) => {
    await saveVideos(account, [video(account, "mixed", "景区奇怪现象", 10)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "mixed", text: mixedEventText, source: "manual" });
    setReply(messages => messages[0].includes("完整阅读这一篇") ? JSON.stringify(mixedEventEvidence)
      : JSON.stringify({ ...plan(`douyin:${account.id}:mixed`), applicableStyle: ["先讲真实的活动趣事，揭晓关联后解释参与规则"] }));
    const prepared = await prepareWriteCopyContext({ platform: account.platform, accountId: account.id, mode: "rewrite", prompt: inputText, sourceText: inputText });
    assert.equal(requests.length, 0, "直接写作准备不调用模型");
    assert.ok(prepared.messages[1].content.includes(mixedEventText), "成稿阶段仍有完整原文上下文");
    assert.equal(prepared.draftBase?.writerContext?.samples[0].id, `douyin:${account.id}:mixed`);
    assert.deepEqual(prepared.draftBase?.writerContext?.plan?.task.facts, [], "范文旧活动不变成本次事实");
    const context = await prepareAccountStyleContext(account.platform, account.id);
    const style = `## 趣事转活动\n单篇观察：揭晓趣事关联，再讲规则。[[mixed]]「${eventBefore}」\n[[mixed]]「${eventAfter}」`;
    await completePreparedAccountStyle(context, { text: style, model: "fixture", ok: true, fallback: false });
    assert.equal((await readStyle(account.platform, account.id)).trim(), style);
    const commentary = { ...evidence, purposes: ["评论事件"], narrative: { forms: ["吃瓜"], beats: [{ purpose: "解释事件", quote }], bridges: [] } };
    assert.equal(parseStyleEvidence(JSON.stringify(commentary), quote, "纯评论").narrative?.bridges.length, 0);
  });
});

test("真实准备链路读取低热度全文、复用分析；快照经过保存API与续改仍保持原风格", async () => {
  await fixture(async ({ account, requests, setReply, root }) => {
    const samples = [
      { id: "hot", title: "争议周报", transcript: "本周争议发生反转，这类说法必须先核实。", views: 100000 },
      { id: "event", title: "低热度活动", transcript: quote, views: 10 }
    ];
    for (const sample of samples) {
      await saveVideos(account, [video(account, sample.id, sample.title, sample.views)]);
      await saveTranscript({ platform: account.platform, accountId: account.id, videoId: sample.id, text: sample.transcript, source: "manual" });
    }
    setReply(messages => {
      if (messages[0].includes("完整阅读这一篇")) {
        const source = samples.find(s => messages[1].includes(s.transcript))!;
        return JSON.stringify({ ...evidence, genre: source.id === "hot" ? "争议周报" : evidence.genre,
          narrative: { forms: ["事件讲述"], beats: [{ purpose: "解释事件", quote: source.transcript }], bridges: [] },
          moves: [{ ...evidence.moves[0], quote: source.transcript }] });
      }
      return JSON.stringify(plan(`douyin:${account.id}:event`));
    });
    const input = { platform: account.platform, accountId: account.id, mode: "rewrite" as const, prompt: inputText, sourceText: inputText };
    const prepared = await prepareWriteCopyContext(input);
    assert.equal(requests.length, 0);
    assert.ok(prepared.messages[1].content.includes(quote));
    assert.ok(prepared.draftBase?.styleRefs?.[0].targetType === "account" && prepared.draftBase.styleRefs[0].videoIds?.includes("event"), "低热度原文仍能进入参考");
    await prepareWriteCopyContext(input);
    assert.equal(requests.length, 0, "重复写作准备也不调用模型");
    const shortResult = await completePreparedWriteCopy({ prepared, save: false, result: { text: "联名", model: "test", ok: true, fallback: false } });
    assert.match(shortResult.research || "", /成稿检查（需修改）/);
    assert.equal(shortResult.content, "联名", "检查不篡改或隐藏原始输出");
    const result = await completePreparedWriteCopy({ prepared, save: true, result: { text: "活动联动可试驾", model: "test", ok: true, fallback: false } });
    assert.ok(result.draft?.writerContext);
    const before = result.draft.writerContext;
    const response = await saveDraftRoute(new Request("http://localhost/api/drafts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...prepared.draftBase, content: "手动编辑的活动稿" }) }));
    assert.equal(response.status, 200);
    const manual = await response.json() as Draft;
    assert.deepEqual((await resolveDraft(manual.id)).draft.writerContext, before);
    assert.ok((await getDraftSummaries()).every(d => !("writerContext" in d)));
    await saveStyle(account.platform, account.id, "新风格：严肃技术报告");
    const revised = await prepareWriteCopyContext({ ...input, action: "revise", parentDraftId: manual.id, currentContent: manual.content,
      revisionInstruction: "换个切入点", revisionMode: "recalibrate" });
    assert.equal(requests.length, 0, "续改不重新调用模型选样、抓资料或重学");
    assert.match(revised.messages[1].content, /旧风格：现场乐子/);
    assert.doesNotMatch(revised.messages[1].content, /严肃技术报告/);
    assert.match(revised.messages[0].content, /重新校准/);
    assert.deepEqual(revised.draftBase?.writerContext, before);
    assert.ok((await fs.readdir(path.join(root, "douyin", account.slug, ".style-history"))).length > 0);
    const invalid = { ...manual, writerContext: { ...before, samples: "损坏" } };
    assert.throws(() => parseStoredRecord("draft", invalid, "draft"), /结构无效/);
  });
});

test("学习失败不覆盖旧卡；旧稿无快照时明确记录兼容行为", async () => {
  await fixture(async ({ account, setReply, requests }) => {
    await saveVideos(account, [video(account, "event", "活动", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    setReply(() => JSON.stringify(evidence));
    const context = await prepareAccountStyleContext(account.platform, account.id);
    await assert.rejects(() => completePreparedAccountStyle(context, { text: "错误模板", model: "bad", ok: false, fallback: true }), /原卡已保留/);
    assert.equal(await readStyle(account.platform, account.id), "旧风格：现场乐子\n");
    const draft = await saveDraft({ platform: account.platform, accountId: account.id, accountName: account.name,
      title: "旧稿", mode: "topic", prompt: "活动", content: "旧版正文", styleRef: { platform: account.platform, accountId: account.id, accountName: account.name } });
    const count = requests.length;
    const prepared = await prepareWriteCopyContext({ action: "revise", mode: "topic", prompt: "活动", parentDraftId: draft.id,
      currentContent: draft.content, revisionInstruction: "微调结尾" });
    assert.equal(requests.length, count);
    assert.match(prepared.research || "", /旧稿未保存原始风格快照/);
    assert.equal(prepared.draftBase?.writerContext?.compatibility, "legacy-current-style");
    await saveStyle(account.platform, account.id, "用户并发编辑的新卡");
    await assert.rejects(() => completePreparedAccountStyle(context, { text: `## 新卡\n[[event]]「${quote}」`, model: "fixture", ok: true, fallback: false }), /生成期间已被修改/);
    assert.equal((await readStyle(account.platform, account.id)).trim(), "用户并发编辑的新卡");
  });
});

test("多风格准备失败单独返回，不阻断其他风格；取消后不新增模型请求", async () => {
  await fixture(async ({ account, requests }) => {
    const batch = await prepareWriteCopyBatchContext({ mode: "topic", prompt: "活动",
      styleRefs: [{ targetType: "account", platform: account.platform, accountId: "douyin:missing" },
        { targetType: "account", platform: account.platform, accountId: account.id }] });
    assert.equal(batch.variants.length, 1);
    assert.equal(batch.preparationFailures?.length, 1);
    assert.equal(batch.variants[0].prepared.draftBase?.styleRefs?.[0].targetType === "account" && batch.variants[0].prepared.draftBase.styleRefs[0].accountId, account.id);
    const result = resolveWriteBatchOutcome(batch, [{ result: { content: "可用稿", usedModel: "fixture", fallback: false,
      styleKey: batch.variants[0].styleKey, styleTitle: account.name, styleReference: batch.variants[0].styleReference } }]);
    assert.ok("kind" in result && result.failures.length === 1);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => prepareWriteCopyContext({ mode: "topic", prompt: "活动", platform: account.platform, accountId: account.id }, { signal: controller.signal }));
    assert.equal(requests.length, 0);
  });
});

test("归纳成功后缓存可复用，强制归纳只重做卡片，模型改变会使学习缓存失效", async () => {
  await fixture(async ({ account, setReply, requests }) => {
    await saveVideos(account, [video(account, "event", "活动", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    setReply(() => JSON.stringify(evidence));
    const context = await prepareAccountStyleContext(account.platform, account.id);
    await completePreparedAccountStyle(context, { text: `## 活动场景\n具体现场引入，单篇证据有限。[[event]]「${quote}」`, model: "fixture", ok: true, fallback: false });
    const cached = await prepareAccountStyleContext(account.platform, account.id);
    assert.ok(cached.cachedStyle);
    const forced = await prepareAccountStyleContext(account.platform, account.id, { force: true });
    assert.equal(forced.cachedStyle, undefined);
    assert.equal(forced.analysisStats.analysisCachedCount, 1);
    assert.equal(requests.length, 1);
    process.env.CHAT_MODEL = "fixture-next";
    const changed = await prepareAccountStyleContext(account.platform, account.id);
    assert.equal(changed.cachedStyle, undefined);
    assert.equal(requests.length, 2);
  });
});

test("偏好接口仅修改当前稿件风格、可撤销，旧稿快照保持不变", async () => {
  await fixture(async ({ account }) => {
    const prepared = await prepareWriteCopyContext({ platform: account.platform, accountId: account.id, mode: "rewrite", prompt: "写一段", sourceText: "素材" });
    const result = await completePreparedWriteCopy({ prepared, save: true, result: { text: "测试正文", model: "fixture", ok: true, fallback: false } });
    const draft = result.draft!;
    const before = await readStyle(account.platform, account.id);
    const send = (body: object) => preferenceRoute(new Request("http://local/api/write/preference", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const saved = await send({ action: "remember", draftId: draft.id, text: "先讲具体事件" });
    assert.equal(saved.status, 200);
    const { preferenceId } = await saved.json();
    assert.match(await readStyle(account.platform, account.id), /先讲具体事件/);
    assert.deepEqual((await resolveDraft(draft.id)).draft.writerContext, draft.writerContext);
    const next = await prepareWriteCopyContext({ platform: account.platform, accountId: account.id, mode: "rewrite", prompt: "再写", sourceText: "素材" });
    assert.match(next.messages[1].content, /先讲具体事件/);
    const undone = await send({ action: "undo", draftId: draft.id, preferenceId });
    assert.equal(undone.status, 200);
    assert.equal((await readStyle(account.platform, account.id)).trim(), before.trim());
    assert.equal((await send({ action: "undo", draftId: draft.id, preferenceId })).status, 409);
    assert.equal((await send({ action: "remember", draftId: draft.id, text: "" })).status, 400);
  });
});

function video(account: Account, id: string, title: string, views: number): Video {
  return { id, title, platform: account.platform, accountId: account.id, url: `https://www.douyin.com/video/${id}`,
    stats: { views, likes: 0, comments: 0, favorites: 0 }, hotScore: views, relativeViewRate: 1,
    transcriptStatus: "not_started", updatedAt: new Date().toISOString() };
}

async function fixture(run: (context: { account: Account; root: string; requests: string[][]; setReply: (fn: (messages: string[]) => string) => void }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "writer-context-test-"));
  const original = { ...process.env };
  const requests: string[][] = [];
  let respond: (messages: string[]) => string = () => "{}";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const messages = JSON.parse(body).messages.map((m: { content: string }) => m.content);
    requests.push(messages);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: respond(messages) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|FHL_|WEB_RESEARCH_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, CHAT_API_KEY: "test-key", CHAT_BASE_URL: `http://127.0.0.1:${address.port}`,
    CHAT_MODEL: "fixture", CHAT_WIRE_API: "chat_completions", CHAT_FALLBACK_ENABLED: "0" });
  try {
    const account = await upsertAccount({ platform: "douyin", name: "测试风格", uid: "writer-fixture" });
    await saveStyle(account.platform, account.id, "旧风格：现场乐子");
    await run({ account, root, requests, setReply(fn) { respond = fn; } });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    await fs.rm(root, { recursive: true, force: true });
  }
}
