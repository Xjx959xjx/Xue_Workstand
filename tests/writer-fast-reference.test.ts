import assert from "node:assert/strict";
import test from "node:test";
import { fastWriterPlan } from "../src/lib/writer-fast-reference";
import { addWriterPreference, removeWriterPreference, preserveWriterPreferences } from "../src/lib/writer-preference";
import { writerContextSchema } from "../src/lib/writer-context";

test("直接写作只提取要求中的字数和禁用词，不采用素材中的旧要求", () => {
  const plan = fastWriterPlan("用户本次要求：\n4—20字，不用联名\n\n原始资料：\n旧案例说1000—2000字，禁用词旧词", []);
  assert.deepEqual(plan.task.length, { min: 4, max: 20, quote: "4—20字" });
  assert.deepEqual(plan.task.forbiddenTerms, [{ text: "联名", quote: "不用联名" }]);
  assert.deepEqual(plan.task.facts, []);
  assert.deepEqual(plan.selected, []);
  assert.ok(writerContextSchema.shape.plan.safeParse(plan).success);
  assert.equal(fastWriterPlan("按素材写稿", []).task.length, null);
  assert.equal(fastWriterPlan("20—4字", []).task.length, null);
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
