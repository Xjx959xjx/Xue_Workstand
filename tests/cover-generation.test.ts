import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { generateDraftCover } from "../src/lib/cover";
import { draftCoverInputSchema } from "../src/lib/cover-types";
import { isResumableJobKind } from "../src/lib/job-persistence";
import { createNdjsonStream } from "../src/lib/streaming";
import { getDraftAssetFile, resolveDraft, saveDraft, saveGeneratedCoverImage, saveUploadedDraftCoverReferences, upsertAccount } from "../src/lib/storage";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

test("封面并发资产不覆盖，校验失败、生成失败和取消保留已有结果", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cover-generation-test-"));
  const env = { ...process.env };
  let requests = 0;
  let failAt = 0;
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    requests += 1;
    response.setHeader("Content-Type", "application/json");
    if (requests === failAt) { response.writeHead(429); response.end("{}"); return; }
    response.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, SITES_STORAGE_MODE: "", SITES_RUNTIME: "", IMAGE_API_KEY: "test-key", IMAGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`, IMAGE_PROXY_URL: "", CHAT_PROXY_URL: "" });
  try {
    const account = await upsertAccount({ platform: "bilibili", name: "封面测试", uid: "cover-test" });
    const draft = await saveDraft({ platform: account.platform, accountId: account.id, accountName: account.name, title: "封面测试", mode: "topic", prompt: "测试", content: "测试正文", styleRef: { platform: account.platform, accountId: account.id, accountName: account.name }, version: { sessionId: "cover-test", revision: 1, origin: "generated", contextFingerprint: "cover-test", promptVersion: "test" } });
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const uploads = await Promise.all([0, 1].map(() => saveUploadedDraftCoverReferences({ draftId: draft.id, files: [{ name: "../reference.jpg", type: "image/jpeg", data: png }] })));
    const refs = uploads.flatMap((upload) => upload.references);
    assert.equal(new Set(refs.map((ref) => ref.id)).size, 2);
    assert.equal((await resolveDraft(draft.id)).draft.assets?.cover?.references.length, 2);
    for (const ref of refs) {
      assert.match(ref.path!, /^references[/\\].+\.png$/);
      assert.deepEqual((await getDraftAssetFile(draft.id, ref.path!)).bytes, png);
    }
    const saved = await Promise.all([0, 1].map(() => saveGeneratedCoverImage({ draftId: draft.id, bytes: png, prompt: "相同提示词", referenceIds: [], model: "test", size: "1024x1024", quality: "low" })));
    assert.equal(new Set(saved.map((result) => result.image.path)).size, 2);
    const input = { draftId: draft.id, referenceIds: [refs[0].id], count: 2 };
    await assert.rejects(saveGeneratedCoverImage({ draftId: draft.id, bytes: Buffer.from("<html>error</html>"), prompt: "", referenceIds: [], model: "test", size: "1024x1024", quality: "low" }), /图片内容无效/);
    await assert.rejects(saveUploadedDraftCoverReferences({ draftId: draft.id, files: [{ name: "fake.png", type: "image/png", data: Buffer.from("bad") }] }), /图片内容无效/);
    await assert.rejects(getDraftAssetFile(draft.id, "../escape"), /不在当前草稿目录/);
    await assert.rejects(generateDraftCover({ ...input, referenceIds: ["missing"] }), /参考图不存在/);
    assert.equal(requests, 0);
    failAt = 2;
    const revisions: number[] = [];
    await assert.rejects(generateDraftCover({ ...input, onSaved: async (images) => { revisions.push(images.length); } }), /429/);
    assert.deepEqual(revisions, [1]);
    assert.equal((await resolveDraft(draft.id)).draft.assets?.cover?.images.length, 3);
    const controller = new AbortController();
    await assert.rejects(generateDraftCover({ ...input, signal: controller.signal, onSaved: async () => { controller.abort(); } }), { name: "AbortError" });
    assert.equal(requests, 3);
    assert.equal((await resolveDraft(draft.id)).draft.assets?.cover?.images.length, 4);
    for (const result of saved) assert.deepEqual((await getDraftAssetFile(draft.id, result.image.path)).bytes, png);
    const missing = await getDraftAssetFile(draft.id, refs[0].path!);
    await fs.rm(missing.file);
    await assert.rejects(generateDraftCover(input), /读取封面参考图.*失败/);
    assert.equal(requests, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("封面输入拒绝越界、重复和超量，重启不自动重复收费", () => {
  for (const input of [{ draftId: "../escape" }, { draftId: "draft", count: 5 }, { draftId: "draft", referenceIds: ["same", "same"] }, { draftId: "draft", referenceIds: Array.from({ length: 7 }, (_, i) => String(i)) }]) {
    assert.equal(draftCoverInputSchema.safeParse(input).success, false);
  }
  assert.equal(isResumableJobKind("image-cover"), false);
});

test("封面流按版本推送部分结果，失败可见；建任务期间断开仍取消", async () => {
  const controller = new AbortController();
  let earlyAbort = false;
  let cancelled = 0;
  let index = 0;
  const snapshots = [
    { status: "running", dataRevision: 1, imageIds: ["saved-a"] },
    { status: "running", dataRevision: 1, imageIds: ["saved-a"] },
    { status: "failed", dataRevision: 2, imageIds: ["saved-a", "saved-b"] }
  ];
  const job = { id: "job-cover", kind: "image-cover", status: "queued", message: "处理中", updatedAt: "start" };
  const mocks: Record<string, unknown> = {
    "node:timers/promises": { setTimeout: async () => {} },
    "@/lib/api-route": { parseJsonBody: async () => ({ draftId: "draft", count: 2, referenceIds: [] }), apiError: (error: Error) => { throw error; } },
    "@/lib/cover-types": { draftCoverInputSchema },
    "@/lib/jobs": {
      createJob: async () => { if (earlyAbort) controller.abort(); return job; },
      getJob: async () => {
        if (earlyAbort) return job;
        const snapshot = snapshots[Math.min(index++, snapshots.length - 1)];
        return { ...job, ...snapshot, updatedAt: String(index), error: "模拟生成失败", result: { imageIds: snapshot.imageIds } };
      },
      cancelJob: async () => { cancelled += 1; }
    },
    "@/lib/storage": { resolveDraft: async () => ({ draft: { id: "draft", assets: { cover: { images: [{ id: "old" }, { id: "saved-a" }, { id: "saved-b" }], references: [] } } } }) },
    "@/lib/streaming": { createNdjsonStream }
  };
  const sandboxModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/app/api/draft-assets/cover/stream/route.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { module: sandboxModule, exports: sandboxModule.exports, require: (name: string) => mocks[name], Response, Error });
  const response = await sandboxModule.exports.POST(new Request("http://localhost/cover", { method: "POST" }));
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const results = events.filter((event) => event.type === "result");
  assert.deepEqual(results.map((event) => event.data.images.map((image: { id: string }) => image.id)), [["saved-a"], ["saved-a", "saved-b"]]);
  assert.equal(events.find((event) => event.type === "error").message, "模拟生成失败");
  assert.equal(cancelled, 0);
  earlyAbort = true;
  const aborted = await sandboxModule.exports.POST(new Request("http://localhost/cover", { method: "POST", signal: controller.signal }));
  assert.equal(await aborted.text(), "");
  assert.equal(cancelled, 1);
});
