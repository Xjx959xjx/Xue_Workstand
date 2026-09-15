import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { once } from "node:events";
import { startCapabilityBridgeGateway } from "../scripts/capability-bridge-gateway.mjs";

test("能力桥窄网关只代理桥接接口和一次性素材路径", async () => {
  const upstream = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString("utf8")
    }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress === "object");

  const gateway = startCapabilityBridgeGateway({
    listenPort: 0,
    upstreamPort: upstreamAddress.port,
    bodyLimit: 64 * 1024
  });
  await once(gateway, "listening");
  const gatewayAddress = gateway.address();
  assert.ok(gatewayAddress && typeof gatewayAddress === "object");
  const origin = `http://127.0.0.1:${gatewayAddress.port}`;

  try {
    const root = await fetch(`${origin}/`);
    assert.equal(root.status, 404);

    const unrelated = await fetch(`${origin}/api/health`);
    assert.equal(unrelated.status, 404);

    const nested = await fetch(`${origin}/api/capability-bridge/not-allowed`);
    assert.equal(nested.status, 404);

    const health = await fetch(`${origin}/api/capability-bridge`, {
      headers: { authorization: "Bearer redacted-test-token" }
    });
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { authorization?: string }).authorization, "Bearer redacted-test-token");

    const post = await fetch(`${origin}/api/capability-bridge`, {
      method: "POST",
      headers: {
        authorization: "Bearer redacted-test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ operation: "material-analysis", payload: {} })
    });
    const postBody = await post.json() as { method?: string; body?: string };
    assert.equal(postBody.method, "POST");
    assert.match(postBody.body || "", /material-analysis/);

    const oversized = await fetch(`${origin}/api/capability-bridge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(64 * 1024 + 1)
    });
    assert.equal(oversized.status, 413);

    const workspace = await fetch(`${origin}/api/capability-bridge/workspace/projects/test?revision=1`, {
      method: "PUT", headers: { authorization: "Bearer test" }, body: "test-body"
    });
    assert.equal(workspace.status, 200);
    const workspaceBody = await workspace.json() as { method: string; body: string; url: string };
    assert.equal(workspaceBody.method, "PUT");
    assert.equal(workspaceBody.body, "test-body");
    assert.match(workspaceBody.url, /revision=1$/);
    const oversizedPut = await fetch(`${origin}/api/capability-bridge/workspace/projects/test`, {
      method: "PUT", body: "x".repeat(64 * 1024 + 1)
    });
    assert.equal(oversizedPut.status, 413);

    const asset = await fetch(`${origin}/api/capability-bridge/assets/abcdefghijklmnop`);
    assert.equal(asset.status, 200);
    assert.equal((await asset.json() as { url?: string }).url, "/api/capability-bridge/assets/abcdefghijklmnop");

    const invalidAsset = await fetch(`${origin}/api/capability-bridge/assets/..%2Fprivate`);
    assert.equal(invalidAsset.status, 404);
  } finally {
    await Promise.all([closeServer(gateway), closeServer(upstream)]);
  }
});

function closeServer(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
