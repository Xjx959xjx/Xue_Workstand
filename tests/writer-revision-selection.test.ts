import assert from "node:assert/strict";
import test from "node:test";
import { writeCopyInputSchema } from "../src/lib/write-validation";
import { writeCopySourceKey } from "../src/lib/job-scope";

const input = { action: "revise" as const, mode: "topic" as const, prompt: "", parentDraftId: "a", currentContent: "当前正文", revisionInstruction: "补充需求",
  revisionTargets: [{ parentDraftId: "a", currentContent: "A未保存编辑" }, { parentDraftId: "b", currentContent: "B正文" }] };
test("多稿修改保留每篇当前正文，拒绝重复、空白和跨稿局部选文", () => {
  assert.deepEqual(writeCopyInputSchema.parse(input).revisionTargets, input.revisionTargets);
  assert.equal(writeCopyInputSchema.safeParse({ ...input, revisionTargets: [input.revisionTargets[0], input.revisionTargets[0]] }).success, false);
  assert.equal(writeCopyInputSchema.safeParse({ ...input, revisionTargets: [{ parentDraftId: "a", currentContent: " " }] }).success, false);
  assert.equal(writeCopyInputSchema.safeParse({ ...input, revisionScope: "selection", selectedText: "片段" }).success, false);
  assert.equal(writeCopyInputSchema.safeParse({ ...input, revisionTargets: [] }).success, false);
});
test("任务指纹区分所选稿件和各自编辑内容", () => {
  assert.notEqual(writeCopySourceKey(input), writeCopySourceKey({ ...input, revisionTargets: [input.revisionTargets[0]] }));
  assert.notEqual(writeCopySourceKey(input), writeCopySourceKey({ ...input, revisionTargets: [{ parentDraftId: "a", currentContent: "新的正文" }] }));
});
