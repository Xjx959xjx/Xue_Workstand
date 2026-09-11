import assert from "node:assert/strict";
import test from "node:test";
import { segmentSimulationSource, parseDiscussionSimulation } from "../src/lib/discussion-simulation";

const source = "允许2至4人组队。公告没有说明是否自动匹配，也没有说明退出后的进度。";
const segments = segmentSimulationSource(source);
function sample() {
  return { purpose: "内部模拟", topics: [
    { id: "t1", sourceIds: ["s1", "s2"], question: "组队方式" },
    { id: "t2", sourceIds: ["s2"], question: "退出后的进度" }
  ], comments: [
    { id: "c1", parentId: null as string | null, topicId: "t1", text: "【内部模拟】自动匹配是否支持？" },
    { id: "c2", parentId: "c1", topicId: "t1", text: "【内部模拟】组队人数不能证明有自动匹配。" },
    { id: "c3", parentId: null as string | null, topicId: "t2", text: "【内部模拟】退出后能否继续？" },
    { id: "c4", parentId: "c3", topicId: "t2", text: "【内部模拟】需要退出规则才能判断。" }
  ] };
}
test("长句和文末限制保留，片段能按位置还原", () => {
  const text = "前面的产品说明".repeat(80) + "。\n 售后不接受拆封退货！";
  const result = segmentSimulationSource(text);
  assert.equal(result.length, 2);
  assert.ok(result[0].text.length > 120);
  assert.ok(result[1].text.includes("不接受拆封退货"));
  for (const segment of result) assert.equal(text.slice(segment.start, segment.end), segment.text);
  assert.throws(() => segmentSimulationSource("  \n"), /不能为空/);
});
test("引用ID由程序解析原文，4个节点包含2条回复", () => {
  const parsed = parseDiscussionSimulation(JSON.stringify(sample()), segments);
  assert.equal(parsed.comments.length, 4);
  assert.equal(parsed.comments.filter(node => node.parentId !== null).length, 2);
  assert.equal(parsed.evidence[1].segments[0].text, "公告没有说明是否自动匹配，也没有说明退出后的进度。");
});
test("不存在与重复的依据编号拒绝通过", () => {
  for (const ids of [["s99"], ["s2", "s2"]]) {
    const value = sample(); value.topics[0].sourceIds = ids;
    assert.throws(() => parseDiscussionSimulation(JSON.stringify(value), segments), /原文编号/);
  }
});
test("拒绝错数量、失去模拟标识、重复ID和未完成JSON", () => {
  const count = sample(); count.comments.pop();
  assert.throws(() => parseDiscussionSimulation(JSON.stringify(count), segments), /数量/);
  const label = sample(); label.comments[0].text = "没有模拟标识";
  assert.throws(() => parseDiscussionSimulation(JSON.stringify(label), segments), /模拟标识/);
  const ids = sample(); ids.comments[1].id = "c1";
  assert.throws(() => parseDiscussionSimulation(JSON.stringify(ids), segments), /ID重复/);
  assert.throws(() => parseDiscussionSimulation('{"purpose":', segments), /完整JSON/);
});
test("回复不可自引用、循环、跨主题或引用不存在的父节点", () => {
  for (const parent of ["c2", "c3", "c4", "missing"]) {
    const value = sample(); value.comments[1].parentId = parent;
    assert.throws(() => parseDiscussionSimulation(JSON.stringify(value), segments), /父节点/);
  }
  const unknown = sample(); unknown.comments[0].topicId = "missing";
  assert.throws(() => parseDiscussionSimulation(JSON.stringify(unknown), segments), /不存在的主题/);
});
