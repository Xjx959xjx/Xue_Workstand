import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const CAPABILITY_GATEWAY_PORT = 3401;
export const CAPABILITY_FUNNEL_PORT = 8443;
export const CAPABILITY_KEYCHAIN_SERVICE = "com.xjx.account-style-library.capability-bridge";
export const CAPABILITY_KEYCHAIN_ACCOUNT = "sites";

const command = process.argv[2] || "status";

export function readCapabilityBridgeSecret(options = {}) {
  if (process.platform !== "darwin") {
    if (options.required) throw new Error("能力桥钥匙串仅支持 macOS。");
    return "";
  }
  const result = capture("/usr/bin/security", [
    "find-generic-password",
    "-s", CAPABILITY_KEYCHAIN_SERVICE,
    "-a", CAPABILITY_KEYCHAIN_ACCOUNT,
    "-w"
  ]);
  const token = result.ok ? result.stdout.trim() : "";
  if (options.required && token.length < 32) {
    throw new Error("能力桥令牌尚未写入 macOS 钥匙串，请先执行 npm run capability:setup。");
  }
  return token;
}

export function getTailscaleDnsName(options = {}) {
  const status = capture("tailscale", ["status", "--json"]);
  const parsed = parseJson(status.stdout);
  const dnsName = typeof parsed?.Self?.DNSName === "string"
    ? parsed.Self.DNSName.replace(/\.+$/, "")
    : "";
  if (options.required && (!status.ok || !dnsName)) {
    throw new Error("无法取得当前 Mac 的 Tailscale DNS 地址。");
  }
  return dnsName;
}

export function isTailscaleConnected(value) {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  return parsed?.BackendState === "Running";
}

export function getCapabilityBridgePublicUrl(options = {}) {
  const dnsName = getTailscaleDnsName(options);
  return dnsName
    ? `https://${dnsName}:${CAPABILITY_FUNNEL_PORT}/api/capability-bridge`
    : "";
}

export function inspectCapabilityFunnel(value) {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  const web = parsed && typeof parsed === "object" && parsed.Web && typeof parsed.Web === "object"
    ? parsed.Web
    : {};
  const allowFunnel = parsed && typeof parsed === "object" && parsed.AllowFunnel && typeof parsed.AllowFunnel === "object"
    ? parsed.AllowFunnel
    : {};
  const enabledAuthorities = Object.entries(allowFunnel)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([authority]) => authority);
  const expectedAuthority = enabledAuthorities.find((authority) => authority.endsWith(`:${CAPABILITY_FUNNEL_PORT}`)) || "";
  const expectedProxy = expectedAuthority
    ? web?.[expectedAuthority]?.Handlers?.["/"]?.Proxy
    : "";
  const unexpectedAuthorities = enabledAuthorities.filter((authority) => !authority.endsWith(`:${CAPABILITY_FUNNEL_PORT}`));
  return {
    configured: Boolean(expectedAuthority && expectedProxy === `http://127.0.0.1:${CAPABILITY_GATEWAY_PORT}`),
    unexpectedAuthorities,
    expectedAuthority,
    expectedProxy: typeof expectedProxy === "string" ? expectedProxy : ""
  };
}

async function setup() {
  if (process.platform !== "darwin") throw new Error("当前 Mac 能力桥只支持 macOS。");
  assertCommand("tailscale", "未检测到 Tailscale。");
  ensureTailscaleConnected();
  const token = ensureCapabilityBridgeSecret();
  if (token.length < 32) throw new Error("生成的能力桥令牌不符合强度要求。");

  const before = capture("tailscale", ["funnel", "status", "--json"]);
  const inspection = inspectCapabilityFunnel(before.stdout);
  if (inspection.unexpectedAuthorities.length) {
    throw new Error("检测到其他 Tailscale Funnel 公网入口，未自动覆盖；请先人工确认现有配置。");
  }
  if (inspection.expectedAuthority && inspection.expectedProxy && !inspection.configured) {
    throw new Error(`Tailscale ${CAPABILITY_FUNNEL_PORT} 端口已被其他服务占用，未自动覆盖。`);
  }

  const funnel = capture("tailscale", [
    "funnel",
    "--bg",
    `--https=${CAPABILITY_FUNNEL_PORT}`,
    "--yes",
    `http://127.0.0.1:${CAPABILITY_GATEWAY_PORT}`
  ]);
  if (!funnel.ok) {
    throw new Error(`配置能力桥 Funnel 失败：${summarize(funnel.stderr || funnel.stdout)}`);
  }
  const after = capture("tailscale", ["funnel", "status", "--json"]);
  const afterInspection = inspectCapabilityFunnel(after.stdout);
  if (!afterInspection.configured || afterInspection.unexpectedAuthorities.length) {
    throw new Error("能力桥 Funnel 配置未通过安全检查。");
  }

  console.log(JSON.stringify({
    configured: true,
    keychainConfigured: true,
    publicUrl: getCapabilityBridgePublicUrl({ required: true }),
    publicPort: CAPABILITY_FUNNEL_PORT,
    localGatewayPort: CAPABILITY_GATEWAY_PORT
  }, null, 2));
}

async function status() {
  const token = readCapabilityBridgeSecret();
  const url = getCapabilityBridgePublicUrl();
  const tailscale = capture("tailscale", ["status", "--json"]);
  const funnel = capture("tailscale", ["funnel", "status", "--json"]);
  const inspection = inspectCapabilityFunnel(funnel.stdout);
  const gateway = token
    ? await fetchBridgeHealth(`http://127.0.0.1:${CAPABILITY_GATEWAY_PORT}/api/capability-bridge`, token)
    : { ok: false, status: 0, operations: [], error: "钥匙串令牌未配置" };
  console.log(JSON.stringify({
    keychainConfigured: token.length >= 32,
    tailscaleConnected: tailscale.ok && isTailscaleConnected(tailscale.stdout),
    funnelConfigured: funnel.ok && inspection.configured,
    unexpectedFunnelAuthorities: inspection.unexpectedAuthorities,
    gateway,
    publicUrl: url
  }, null, 2));
}

function ensureCapabilityBridgeSecret() {
  const current = readCapabilityBridgeSecret();
  if (current.length >= 32) return current;
  const token = crypto.randomBytes(32).toString("base64url");
  const result = capture("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-s", CAPABILITY_KEYCHAIN_SERVICE,
    "-a", CAPABILITY_KEYCHAIN_ACCOUNT,
    "-w", token
  ]);
  if (!result.ok) throw new Error("无法将能力桥令牌写入 macOS 钥匙串。");
  return token;
}

function ensureTailscaleConnected() {
  const status = capture("tailscale", ["status", "--json"]);
  if (status.ok && isTailscaleConnected(status.stdout)) return;
  const up = capture("tailscale", ["up"]);
  if (!up.ok) throw new Error(`Tailscale 启动失败：${summarize(up.stderr || up.stdout)}`);
  const connected = capture("tailscale", ["status", "--json"]);
  if (!connected.ok || !isTailscaleConnected(connected.stdout)) {
    throw new Error("Tailscale 尚未连接，请先在当前 Mac 完成登录并启动。");
  }
}

async function fetchBridgeHealth(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok && body?.ok === true,
      status: response.status,
      operations: Array.isArray(body?.operations) ? body.operations.filter((value) => typeof value === "string") : [],
      error: response.ok ? undefined : typeof body?.error === "string" ? body.error : `HTTP ${response.status}`
    };
  } catch (error) {
    return { ok: false, status: 0, operations: [], error: error instanceof Error ? error.message : "连接失败" };
  } finally {
    clearTimeout(timer);
  }
}

function assertCommand(name, message) {
  if (!capture("/usr/bin/env", ["which", name]).ok) throw new Error(message);
}

function capture(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function summarize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500) || "未知错误";
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    if (command === "setup") await setup();
    else if (command === "status") await status();
    else throw new Error("用法：node scripts/capability-bridge-service.mjs <setup|status>");
  } catch (error) {
    console.error(`当前 Mac 能力桥错误：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
