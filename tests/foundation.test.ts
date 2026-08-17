import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  assertJobKindAllowedForAppMode,
  isJobKindAllowedForAppMode
} from "../src/lib/app-mode";
import {
  isChatConfigConfigured,
  type ChatRuntimeConfig
} from "../src/lib/model-runtime";
import {
  getVideo,
  readTranscript,
  saveTranscript,
  saveVideos,
  upsertAccount,
  upsertProject
} from "../src/lib/storage";
import type { Account, Video } from "../src/lib/types";

const execFileAsync = promisify(execFile);

test("毛利模式只允许毛利刷新任务", () => {
  assert.equal(isJobKindAllowedForAppMode("gross-margin-refresh", "gross-margin"), true);
  assert.equal(isJobKindAllowedForAppMode("write-copy", "gross-margin"), false);
  assert.equal(isJobKindAllowedForAppMode("write-copy", "workspace"), true);

  assert.throws(
    () => assertJobKindAllowedForAppMode("collect-account", "gross-margin"),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 403);
      return true;
    }
  );
});

test("完整模型端点不依赖 baseUrl 也能被识别", () => {
  assert.equal(isChatConfigConfigured(chatConfig({
    wireApi: "responses",
    responsesUrl: "https://example.com/responses"
  })), true);
  assert.equal(isChatConfigConfigured(chatConfig({
    wireApi: "chat_completions",
    chatCompletionsUrl: "https://example.com/chat/completions"
  })), true);
  assert.equal(isChatConfigConfigured(chatConfig({
    wireApi: "responses",
    chatCompletionsUrl: "https://example.com/chat/completions"
  })), false);
});

test("同名账号和项目不会覆盖彼此目录", async () => {
  await withTemporaryLibrary(async () => {
    const [firstAccount, secondAccount] = await Promise.all([
      upsertAccount({ platform: "bilibili", name: "同名账号", uid: "uid-1" }),
      upsertAccount({ platform: "bilibili", name: "同名账号", uid: "uid-2" })
    ]);
    assert.notEqual(firstAccount.id, secondAccount.id);
    assert.notEqual(firstAccount.slug, secondAccount.slug);

    const [firstProject, secondProject] = await Promise.all([
      upsertProject({ name: "同名项目" }),
      upsertProject({ name: "同名项目" })
    ]);
    assert.notEqual(firstProject.id, secondProject.id);
    assert.notEqual(firstProject.slug, secondProject.slug);
  });
});

test("视频刷新会修复失效转写状态", async () => {
  await withTemporaryLibrary(async () => {
    const account = await upsertAccount({ platform: "bilibili", name: "测试账号", uid: "uid-stale" });
    const [saved] = await saveVideos(account, [{
      ...videoFixture(account, 100),
      transcriptStatus: "completed",
      transcriptPath: "/missing/transcript.txt",
      transcriptSource: "platform_subtitle"
    }]);

    assert.equal(saved.transcriptStatus, "not_started");
    assert.equal(saved.transcriptPath, undefined);
    assert.equal(saved.transcriptSource, undefined);
  });
});

test("视频统计刷新与转写并发时不会互相覆盖", async () => {
  await withTemporaryLibrary(async () => {
    const account = await upsertAccount({ platform: "bilibili", name: "并发账号", uid: "uid-concurrent" });
    await saveVideos(account, [videoFixture(account, 100)]);

    await Promise.all([
      saveTranscript({
        platform: account.platform,
        accountId: account.id,
        videoId: "video-1",
        text: "这是一份并发写入的转写稿。",
        source: "manual"
      }),
      saveVideos(account, [videoFixture(account, 200)])
    ]);

    const { video } = await getVideo(account.platform, account.id, "video-1");
    assert.equal(video.stats.views, 200);
    assert.equal(video.transcriptStatus, "completed");
    assert.ok(video.transcriptRevision);
    assert.equal(await readTranscript(account.platform, account.id, "video-1"), "这是一份并发写入的转写稿。");
  });
});

test("素材库修复模式只改安全元数据并保留备份", async () => {
  await withTemporaryLibrary(async (temporaryRoot) => {
    const accountRoot = path.join(temporaryRoot, "bilibili", "repair-account");
    const videoFile = path.join(accountRoot, "videos", "video-1.json");
    await fs.mkdir(path.join(accountRoot, "videos"), { recursive: true });
    await fs.writeFile(path.join(accountRoot, "account.json"), `${JSON.stringify({
      id: "bilibili:repair-account",
      platform: "bilibili",
      name: "修复测试",
      slug: "repair-account",
      uid: "repair-account",
      videoCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, null, 2)}\n`);
    await fs.writeFile(videoFile, `${JSON.stringify({
      ...videoFixture({ id: "bilibili:repair-account", platform: "bilibili" } as Account, 100),
      transcriptStatus: "completed",
      transcriptPath: "/missing/transcript.txt",
      transcriptRevision: "stale-revision",
      transcriptSource: "platform_subtitle"
    }, null, 2)}\n`);

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "scripts", "check-library-consistency.mjs"),
      "--repair"
    ], {
      cwd: process.cwd(),
      env: { ...process.env, STYLE_LIBRARY_DIR: temporaryRoot }
    });
    const result = JSON.parse(stdout) as {
      issueCount: number;
      repairCount: number;
      repairs: Array<{ backup: string }>;
    };
    const repaired = JSON.parse(await fs.readFile(videoFile, "utf8")) as Video;

    assert.equal(result.issueCount, 0);
    assert.equal(result.repairCount, 1);
    assert.equal(repaired.transcriptStatus, "not_started");
    assert.equal(repaired.transcriptPath, undefined);
    assert.equal(repaired.transcriptRevision, undefined);
    assert.equal(repaired.transcriptSource, undefined);
    assert.equal((await fs.stat(result.repairs[0].backup)).isFile(), true);
  });
});

function chatConfig(overrides: Partial<ChatRuntimeConfig>): ChatRuntimeConfig {
  return {
    role: "primary",
    enabled: true,
    apiKey: "test-key",
    baseUrl: "",
    responsesUrl: "",
    chatCompletionsUrl: "",
    model: "test-model",
    wireApi: "auto",
    reasoningEffort: "none",
    chatCompletionReasoningEffort: "none",
    serviceTier: "",
    proxyUrl: "",
    ...overrides
  };
}

function videoFixture(account: Account, views: number): Video {
  return {
    id: "video-1",
    platform: account.platform,
    accountId: account.id,
    title: "测试视频",
    url: "https://www.bilibili.com/video/BV1test",
    stats: {
      views,
      likes: 10,
      comments: 2,
      favorites: 1,
      shares: 0
    },
    hotScore: 0,
    relativeViewRate: 1,
    transcriptStatus: "not_started",
    updatedAt: new Date().toISOString()
  };
}

async function withTemporaryLibrary(run: (temporaryRoot: string) => Promise<void>) {
  const previousRoot = process.env.STYLE_LIBRARY_DIR;
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "style-library-test-"));
  process.env.STYLE_LIBRARY_DIR = temporaryRoot;
  try {
    await run(temporaryRoot);
  } finally {
    if (previousRoot === undefined) delete process.env.STYLE_LIBRARY_DIR;
    else process.env.STYLE_LIBRARY_DIR = previousRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
