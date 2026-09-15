import assert from "node:assert/strict";
import test from "node:test";
import { workspaceApiPath, relayWorkspaceRequest, proxyToLocalWorkspace } from "../src/lib/workspace-bridge";
import { GET } from "../src/app/api/capability-bridge/workspace/[...path]/route";

test("资料桥拒绝路径穿越与桥接循环", () => {
  for (const path of ["/api/../secret", "/api/a%2fb", "/api/%252e", "/api/capability-bridge/workspace", "/elsewhere"]) {
    assert.throws(() => workspaceApiPath(path));
  }
  assert.equal(workspaceApiPath("/api/projects/a"), "/api/projects/a");
});

test("转发保留业务冲突、请求正文和 Range，隔离浏览器凭证", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_target, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer synthetic-bridge-token");
      assert.equal(headers.get("cookie"), null);
      assert.equal(headers.get("range"), "bytes=0-9");
      assert.equal(await new Response(init?.body).text(), "revision=3");
      return new Response("版本冲突", { status: 409, headers: { "set-cookie": "secret=1" } });
    };
    const result = await relayWorkspaceRequest(new Request("https://site.test/api/projects/a", {
      method: "PUT", body: "revision=3", headers: { authorization: "Bearer browser", cookie: "private=1", range: "bytes=0-9" }
    }), "https://bridge.test/api", "synthetic-bridge-token");
    assert.equal(result.status, 409);
    assert.equal(await result.text(), "版本冲突");
    assert.equal(result.headers.get("set-cookie"), null);
  } finally { globalThis.fetch = original; }
});

test("资料桥保留二进制流并拒绝重定向", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new Uint8Array([0, 128, 255]), { status: 206, headers: { "content-range": "bytes 0-2/3" } });
    const response = await relayWorkspaceRequest(new Request("http://local/api/asset"), "http://local/api");
    assert.equal(response.status, 206);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 128, 255]));
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://other.test" } });
    assert.equal((await relayWorkspaceRequest(new Request("http://local/api/a"), "http://local/api")).status, 502);
  } finally { globalThis.fetch = original; }
});

test("本机资料接口先验证令牌，云端断线不回退空库", async () => {
  const original = globalThis.fetch;
  const previous = { ...process.env };
  try {
    delete process.env.SITES_STORAGE_MODE;
    delete process.env.SITES_RUNTIME;
    process.env.SITES_CAPABILITY_BRIDGE_TOKEN = "test-token-abcdefghijklmnopqrstuvwxyz";
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("offline"); };
    assert.equal((await GET(new Request("http://local/api/capability-bridge/workspace/library/overview"))).status, 401);
    assert.equal(calls, 0);
    process.env.SITES_EXTERNAL_CAPABILITY_URL = "https://bridge.test/api/capability-bridge";
    process.env.SITES_EXTERNAL_CAPABILITY_TOKEN = "test";
    assert.equal((await proxyToLocalWorkspace(new Request("https://site.test/api/library/overview"))).status, 503);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
