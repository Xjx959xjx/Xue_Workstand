import assert from "node:assert/strict";
import test from "node:test";
import { checkFeishuRuntime } from "../src/lib/feishu";
import {
  callRemoteCapability,
  probeRemoteCapabilityBridge,
  REMOTE_CAPABILITY_OPERATIONS
} from "../src/lib/remote-capabilities";
import { prepareLinkSourceDownload, resolveLinkSourceMedia } from "../src/lib/transcription";
import { resolveGrossMarginAccounts } from "../src/lib/wecom-account-source";

const accountMarkdown = [
  "抖音",
  "|账号昵称|平台|抖音ID|植入价格;（含税不含平台费）|定制价格;（含税不含平台费）|主页链接|",
  "|---|---|---|---|---|---|",
  "|云端账号|抖音|cloud-account|8000|10000|https://v.douyin.com/cloud/|"
].join("\n");

test("Sites 云模式通过 capability bridge 读取企业微信账号表", async () => {
  await withCloudCapability(async (requests) => {
    const result = await resolveGrossMarginAccounts([], { refresh: true });
    assert.equal(result.source, "wecom");
    assert.equal(result.accounts[0]?.name, "云端账号");
    assert.equal(requests[0]?.operation, "wecom-doc");
    assert.deepEqual(requests[0]?.payload, {
      method: "get_doc_content",
      input: { url: "https://doc.weixin.qq.com/sheet/cloud", type: 2 }
    });
  }, ({ operation }) => {
    if (operation === "wecom-doc") return { task_done: true, content: accountMarkdown };
    throw new Error(`未处理的 capability：${operation}`);
  });
});

test("Sites 云模式媒体下载只接受远程 http(s) 地址", async () => {
  await withCloudCapability(async (requests) => {
    const asset = await prepareLinkSourceDownload({
      url: "https://www.bilibili.com/video/BV1cloud",
      kind: "video"
    });
    assert.deepEqual(asset, {
      kind: "video",
      fileName: "cloud-video.mp4",
      contentType: "video/mp4",
      remoteUrl: "https://assets.example.test/cloud-video.mp4",
      requestHeaders: { authorization: "Bearer signed-download-token" }
    });
    assert.deepEqual(requests[0], {
      operation: "link-download",
      payload: { url: "https://www.bilibili.com/video/BV1cloud", kind: "video" }
    });
  }, ({ operation }) => {
    if (operation === "link-download") {
      return {
        kind: "video",
        fileName: "cloud-video.mp4",
        contentType: "video/mp4",
        remoteUrl: "https://assets.example.test/cloud-video.mp4",
        requestHeaders: { authorization: "Bearer signed-download-token" },
        filePath: "/tmp/must-not-leak.mp4"
      };
    }
    throw new Error(`未处理的 capability：${operation}`);
  });
});

test("Sites 云模式素材重新分析通过远程媒体解析能力", async () => {
  await withCloudCapability(async (requests) => {
    const media = await resolveLinkSourceMedia({
      url: "https://www.bilibili.com/video/BV1cloud",
      platform: "bilibili"
    });
    assert.deepEqual(media.mediaUrls, ["https://assets.example.test/cloud-video.mp4"]);
    assert.equal(media.sourceAccountName, "云端作者");
    assert.equal(requests[0]?.operation, "link-media");
  }, ({ operation, payload }) => {
    if (operation === "link-media") {
      return {
        url: (payload as { url: string }).url,
        resolvedUrl: "https://www.bilibili.com/video/BV1cloud",
        platform: "bilibili",
        title: "云端视频",
        sourceAccountName: "云端作者",
        mediaUrls: ["https://assets.example.test/cloud-video.mp4"]
      };
    }
    throw new Error(`未处理的 capability：${operation}`);
  });
});

test("Sites 云模式飞书健康检查不执行本机 CLI", async () => {
  await withCloudCapability(async (requests) => {
    const status = await checkFeishuRuntime();
    assert.equal(status.available, true);
    assert.equal(status.doctor.ok, true);
    assert.equal(requests.length, 0);
  });
});

test("远程 capability 拒绝未鉴权或非 HTTPS 地址", async () => {
  const previousUrl = process.env.SITES_EXTERNAL_CAPABILITY_URL;
  const previousToken = process.env.SITES_EXTERNAL_CAPABILITY_TOKEN;
  try {
    process.env.SITES_EXTERNAL_CAPABILITY_URL = "https://capability.example.test/run";
    delete process.env.SITES_EXTERNAL_CAPABILITY_TOKEN;
    await assert.rejects(() => callRemoteCapability("opencli", {}), /SITES_EXTERNAL_CAPABILITY_TOKEN/);

    process.env.SITES_EXTERNAL_CAPABILITY_URL = "http://capability.example.test/run";
    process.env.SITES_EXTERNAL_CAPABILITY_TOKEN = "test-token";
    await assert.rejects(() => callRemoteCapability("opencli", {}), /必须使用 HTTPS/);
  } finally {
    restoreEnv("SITES_EXTERNAL_CAPABILITY_URL", previousUrl);
    restoreEnv("SITES_EXTERNAL_CAPABILITY_TOKEN", previousToken);
  }
});

test("远程 capability 健康探测识别缺失操作和鉴权失败", async () => {
  await withCloudCapability(async () => {
    const previousFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({
        ok: true,
        operations: ["opencli", "link-media"]
      });
      const partial = await probeRemoteCapabilityBridge({
        requiredOperations: ["opencli", "feishu-publish"]
      });
      assert.equal(partial.ok, false);
      assert.deepEqual(partial.operations, ["opencli", "link-media"]);
      assert.deepEqual(partial.missingOperations, ["feishu-publish"]);
      assert.match(partial.message, /feishu-publish/);

      globalThis.fetch = async () => Response.json({ error: "远程能力服务鉴权失败。" }, { status: 401 });
      const rejected = await probeRemoteCapabilityBridge({ requiredOperations: ["opencli"] });
      assert.equal(rejected.ok, false);
      assert.match(rejected.message, /鉴权失败/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

type CapabilityRequest = { operation: string; payload: unknown };

async function withCloudCapability(
  run: (requests: CapabilityRequest[]) => Promise<void>,
  respond: (request: CapabilityRequest) => unknown = () => ({})
) {
  const previous = {
    storageMode: process.env.SITES_STORAGE_MODE,
    runtime: process.env.SITES_RUNTIME,
    capabilityUrl: process.env.SITES_EXTERNAL_CAPABILITY_URL,
    capabilityToken: process.env.SITES_EXTERNAL_CAPABILITY_TOKEN,
    sheetUrl: process.env.WECOM_ACCOUNT_SHEET_URL,
    fetch: globalThis.fetch
  };
  const requests: CapabilityRequest[] = [];
  process.env.SITES_STORAGE_MODE = "cloud";
  delete process.env.SITES_RUNTIME;
  process.env.SITES_EXTERNAL_CAPABILITY_URL = "https://capability.example.test/run";
  process.env.SITES_EXTERNAL_CAPABILITY_TOKEN = "test-token";
  process.env.WECOM_ACCOUNT_SHEET_URL = "https://doc.weixin.qq.com/sheet/cloud";
  globalThis.fetch = async (_input, init) => {
    assert.equal((init?.headers as Record<string, string>)?.authorization, "Bearer test-token");
    if ((init?.method || "GET") === "GET") {
      return Response.json({ ok: true, operations: [...REMOTE_CAPABILITY_OPERATIONS] });
    }
    const request = JSON.parse(String(init?.body)) as CapabilityRequest;
    requests.push(request);
    return Response.json(respond(request));
  };

  try {
    await run(requests);
  } finally {
    restoreEnv("SITES_STORAGE_MODE", previous.storageMode);
    restoreEnv("SITES_RUNTIME", previous.runtime);
    restoreEnv("SITES_EXTERNAL_CAPABILITY_URL", previous.capabilityUrl);
    restoreEnv("SITES_EXTERNAL_CAPABILITY_TOKEN", previous.capabilityToken);
    restoreEnv("WECOM_ACCOUNT_SHEET_URL", previous.sheetUrl);
    globalThis.fetch = previous.fetch;
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
