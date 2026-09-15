import http from "node:http";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_LISTEN_PORT = 3401;
const DEFAULT_UPSTREAM_PORT = 3000;
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;
const BRIDGE_PATH = "/api/capability-bridge";
const ASSET_PATH_PREFIX = `${BRIDGE_PATH}/assets/`;
const WORKSPACE_PATH_PREFIX = `${BRIDGE_PATH}/workspace/`;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export function startCapabilityBridgeGateway(options = {}) {
  const listenPort = boundedPort(options.listenPort ?? process.env.SITES_CAPABILITY_GATEWAY_PORT, DEFAULT_LISTEN_PORT);
  const upstreamPort = boundedPort(options.upstreamPort ?? process.env.SITES_CAPABILITY_UPSTREAM_PORT, DEFAULT_UPSTREAM_PORT);
  const bodyLimit = boundedNumber(
    options.bodyLimit ?? process.env.SITES_CAPABILITY_BRIDGE_BODY_LIMIT_BYTES,
    DEFAULT_BODY_LIMIT,
    64 * 1024,
    8 * 1024 * 1024
  );

  const server = http.createServer((request, response) => {
    void proxyRequest(request, response, { upstreamPort, bodyLimit });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 21 * 60 * 1000;
  server.keepAliveTimeout = 5_000;
  server.listen(listenPort, "127.0.0.1");
  return server;
}

async function proxyRequest(request, response, options) {
  const requestUrl = safeRequestUrl(request.url);
  if (!requestUrl || !isAllowedRequest(request.method, requestUrl.pathname)) {
    return sendJson(response, 404, { error: "该公网入口只开放远程能力接口。" });
  }

  const declaredLength = Number.parseInt(String(request.headers["content-length"] || ""), 10);
  if (Number.isFinite(declaredLength) && declaredLength > options.bodyLimit) {
    return sendJson(response, 413, { error: "远程能力请求正文超过允许上限。" });
  }

  const upstream = http.request({
    hostname: "127.0.0.1",
    port: options.upstreamPort,
    method: request.method,
    path: request.url,
    headers: forwardedHeaders(request.headers, options.upstreamPort)
  });

  let completed = false;
  const finish = () => {
    completed = true;
  };
  request.once("aborted", () => upstream.destroy());
  response.once("close", () => {
    if (!completed) upstream.destroy();
  });
  upstream.once("error", () => {
    if (response.writableEnded) return;
    if (!response.headersSent) {
      sendJson(response, 502, { error: "当前 Mac 的远程能力服务暂时不可用。" });
    } else {
      response.destroy();
    }
  });
  upstream.once("response", (upstreamResponse) => {
    response.writeHead(
      upstreamResponse.statusCode || 502,
      forwardedResponseHeaders(upstreamResponse.headers)
    );
    upstreamResponse.once("end", finish);
    upstreamResponse.pipe(response);
  });
  if (request.method === "GET" || request.method === "HEAD") {
    request.pipe(upstream);
    return;
  }
  let receivedBytes = 0;
  let rejected = false;
  request.on("data", (chunk) => {
    if (rejected) return;
    receivedBytes += Buffer.byteLength(chunk);
    if (receivedBytes > options.bodyLimit) {
      rejected = true;
      upstream.destroy();
      sendJson(response, 413, { error: "远程能力请求正文超过允许上限。" });
      return;
    }
    upstream.write(chunk);
  });
  request.once("end", () => {
    if (!rejected) upstream.end();
  });
  request.once("error", () => upstream.destroy());
}

function isAllowedRequest(method = "", pathname) {
  if (pathname === BRIDGE_PATH) return method === "GET" || method === "POST";
  if (pathname.startsWith(WORKSPACE_PATH_PREFIX)) {
    return ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method) && pathname.length > WORKSPACE_PATH_PREFIX.length;
  }
  if (!pathname.startsWith(ASSET_PATH_PREFIX) || method !== "GET") return false;
  const assetId = pathname.slice(ASSET_PATH_PREFIX.length);
  return /^[A-Za-z0-9_-]{12,128}$/.test(assetId);
}

function safeRequestUrl(value) {
  try {
    return new URL(value || "/", "http://127.0.0.1");
  } catch {
    return null;
  }
}

function forwardedHeaders(headers, upstreamPort) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  }
  result.host = `127.0.0.1:${upstreamPort}`;
  result["x-forwarded-proto"] = "https";
  return result;
}

function forwardedResponseHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  }
  result["cache-control"] = "no-store";
  result["x-content-type-options"] = "nosniff";
  return result;
}

function sendJson(response, status, body) {
  if (response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function boundedPort(value, fallback) {
  return boundedNumber(value, fallback, 0, 65_535);
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isDirectExecution()) {
  const server = startCapabilityBridgeGateway();
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.once("listening", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : DEFAULT_LISTEN_PORT;
    console.log(`能力桥窄网关已监听：http://127.0.0.1:${port}`);
  });
  server.once("error", (error) => {
    console.error(`能力桥窄网关启动失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
