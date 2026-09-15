import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateImages } from "../src/lib/image-generation";
import { callImageApi, imageConfig } from "../src/lib/image-runtime";
import { imageGenerationInputSchema } from "../src/lib/image-generation-types";
import { getImageFile, getImageRecord, listImageRecords, saveImageFile } from "../src/lib/storage/images";
import { isResumableJobKind } from "../src/lib/job-persistence";
import { isJobKindAllowedForAppMode } from "../src/lib/app-mode";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const input = { prompt: "一只猫", size: "1024x1024" as const, quality: "low" as const, count: 2, referenceIds: [] };

test("生图使用 JSON 文生图和 multipart 参考图；部分失败保留图片，摘要不携带正文", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "image-generation-test-"));
  const env = { ...process.env };
  const requests: Array<{ url: string; type: string; body: string }> = [];
  let failAt = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ url: request.url || "", type: request.headers["content-type"] || "", body: Buffer.concat(chunks).toString() });
    response.setHeader("Content-Type", "application/json");
    if (requests.length === failAt) { response.writeHead(429); response.end(JSON.stringify({ error: "SECRET_MUST_NOT_LEAK" })); return; }
    response.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  Object.assign(process.env, { STYLE_LIBRARY_DIR: root, SITES_STORAGE_MODE: "", SITES_RUNTIME: "", IMAGE_API_KEY: "test-key", IMAGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`, IMAGE_MODEL: "gpt-image-2.5", IMAGE_PROXY_URL: "", CHAT_PROXY_URL: "" });
  try {
    assert.deepEqual(await listImageRecords(), { records: [], total: 0 });
    const changes: boolean[] = [];
    const record = await generateImages("image-test-1", input, { onProgress: async (_message, _progress, saved) => { changes.push(saved); } });
    assert.equal(record.images.length, 2);
    assert.equal(record.schemaVersion, 1);
    assert.equal(requests[0].url, "/v1/images/generations");
    assert.match(requests[0].type, /application\/json/);
    assert.equal(JSON.parse(requests[0].body).model, "gpt-image-2.5");
    assert.equal(changes.filter(Boolean).length, 3);
    assert.deepEqual((await getImageFile(record.images[0].id)).bytes, png);
    const listing = await listImageRecords();
    assert.equal(listing.total, 1);
    assert.equal("prompt" in listing.records[0], false);
    assert.equal("images" in listing.records[0], false);
    const reference = await saveImageFile(png, "reference.png");
    await generateImages("image-test-2", { ...input, count: 1, referenceIds: [reference.id] }, { onProgress: async () => {} });
    assert.equal(requests[2].url, "/v1/images/edits");
    assert.match(requests[2].type, /multipart\/form-data; boundary=/);
    assert.match(requests[2].body, /name="image\[\]"/);
    failAt = requests.length + 2;
    await assert.rejects(generateImages("image-test-partial", input, { onProgress: async () => {} }), /限流或额度不足/);
    assert.equal((await getImageRecord("image-test-partial"))?.images.length, 1);
    assert.equal((await getImageRecord("image-test-1"))?.images.length, 2);
    const controller = new AbortController();
    await assert.rejects(generateImages("image-test-cancel", input, { signal: controller.signal, onProgress: async (_message, _progress, saved) => {
      if (saved && (await getImageRecord("image-test-cancel"))?.images.length === 1) controller.abort();
    } }), { name: "AbortError" });
    assert.equal((await getImageRecord("image-test-cancel"))?.images.length, 1);
    await assert.rejects(getImageRecord("../bad"), /不合法/);
    await assert.rejects(saveImageFile(Buffer.from("<html>upstream failed</html>"), "fake.png"), /图片内容无效/);
    await fs.writeFile(path.join(root, "images", "records", "broken.json"), "{");
    await assert.rejects(listImageRecords(), /损坏/);
    const config = { ...imageConfig(), apiKey: "" };
    await assert.rejects(callImageApi({ config, prompt: "test", referenceFiles: [] }), /未配置/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("生图参数与运行模式边界；重启不自动重复收费", () => {
  assert.equal(imageGenerationInputSchema.safeParse({ ...input, prompt: "   " }).success, false);
  assert.equal(imageGenerationInputSchema.safeParse({ ...input, count: 5 }).success, false);
  assert.equal(imageGenerationInputSchema.safeParse({ ...input, referenceIds: ["../secret"] }).success, false);
  assert.equal(isResumableJobKind("image-generation"), false);
  assert.equal(isJobKindAllowedForAppMode("image-generation", "gross-margin"), false);
  assert.equal(isJobKindAllowedForAppMode("image-generation", "workspace"), true);
});
