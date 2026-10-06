import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { openCliRows, parseJsonish } from "../src/lib/opencli-runtime";
import { buildDouyinBatchStatsExtractJs } from "../src/lib/opencli-douyin-scripts";
import { assertPublicHttpUrl } from "../src/lib/public-http-url";
import type { BatchTranscribeInput } from "../src/lib/batch-transcribe";
import type { CollectAccountInput } from "../src/lib/account-collection";
import type { Account, BatchTranscribeResult, CollectResult, Video } from "../src/lib/types";
import type { transcribeVideo } from "../src/lib/transcription";

const require = createRequire(import.meta.url);
// Only builtin utilities are real; storage, processes and network capabilities are injected.
function load<T>(file: string, mocks: Record<string, unknown>, extra = "", env = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8") + "\n" + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, { exports, Buffer, process: { env }, AbortSignal, URL, console,
    require: (name: string) => mocks[name] ?? (["util", "path", "os", "crypto", "net"].includes(name) ? require(name) : {})
  });
  return exports as T;
}

const account = { id: "bilibili:test", slug: "test", platform: "bilibili", name: "测试", uid: "123" } as Account;
const video = (id: string, completed = false): Video => ({
  id, accountId: account.id, platform: "bilibili", title: id, url: `https://example.com/${id}`,
  publishedAt: "2025-01-01", stats: { views: 10, likes: 5, comments: 3, favorites: 2 },
  hotScore: 0, relativeViewRate: 0,
  transcriptStatus: completed ? "completed" : "not_started", updatedAt: "2025-01-01"
});

test("显式批量 IDs 先去重并筛选未转写项，再应用上限", async () => {
  const called: string[] = [];
  const videos = [video("done", true), video("a"), video("b")];
  const batch = load<{ runBatchTranscribe(input: BatchTranscribeInput): Promise<BatchTranscribeResult> }>("src/lib/batch-transcribe.ts", {
    "./storage": { resolveAccount: async () => account, getAccountSummary: async () => ({ ...account, videos }) },
    "./transcription": { transcribeVideo: async ({ videoId }: { videoId: string }) => { called.push(videoId); return { video: video(videoId, true), usedProvider: "stub" }; } }
  });
  const result = await batch.runBatchTranscribe({ platform: "bilibili", accountId: account.id, limit: 1, videoIds: ["done", "a", "a", "b"] });
  assert.equal(result.requested, 1);
  assert.deepEqual(called, ["a"]);
  await assert.rejects(batch.runBatchTranscribe({ platform: "bilibili", accountId: account.id, limit: 1, videoIds: ["foreign"] }), /不属于当前账号/);
});

test("B站日期分页大小固定，只有截止日期时继续读取历史页", async () => {
  const calls: Array<{ page?: number; limit: number; hydrateDetails: boolean }> = [];
  const collection = load<{ collectAccountContent(input: CollectAccountInput): Promise<CollectResult> }>("src/lib/account-collection.ts", {
    "./opencli": { resolveAccountUid: async () => "123", collectVideos: async (input: typeof calls[number]) => {
      calls.push(input);
      return { videos: (input.page || 1) <= 2 ? [video(String(input.page || 1))] : [], raw: [], rawCount: 1, command: "stub" };
    } },
    "./platform-links": { normalizeLinkInput: (value: string) => value, extractFirstLinkFromInput: () => "" },
    "./account-profile": { inferAccountNameFromCollectedData: () => "测试", inferAccountAvatarFromCollectedData: () => "avatar" },
    "./storage": { upsertAccount: async () => account, getAccountSummary: async () => ({ ...account, videos: [] }), saveVideos: async (_account: Account, videos: Video[]) => videos },
    "./utils": { nowIso: () => "2025-01-01", shortHash: () => "hash" }
  });
  const result = await collection.collectAccountContent({ platform: "bilibili", name: "测试", uidOrUrl: "123", limit: 1, order: "comments", toDate: "2025-12-31" });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.limit === 50 && call.hydrateDetails));
  assert.equal(result.videos.length, 1);
});

test("远程转写使用调用前 revision，取消后不保存", async () => {
  const events: string[] = [];
  const conflict = Object.assign(new Error("冲突"), { statusCode: 409 });
  const controller = new AbortController();
  let cancel = false;
  const transcription = load<{ transcribeVideo: typeof transcribeVideo }>("src/lib/transcription.ts", {
    child_process: { execFile: () => { throw new Error("禁止真实进程"); } },
    "./storage": {
      getTranscriptSnapshot: async () => { events.push("snapshot"); return { revision: "old" }; },
      saveTranscript: async ({ expectedRevision }: { expectedRevision: string }) => { events.push("save"); assert.equal(expectedRevision, "old"); throw conflict; }
    },
    "./remote-capabilities": { hasRemoteCapabilityBridge: () => true, callRemoteCapability: async () => { events.push("remote-edit"); if (cancel) controller.abort(); return { text: "新稿" }; } }
  }, "", { SITES_RUNTIME: "cloud" });
  const input = { platform: "douyin" as const, accountId: "test", videoId: "a" };
  await assert.rejects(transcription.transcribeVideo(input), (error) => error === conflict);
  assert.deepEqual(events, ["snapshot", "remote-edit", "save"]);
  events.length = 0;
  cancel = true;
  await assert.rejects(transcription.transcribeVideo({ ...input, signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(events, ["snapshot", "remote-edit"]);
});

test("本地 ASR 保存冲突保留 409 且不标记旧稿失败", async () => {
  let marked = 0;
  const conflict = Object.assign(new Error("冲突"), { statusCode: 409 });
  const transcription = load<{ transcribeVideo: typeof transcribeVideo }>("src/lib/transcription.ts", {
    child_process: { execFile: () => { throw new Error("禁止真实进程"); } },
    fs: { promises: { rm: async () => {} } },
    "./storage": { getVideo: async () => ({ account, video: video("a", true) }), getTranscriptSnapshot: async () => ({ revision: "old" }), saveTranscript: async () => { throw conflict; }, markTranscriptFailed: async () => { marked++; } },
    "./transcript-cleaning": { cleanTranscriptText: async () => ({ text: "新稿" }) }
  }, "prepareAudioForVolcengine = async () => ({ mediaPath: '/virtual.wav', timings: [] }); transcribeWithVolcengine = async () => ({ text: '新稿', timings: [] });");
  await assert.rejects(transcription.transcribeVideo({ platform: "douyin", accountId: "test", videoId: "a", mediaPath: "/virtual.wav" }), (error) => error === conflict);
  assert.equal(marked, 0);
});

test("OpenCLI 非列表结果显式失败，真实空列表保持兼容", () => {
  for (const raw of ["session expired", {}, { data: "error" }, null]) assert.throws(() => openCliRows(raw), /无法解析/);
  assert.deepEqual(openCliRows(parseJsonish("[]")), []);
  assert.deepEqual(openCliRows({ data: [] }), []);
});

test("抖音详情缺字段显式返回 missingFields，真实零值不算缺失", async () => {
  const rows = await vm.runInNewContext(buildDouyinBatchStatsExtractJs(["1", "2"]), {
    URL, fetch: async (url: string) => ({ ok: true, json: async () => ({ aweme_detail: { statistics: new URL(url).searchParams.get("aweme_id") === "1"
      ? { digg_count: 5 } : { digg_count: 0, comment_count: 0, collect_count: 0, share_count: 0 } } }) })
  });
  assert.deepEqual(Array.from(rows[0].missingFields), ["comment_count", "collect_count", "share_count"]);
  assert.equal(rows[1].missingFields.length, 0);
});

test("媒体边界拒绝非 HTTP 协议及 IPv4/IPv6 内网，不发出下载", async () => {
  for (const url of ["file:///private/audio.wav", "http://127.0.0.1/a", "http://10.0.0.1/a", "http://localhost/a", "http://[::1]/a", "http://[::ffff:127.0.0.1]/a", "http://100.64.0.1/a"]) {
    await assert.rejects(assertPublicHttpUrl(url), (error) => error instanceof Error && "statusCode" in error && error.statusCode === 400);
  }
});
