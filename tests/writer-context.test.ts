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
import { prepareWriteCopyContext, prepareWriteCopyBatchContext, resolveWriteBatchOutcome, completePreparedWriteCopy, prepareAccountStyleContext, completePreparedAccountStyle, prepareProjectStyleContext, completePreparedProjectStyle } from "../src/lib/ai";
import { upsertAccount, saveStyle, readStyle, saveVideos, saveTranscript, saveDraft, resolveDraft, getDraftSummaries, readAccountStyleMeta, saveAccountStyleMeta, readAccountStyleSampleAnalysis, saveAccountStyleSampleAnalysis, upsertProject, saveCopySource, saveProjectStyle, readProjectStyle, readProjectStyleMeta, saveProjectStyleMeta } from "../src/lib/storage";
import { addWriterPreference } from "../src/lib/writer-preference";
import { POST as preferenceRoute } from "../src/app/api/write/preference/route";
import { POST as saveDraftRoute } from "../src/app/api/drafts/route";
import type { Account, Video, Draft } from "../src/lib/types";
import { streamStyleResponseTextWithFallback } from "../src/lib/ai";

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
const styleCard = (sourceId = "event", excerpt = quote) => `# 活动风格卡
## 风格概览
用现场内容引入。
## 跨样本表达倾向
本轮不足以确认
## 场景写法与单篇观察
### C01｜现场承接介绍
支持范围：单篇支持。
触发条件：有真实现场素材与活动关联。
表达动作：从现象引出活动，再解释规则。
停止与例外：解释清楚后停止，没有现场时换切入。
原文证据：[[${sourceId}]]「${excerpt}」
## 使用边界与证据范围
单篇支持，不代表全部作品。`;
const plan = (id = "event"): WriterPlan => ({ task, selected: [{ id, reason: "活动用途相符，借鉴现场切入" }], applicableStyle: ["先讲具体活动，再解释规则"], notes: [] });

test("风格引句与任务事实必须来自各自原文，跨账号ID不能混入", () => {
  assert.deepEqual(parseStyleEvidence(JSON.stringify(evidence), quote, "样本"), evidence);
  assert.throws(() => parseStyleEvidence(JSON.stringify(evidence), "另一篇原文", "样本"), /原文定位/);
  assert.throws(() => validateWriterPlan(plan("other-account"), [candidate], inputText), /不属于本风格/);
  assert.throws(() => validateWriterPlan({ ...plan(), task: { ...task, facts: [{ text: "销量高", quote: "旧案例销量高" }] } }, [candidate], inputText), /引句/);
  assert.throws(() => validateWriterPlan({ ...plan(), selected: [plan().selected[0], plan().selected[0]] }, [candidate], inputText), /重复/);
  assert.equal(validateWriterPlan(plan(), [candidate], inputText).selected.length, 1);
  validateStyleCardCitations("以自然叙述推进，评价融入细节。", [{ sourceId: "event", quote }]);
  assert.throws(() => validateStyleCardCitations(`[[other]]「${quote}」`, [{ sourceId: "event", quote }]), /引用/);
  validateStyleCardCitations(`[[event]]「${quote}」`, [{ sourceId: "event", quote }]);
});

test("风格卡允许同一证据的连续摘录，但拒绝改字、拼接或错误来源", () => {
  const excerpt = "最后实在受不了了，趁板上出门采购，翻出电话报警，才被解救了出来。";
  const next = "可就在板上被警察摁倒前，还在叮嘱两姐妹，一定要好好学习啊，等我出来就聘用你们当员工。";
  const ending = "果然资本家的 play 没人顶得住啊！";
  const quotes = [{ sourceId: "7518313891584380217", quote: `${excerpt}\n${next}\n${ending}` }];
  const citation = (value: string) => `[[7518313891584380217]]「${value}」`;
  validateStyleCardCitations(citation(excerpt), quotes);
  validateStyleCardCitations(citation(`${next}\n${ending}`), quotes);
  for (const invalid of [excerpt.replace("电话", "手机"), `${excerpt}\n${ending}`, `${excerpt}${next}`]) {
    assert.throws(() => validateStyleCardCitations(citation(invalid), quotes), /引用/);
  }
  assert.throws(() => validateStyleCardCitations(`[[other]]「${excerpt}」`, quotes), /引用/);
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
    setReply(() => JSON.stringify(mixedEventEvidence));
    const prepared = await prepareWriteCopyContext({ platform: account.platform, accountId: account.id, mode: "rewrite", prompt: inputText, sourceText: inputText });
    assert.equal(requests.length, 0, "直接写作准备不调用模型");
    assert.ok(prepared.messages[1].content.includes(mixedEventText), "成稿阶段仍有完整原文上下文");
    assert.equal(prepared.draftBase?.writerContext?.samples[0].id, `douyin:${account.id}:mixed`);
    assert.deepEqual(prepared.draftBase?.writerContext?.plan?.task.facts, [], "范文旧活动不变成本次事实");
    const context = await prepareAccountStyleContext(account.platform, account.id);
    const style = styleCard("mixed", eventBefore).replace("## 使用边界", `[[mixed]]「${eventAfter}」\n## 使用边界`);
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
    await assert.rejects(() => completePreparedAccountStyle(context, {
      text: "[[event]]「改写了原文的证据」", model: "fixture", ok: true, fallback: false
    }), /原卡已保留/);
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
    await assert.rejects(() => completePreparedAccountStyle(context, { text: styleCard(), model: "fixture", ok: true, fallback: false }), /生成期间已被修改/);
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
    await completePreparedAccountStyle(context, { text: styleCard(), model: "fixture", ok: true, fallback: false });
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
    const { preferenceId } = await saved.json() as { preferenceId: string };
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

test("归纳不输入旧卡规则；卡片缓存失效复用分析，旧分析缓存失效重新学习且保留偏好", async () => {
  await fixture(async ({ account, setReply, requests }) => {
    const previous = addWriterPreference("旧卡公式：每段都要硬加吐槽。", "abc-123", "不要重复解释结尾");
    await saveStyle(account.platform, account.id, previous);
    await saveVideos(account, [video(account, "event", "活动", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    setReply(() => JSON.stringify(evidence));
    const context = await prepareAccountStyleContext(account.platform, account.id);
    assert.ok(context.messages.every(message => !message.content.includes("每段都要硬加吐槽") && !message.content.includes("不要重复解释结尾")));
    const valid = "# 表达特点\n先交代现场，再顺着事情表达看法。";
    const invalid = "[[不存在的来源]]「伪造引用」";
    await assert.rejects(() => completePreparedAccountStyle(context, { text: invalid, model: "fixture", ok: true, fallback: false }), /引用/);
    assert.equal((await readStyle(account.platform, account.id)).trim(), previous);
    assert.equal(await readAccountStyleMeta(account.platform, account.id), null);
    await completePreparedAccountStyle(context, { text: valid, model: "fixture", ok: true, fallback: false });
    assert.match(await readStyle(account.platform, account.id), /不要重复解释结尾/);
    const meta = (await readAccountStyleMeta(account.platform, account.id))!;
    await saveAccountStyleMeta(account.platform, account.id, { ...meta, sampleHash: "previous-card-version" });
    const cardChanged = await prepareAccountStyleContext(account.platform, account.id);
    assert.equal(cardChanged.cachedStyle, undefined);
    assert.equal(cardChanged.analysisStats.analysisCachedCount, 1);
    assert.equal(requests.length, 1, "仅最终卡失效时无需重新分析");
    const cache = (await readAccountStyleSampleAnalysis(account.platform, account.id, "event"))!;
    await saveAccountStyleSampleAnalysis(account.platform, account.id, "event", { ...cache, cacheKey: "previous-analysis-version" });
    const analysisChanged = await prepareAccountStyleContext(account.platform, account.id);
    assert.equal(analysisChanged.analysisStats.analysisGeneratedCount, 1);
    assert.equal(requests.length, 2);
    assert.match(await readStyle(account.platform, account.id), /不要重复解释结尾/);
  });
});

test("项目归纳隔离账号与素材来源，复用分析、保留偏好与作品指纹并拒绝并发覆盖", async () => {
  await fixture(async ({ account, setReply, requests }) => {
    const other = await upsertAccount({ platform: "douyin", name: "另一个风格", uid: "other-fixture" });
    const otherQuote = "先把过程交代清楚，然后解释大家关心的原因。";
    for (const [owner, transcript] of [[account, quote], [other, otherQuote]] as const) {
      await saveVideos(owner, [video(owner, "event", "同名来源", 1)]);
      await saveTranscript({ platform: owner.platform, accountId: owner.id, videoId: "event", text: transcript, source: "manual" });
      await saveStyle(owner.platform, owner.id, "旧卡专有规则：每段必须反转");
    }
    const material = await saveCopySource({ title: "同文转载", platform: "douyin", url: "https://example.test/material", transcript: quote, source: "manual" });
    const project = await upsertProject({ name: "风格测试项目", sourceAccountIds: [account.id, other.id], sourceMaterialIds: [material.id] });
    await saveProjectStyle(project.id, addWriterPreference("旧项目风格", "def-456", "保留自然过渡"));
    setReply(messages => {
      const excerpt = messages[1].includes(otherQuote) ? otherQuote : quote;
      return JSON.stringify({ ...evidence, narrative: { forms: ["叙事"], beats: [{ purpose: "交代原因", quote: excerpt }], bridges: [] }, moves: [{ ...evidence.moves[0], quote: excerpt }] });
    });
    const context = await prepareProjectStyleContext(project.id);
    assert.equal(requests.length, 3);
    const ids = [...new Set(context.evidenceQuotes!.map(item => item.sourceId))];
    assert.equal(ids.length, 3, "同名视频与独立素材必须有唯一引用 ID");
    for (const id of ids) assert.ok(context.messages[1].content.includes(`来源:${id}`));
    assert.doesNotMatch(context.messages[1].content, /旧卡专有规则|保留自然过渡/);
    const accountId = `account:${account.id}:event`;
    const materialId = `material:${material.id}`;
    assert.equal(context.evidenceQuotes!.find(item => item.sourceId === accountId)?.workHash, context.evidenceQuotes!.find(item => item.sourceId === materialId)?.workHash);
    await assert.rejects(() => completePreparedProjectStyle(context, { text: styleCard("event"), model: "fixture", ok: true, fallback: false }), /引用/);
    const valid = styleCard(accountId);
    assert.match(await readProjectStyle(project.id), /旧项目风格/);
    await completePreparedProjectStyle(context, { text: valid, model: "fixture", ok: true, fallback: false });
    assert.match(await readProjectStyle(project.id), /保留自然过渡/);
    await saveStyle(account.platform, account.id, "修改账号卡不改变项目原文证据");
    assert.ok((await prepareProjectStyleContext(project.id)).cachedStyle);
    const meta = (await readProjectStyleMeta(project.id))!;
    await saveProjectStyleMeta(project.id, { ...meta, sampleHash: "previous-card-version" });
    const next = await prepareProjectStyleContext(project.id);
    assert.equal(next.analysisStats.analysisCachedCount, 3);
    assert.equal(requests.length, 3);
    await saveProjectStyle(project.id, "用户正在编辑项目卡");
    await assert.rejects(() => completePreparedProjectStyle(next, { text: valid, model: "fixture", ok: true, fallback: false }), /生成期间已被修改/);
    assert.equal((await readProjectStyle(project.id)).trim(), "用户正在编辑项目卡");
  });
});

test("样本引句校验失败自动纠正一次，成功后复用缓存", async () => {
  await fixture(async ({ account, requests, setReply }) => {
    await saveVideos(account, [video(account, "event", "活动", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    setReply(messages => JSON.stringify(messages.length > 2 ? evidence : {
      ...evidence, moves: [{ ...evidence.moves[0], quote: "模型改写的句子" }]
    }));
    await prepareAccountStyleContext(account.platform, account.id);
    assert.equal(requests.length, 2);
    assert.match(requests[1].at(-1)!, /无法在原文定位/);
    await prepareAccountStyleContext(account.platform, account.id);
    assert.equal(requests.length, 2, "成功纠正的分析可以复用");
  });
});

test("样本连续校验失败停止重试且保留原卡", async () => {
  await fixture(async ({ account, requests, setReply }) => {
    await saveVideos(account, [video(account, "event", "活动", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    setReply(() => "无效JSON");
    await assert.rejects(() => prepareAccountStyleContext(account.platform, account.id), /自动纠正一次仍未通过/);
    assert.equal(requests.length, 2);
    assert.equal((await readStyle(account.platform, account.id)).trim(), "旧风格：现场乐子");
  });
});

function video(account: Account, id: string, title: string, views: number): Video {
  return { id, title, platform: account.platform, accountId: account.id, url: `https://www.douyin.com/video/${id}`,
    stats: { views, likes: 0, comments: 0, favorites: 0 }, hotScore: views, relativeViewRate: 1,
    transcriptStatus: "not_started", updatedAt: new Date().toISOString() };
}

type ModelReply = string | { status: number; body: string; contentType?: string } | { disconnect: true };
async function fixture(run: (context: { account: Account; root: string; requests: string[][]; requestBodies: Record<string, unknown>[]; setReply: (fn: (messages: string[]) => ModelReply) => void }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "writer-context-test-"));
  const original = { ...process.env };
  const requests: string[][] = [];
  const requestBodies: Record<string, unknown>[] = [];
  let respond: (messages: string[]) => ModelReply = () => "{}";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requestBodies.push(payload);
    const messages = payload.messages.map((m: { content: string }) => m.content);
    requests.push(messages);
    const reply = respond(messages);
    if (typeof reply !== "string") {
      if ("disconnect" in reply) req.socket.destroy();
      else { res.writeHead(reply.status, { "Content-Type": reply.contentType || "application/json" }); res.end(reply.body); }
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  for (const key of Object.keys(process.env)) if (/^(CHAT_|OPENAI_|FHL_|WEB_RESEARCH_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, CHAT_API_KEY: "test-key", CHAT_BASE_URL: `http://127.0.0.1:${address.port}`,
    CHAT_MODEL: "fixture", CHAT_WIRE_API: "chat_completions", CHAT_FALLBACK_ENABLED: "0" });
  try {
    const account = await upsertAccount({ platform: "douyin", name: "测试风格", uid: "writer-fixture" });
    await saveStyle(account.platform, account.id, "旧风格：现场乐子");
    await run({ account, root, requests, requestBodies, setReply(fn) { respond = fn; } });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("样本连接中断自动重试一次，恢复后缓存并复用分析", async () => {
  await fixture(async ({ account, requests, setReply }) => {
    await saveVideos(account, [video(account, "event", "活动", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    setReply(() => requests.length === 1 ? { disconnect: true } : JSON.stringify(evidence));
    const progress: Array<{ completedCount: number; message?: string }> = [];
    await prepareAccountStyleContext(account.platform, account.id, { onAnalysisProgress: p => progress.push(p) });
    assert.equal(requests.length, 2);
    assert.match(progress[0].message!, /活动.*自动重试 1\/1/);
    assert.equal(progress[0].completedCount, 0, "重试不虚增已完成数量");
    assert.equal(progress.at(-1)?.completedCount, 1);
    const next = await prepareAccountStyleContext(account.platform, account.id);
    assert.equal(next.analysisStats.analysisCachedCount, 1);
    assert.equal(requests.length, 2);
    assert.equal(await readStyle(account.platform, account.id), "旧风格：现场乐子\n");
  });
});

test("持续连接故障有重试上限，标明样本并保留原卡和已完成缓存", async () => {
  await fixture(async ({ account, requests, setReply }) => {
    await saveVideos(account, [video(account, "saved", "已完成", 2)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "saved", text: quote, source: "manual" });
    setReply(() => JSON.stringify(evidence));
    await prepareAccountStyleContext(account.platform, account.id);
    await saveVideos(account, [video(account, "event", "故障样本", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    setReply(() => ({ disconnect: true }));
    await assert.rejects(() => prepareAccountStyleContext(account.platform, account.id), /故障样本.*连接异常.*UND_ERR_SOCKET.*已缓存.*原卡已保留/);
    assert.equal(requests.length, 3, "仅新增样本请求两次");
    assert.ok(await readAccountStyleSampleAnalysis(account.platform, account.id, "saved"));
    assert.equal(await readAccountStyleSampleAnalysis(account.platform, account.id, "event"), null);
    assert.equal(await readStyle(account.platform, account.id), "旧风格：现场乐子\n");
  });
});

test("鉴权和额度不足不自动重试，临时限流及服务异常会重试", async () => {
  await fixture(async ({ account, requests, setReply }) => {
    await saveVideos(account, [video(account, "event", "活动", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    for (const [status, body, count, message] of [
      [401, "unauthorized", 1, /鉴权异常/],
      [429, "insufficient_quota", 1, /额度不足/],
      [429, "rate limit", 2, /限流/],
      [503, "service unavailable", 2, /服务暂时异常/]
    ] as const) {
      const before = requests.length;
      setReply(() => ({ status, body }));
      await assert.rejects(() => prepareAccountStyleContext(account.platform, account.id), message);
      assert.equal(requests.length - before, count);
    }
  });
});

test("等待自动重试时取消任务，不会继续发请求或写分析缓存", async () => {
  await fixture(async ({ account, requests, setReply }) => {
    await saveVideos(account, [video(account, "event", "活动", 1)]);
    await saveTranscript({ platform: account.platform, accountId: account.id, videoId: "event", text: quote, source: "manual" });
    setReply(() => ({ status: 503, body: "service unavailable" }));
    const controller = new AbortController();
    await assert.rejects(() => prepareAccountStyleContext(account.platform, account.id, {
      signal: controller.signal,
      onAnalysisProgress: p => { if (p.message) setTimeout(() => controller.abort(), 10); }
    }), { name: "AbortError" });
    assert.equal(requests.length, 1);
    assert.equal(await readAccountStyleSampleAnalysis(account.platform, account.id, "event"), null);
  });
});

test("风格卡流式调用及无输出补偿不再注入固定输出预算", async () => {
  await fixture(async ({ requests, requestBodies, setReply }) => {
    setReply(() => requests.length === 1 ? { status: 503, body: "service unavailable" } : styleCard());
    const result = await streamStyleResponseTextWithFallback({ messages: [{ role: "user", content: "归纳风格" }], onDelta() {} });
    assert.equal(result.ok, true);
    assert.equal(result.text, styleCard());
    assert.equal(requests.length, 2);
    assert.equal(requestBodies[0].stream, true);
    assert.equal(requestBodies[1].stream, false);
    for (const payload of requestBodies) assert.equal(payload.max_tokens, undefined);
  });
});


test("逐篇分析允许超过旧条数和字符上限，仍核验原文", () => {
  const longQuote = "连续原文".repeat(180);
  const transcript = Array.from({ length: 10 }, (_, i) => `段落${i}：${longQuote}`).join("\n");
  const beats = Array.from({ length: 10 }, (_, i) => ({ purpose: "承接上一段".repeat(60), quote: `段落${i}：${longQuote}` }));
  const expanded = { genre: "文体".repeat(100), purposes: Array(9).fill("表达目的".repeat(40)),
    unsuitable: Array(9).fill("场景限制".repeat(50)), structure: "全文结构".repeat(250),
    narrative: { forms: Array(8).fill("讲述方式".repeat(40)), beats,
      bridges: beats.slice(0, 5).map((beat, i) => ({ before: beat.quote, after: beats[i + 1].quote, action: "自然承接".repeat(150), requires: "相关信息".repeat(150) })) },
    moves: Array.from({ length: 12 }, () => ({ quote: longQuote, action: "表达动作".repeat(150), when: "适用场景".repeat(100), avoid: "避免误用".repeat(100) })),
    limitations: Array(9).fill("材料缺口".repeat(60)) };
  assert.equal(parseStyleEvidence(JSON.stringify(expanded), transcript, "长文").moves.length, 12);
  assert.throws(() => parseStyleEvidence(JSON.stringify(expanded), "无相关原文", "长文"), /原文定位/);
});


test("续改完整传入超过七万字符的当前稿件", async () => {
  await fixture(async ({ account }) => {
    const draft = await saveDraft({ platform: account.platform, accountId: account.id, mode: "topic", prompt: "测试", title: "长稿检查", accountName: account.name, content: "旧稿", styleRef: { platform: account.platform, accountId: account.id, accountName: account.name } });
    const content = "完整原文".repeat(18000) + "结尾必须保留";
    const prepared = await prepareWriteCopyContext({ action: "revise", mode: "topic", prompt: "测试", parentDraftId: draft.id,
      currentContent: content, revisionInstruction: "只修改开头" });
    assert.ok(prepared.messages[1].content.includes(content));
  });
});

test("模型报告输出长度截断时，流式和普通响应都不能作为成功风格卡", async () => {
  for (const streaming of [false, true]) await fixture(async ({ setReply }) => {
    setReply(() => ({ status: 200, contentType: streaming ? "text/event-stream" : "application/json", body: streaming
      ? 'data: {"choices":[{"delta":{"content":"未完成正文"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
      : JSON.stringify({ choices: [{ message: { content: "未完成正文" }, finish_reason: "length" }] }) }));
    const result = await streamStyleResponseTextWithFallback({ messages: [{ role: "user", content: "生成" }], onDelta() {} });
    assert.equal(result.ok, false);
    assert.equal(result.fallback, true);
  });
});
