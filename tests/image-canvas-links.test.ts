import assert from "node:assert/strict";
import test from "node:test";
import { imageCanvasLinks } from "../src/lib/image-canvas-links";
import type { ImageFile, ImageGenerationSummary } from "../src/lib/image-generation-types";
const image = (id: string): ImageFile => ({ id, name: id, format: "png", createdAt: "2026-09-16T00:00:00Z" });
const record = (id: string, referenceIds: string[], extra: Partial<ImageGenerationSummary> = {}): ImageGenerationSummary => ({ id, referenceIds, model: "test", size: "1024x1024", count: 1, createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T00:00:00Z", title: id, imageCount: 1, ...extra });
test("连线来自已保存的引用，不把当前新添加的图片当成历史来源", () => {
  const links = imageCanvasLinks([record("a", ["used"])], [image("used"), image("new")], null);
  assert.deepEqual(links, [{ source: "ref-used", target: "a", label: "参考图 1", kind: "reference" }]);
});
test("生成图作为参考时连接原方案，修改分支去重且不产生悬空连线", () => {
  const records = [record("a", [], { thumbnail: image("output") }), record("b", ["output", "ref"], { parentRecordId: "a" }), record("c", ["missing"], { parentRecordId: "unloaded" })];
  const links = imageCanvasLinks(records, [image("output"), image("ref")], null);
  assert.deepEqual(links, [{ source: "a", target: "b", label: "修改分支", kind: "branch" }, { source: "ref-ref", target: "b", label: "参考图 2", kind: "reference" }]);
});
