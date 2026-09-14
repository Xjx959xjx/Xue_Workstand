import assert from "node:assert/strict";
import test from "node:test";
import { selectFastReferences, fastWriterPlan } from "../src/lib/writer-fast-reference";
import { addWriterPreference, removeWriterPreference, preserveWriterPreferences } from "../src/lib/writer-preference";
import { WRITER_REFERENCE_BUDGET, writerContextSchema } from "../src/lib/writer-context";

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
