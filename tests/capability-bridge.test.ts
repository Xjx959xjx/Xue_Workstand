import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { POST as capabilityBridgePost } from "../src/app/api/capability-bridge/route";
import {
  cleanupCapabilityBridgeAsset,
  exposeCapabilityDownloadAsset,
  takeCapabilityBridgeAsset
} from "../src/lib/capability-bridge";

const bridgeToken = "bridge-test-token-0123456789-abcdef";

test("capability bridge 要求强令牌并拒绝错误鉴权", async () => {
  await withBridgeEnv(async () => {
    const response = await capabilityBridgePost(new Request("http://localhost:3000/api/capability-bridge", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: "material-analysis",
        payload: materialPayload()
      })
    }));
    assert.equal(response.status, 401);
    assert.match(String((await response.json() as { error?: string }).error), /鉴权失败/);
  });
});

test("capability bridge 执行已校验的本地素材分析请求", async () => {
  await withBridgeEnv(async () => {
    const response = await capabilityBridgePost(new Request("http://localhost:3000/api/capability-bridge", {
      method: "POST",
      headers: {
        authorization: `Bearer ${bridgeToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: "material-analysis",
        payload: materialPayload()
      })
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { mode?: string; status?: string; fallbackReason?: string };
    assert.equal(body.mode, "textual");
    assert.equal(body.status, "skipped");
    assert.match(body.fallbackReason || "", /没有取得可抽帧/);
  });
});

test("capability bridge 在 Sites Worker 内始终关闭", async () => {
  await withBridgeEnv(async () => {
    process.env.SITES_STORAGE_MODE = "cloud";
    const response = await capabilityBridgePost(new Request("https://site.example.test/api/capability-bridge", {
      method: "POST",
      headers: {
        authorization: `Bearer ${bridgeToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: "material-analysis",
        payload: materialPayload()
      })
    }));
    assert.equal(response.status, 503);
    assert.match(String((await response.json() as { error?: string }).error), /不能运行在 Sites Worker/);
  });
});

test("capability bridge 临时文件使用一次性下载凭证并完成清理", async () => {
  await withBridgeEnv(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "capability-bridge-test-"));
    const filePath = path.join(dir, "sample.bin");
    await fs.writeFile(filePath, Buffer.from("bridge-asset"));

    const exposed = await exposeCapabilityDownloadAsset({
      kind: "video",
      fileName: "sample.bin",
      contentType: "application/octet-stream",
      filePath,
      cleanupTargets: [dir]
    }, "http://localhost:3000/api/capability-bridge") as {
      remoteUrl: string;
      requestHeaders: Record<string, string>;
    };
    const assetId = new URL(exposed.remoteUrl).pathname.split("/").pop() || "";
    await assert.rejects(
      () => takeCapabilityBridgeAsset(assetId, "Bearer wrong-download-token"),
      /鉴权失败/
    );
    const asset = await takeCapabilityBridgeAsset(assetId, exposed.requestHeaders.authorization);
    assert.equal(asset.filePath, filePath);
    assert.equal(asset.byteLength, 12);
    await assert.rejects(
      () => takeCapabilityBridgeAsset(assetId, exposed.requestHeaders.authorization),
      /不存在或已过期/
    );
    await cleanupCapabilityBridgeAsset(asset);
    await assert.rejects(() => fs.stat(filePath), /ENOENT/);
  });
});

function materialPayload() {
  return {
    mediaUrls: [],
    platform: "bilibili",
    title: "桥接测试",
    transcript: "这是一段桥接测试转写。",
    url: "https://www.bilibili.com/video/BV1bridge"
  };
}

async function withBridgeEnv(run: () => Promise<void>) {
  const previous = {
    storageMode: process.env.SITES_STORAGE_MODE,
    runtime: process.env.SITES_RUNTIME,
    token: process.env.SITES_CAPABILITY_BRIDGE_TOKEN,
    publicUrl: process.env.SITES_CAPABILITY_BRIDGE_PUBLIC_URL
  };
  delete process.env.SITES_STORAGE_MODE;
  delete process.env.SITES_RUNTIME;
  process.env.SITES_CAPABILITY_BRIDGE_TOKEN = bridgeToken;
  process.env.SITES_CAPABILITY_BRIDGE_PUBLIC_URL = "http://localhost:3000/api/capability-bridge";
  try {
    await run();
  } finally {
    restoreEnv("SITES_STORAGE_MODE", previous.storageMode);
    restoreEnv("SITES_RUNTIME", previous.runtime);
    restoreEnv("SITES_CAPABILITY_BRIDGE_TOKEN", previous.token);
    restoreEnv("SITES_CAPABILITY_BRIDGE_PUBLIC_URL", previous.publicUrl);
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
