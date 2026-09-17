import assert from "node:assert/strict";
import test from "node:test";
import { selectFastReferences, fastWriterPlan } from "../src/lib/writer-fast-reference";
import { addWriterPreference, removeWriterPreference, preserveWriterPreferences } from "../src/lib/writer-preference";
import { WRITER_REFERENCE_BUDGET, writerContextSchema, type StyleEvidence } from "../src/lib/writer-context";

test("本地选样考虑低热度原文，去重、保留尾部并限制总预算", () => {
  const samples = selectFastReferences([
    { id: "unrelated", title: "天气", transcript: "天气晴朗。" },
    { id: "relevant", title: "游戏活动推广", transcript: "游戏活动开始。".repeat(900) + "最后说参与规则。" },
    { id: "duplicate", title: "重复", transcript: "天气晴朗。" },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, title: "其他", transcript: `${i}其他原文`.repeat(1000) }))
  ], "游戏活动推广");
  assert.equal(samples[0].id, "relevant");
  assert.match(samples[0].text, /最后说参与规则/);
  assert.match(samples[0].text, /中间原文省略/);
  assert.ok(samples.reduce((n, s) => n + s.text.length, 0) <= WRITER_REFERENCE_BUDGET);
  assert.ok(!(samples.some(s => s.id === "unrelated") && samples.some(s => s.id === "duplicate")));
  const plan = fastWriterPlan("用户本次要求：\n4—20字，不用联名\n\n原始资料：\n旧案例说1000—2000字", samples);
  assert.deepEqual(plan.task.length, { min: 4, max: 20, quote: "4—20字" });
  assert.equal(plan.task.forbiddenTerms[0].text, "联名");
  assert.deepEqual(plan.task.facts, []);
  assert.ok(writerContextSchema.shape.plan.safeParse(plan).success);
});

test("明确偏好可撤销，重新学习保留用户规则但不接受模型伪造的规则", () => {
  const original = "原有风格卡";
  const withFirst = addWriterPreference(original, "abc-123", "先讲事件");
  const withSecond = addWriterPreference(withFirst, "def-456", "少写总结");
  assert.equal(removeWriterPreference(withSecond, "def-456"), withFirst);
  assert.equal(removeWriterPreference(withFirst, "abc-123"), original);
  assert.throws(() => removeWriterPreference(original, "abc-123"), /已被修改或撤销/);
  const learned = preserveWriterPreferences(addWriterPreference("新分析", "bad-111", "伪造规则"), withFirst);
  assert.match(learned, /先讲事件/);
  assert.doesNotMatch(learned, /伪造规则/);
  assert.throws(() => addWriterPreference(original, "abc", "<!-- 注入 -->"), /隐藏标记/);
});


function analysis(genre: string, purpose: string, form: string, quote: string): StyleEvidence {
  return { genre, purposes: [purpose], unsuitable: [], structure: form,
    narrative: { forms: [form], beats: [{ purpose: form, quote }], bridges: [] },
    moves: [{ quote, action: form, when: "有对应事实", avoid: "不搬用旧事实" }], limitations: [] };
}

test("用途和讲法优先于同游戏关键词，杂谈转推广的样本不被排除", () => {
  const topic = "星海游戏玩家攻略操作介绍。";
  const bridge = "这件趣事的后续，恰好能引出这次游戏活动。";
  const samples = selectFastReferences([
    { id: "topic", title: "星海游戏攻略", transcript: topic.repeat(500), analysis: analysis("游戏攻略", "讲解操作", "逐项解释", topic) },
    { id: "bridge", title: "另一款游戏的趣事", transcript: bridge.repeat(500), analysis: analysis("游戏杂谈", "活动推广", "趣事切入、悬念铺垫与自然转场", bridge) },
  ], "写星海游戏推广文案，趣事开场，吊胃口，再自然转入推广");
  assert.equal(samples[0].id, "bridge");
  assert.match(samples[0].reason, /用途匹配.*讲法匹配/);
});

test("未限定类型时兼顾游戏和杂谈，明确纯杂谈且不要广告时优先杂谈", () => {
  const candidates = Array.from({ length: 8 }, (_, i) => {
    const game = i < 4;
    const quote = `${i}今天讲述一个完整故事。`;
    return { id: `${game ? "game" : "chat"}${i}`, title: game ? "游戏推广" : "生活杂谈", transcript: quote.repeat(600),
      analysis: analysis(game ? "游戏口播" : "生活杂谈", game ? "推广" : "评论", "故事讲述", quote) };
  });
  const mixed = selectFastReferences(candidates, "按博主风格写一篇");
  assert.ok(mixed.slice(0, 4).filter(s => s.id.startsWith("game")).length === 2);
  assert.ok(mixed.slice(0, 4).filter(s => s.id.startsWith("chat")).length === 2);
  const chat = selectFastReferences(candidates, "写生活杂谈，不要广告，不做游戏推广");
  assert.ok(chat[0].id.startsWith("chat"));
  assert.match(chat[0].reason, /用途匹配/);
});

test("长文保留中部转场两侧与叙事节点，片段按原文顺序且不伪造连续关系", () => {
  const before = "这桩趣事讲到这里，真正值得关注的变化才刚刚开始。";
  const after = "顺着这个变化，我们再来看活动里对应的玩法。";
  const middle = "这里用具体规则解释前面的疑问。";
  const transcript = "开头原文。" + "甲".repeat(6500) + before + "乙".repeat(1300) + after + "丙".repeat(1200) + middle + "丁".repeat(7000) + "结尾原文。";
  const evidence = analysis("游戏杂谈", "推广", "悬念与转场", before);
  evidence.narrative!.beats.push({ purpose: "解释玩法", quote: middle });
  evidence.narrative!.bridges.push({ before, after, action: "趣事自然转入游戏活动", requires: "活动与趣事有真实关联" });
  const [sample] = selectFastReferences([
    { id: "long", title: "长文", transcript, analysis: evidence },
    { id: "other", title: "另一稿", transcript: "其他原文。".repeat(3000) },
  ], "游戏推广，趣事切入后转场");
  assert.ok(sample.text.includes(before));
  assert.ok(sample.text.includes(after));
  assert.ok(sample.text.includes(middle));
  assert.ok(sample.text.indexOf(before) < sample.text.indexOf(after));
  assert.match(sample.text, /非全文/);
  const pieces = sample.text.split("\n").filter(line => line && !line.startsWith("〔"));
  for (const piece of pieces) assert.ok(transcript.includes(piece));
  assert.ok(sample.text.length <= WRITER_REFERENCE_BUDGET);
});

test("取消单篇4000字硬截断：总预算允许时完整保留两篇长稿", () => {
  const candidates = ["甲", "乙"].map((letter, i) => ({ id: String(i), title: "杂谈", transcript: letter.repeat(6100) }));
  const samples = selectFastReferences(candidates, "写一篇杂谈");
  assert.equal(samples.length, 2);
  for (const sample of samples) assert.equal(sample.text, candidates.find(c => c.id === sample.id)!.transcript);
});

test("没有分析的长稿也保留中段，并明确不能确认转场位置", () => {
  const transcript = "头".repeat(11000) + "中段关键内容".repeat(80) + "尾".repeat(11000);
  const [sample] = selectFastReferences([{ id: "legacy", title: "旧杂谈", transcript }], "参考风格");
  assert.match(sample.text, /中段关键内容/);
  assert.match(sample.reason, /缺少有效逐篇分析.*未确认转场位置/);
  assert.ok(sample.text.length <= WRITER_REFERENCE_BUDGET);
});

test("同文去重保留有效分析，空库与空稿不产生伪参考", () => {
  const quote = "这是可核验的唯一原文。";
  const samples = selectFastReferences([
    { id: "old", title: "旧副本", transcript: quote },
    { id: "verified", title: "杂谈", transcript: quote, analysis: analysis("杂谈", "评论", "故事", quote) },
    { id: "blank", title: "空", transcript: " " },
  ], "写杂谈");
  assert.deepEqual(samples.map(s => s.id), ["verified"]);
  assert.deepEqual(selectFastReferences([], "写稿"), []);
});
