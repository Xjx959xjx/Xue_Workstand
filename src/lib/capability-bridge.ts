import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { promises as dns } from "dns";
import { promises as fs } from "fs";
import { isIP } from "net";
import { z } from "zod";
import { publishFeishuDocument, fetchFeishuSupportDocuments } from "./feishu";
import { analyzeCopySourceMaterial } from "./material-analysis";
import { runOpenCli } from "./opencli-runtime";
import { REMOTE_CAPABILITY_OPERATIONS } from "./remote-capabilities";
import { callLocalWecomDocumentCommand } from "./support-documents";
import {
  prepareLinkSourceDownload,
  resolveLinkSourceMedia,
  transcribeLinkSource,
  transcribeStandaloneVideo,
  type LinkSourceDownloadAsset
} from "./transcription";
import { platforms } from "./types";

const bridgeEnvelopeSchema = z.object({
  operation: z.enum(REMOTE_CAPABILITY_OPERATIONS),
  payload: z.unknown()
}).strict();

const openCliSchema = z.object({
  args: z.array(z.string().max(4096)).min(1).max(128)
}).strict();

const materialAnalysisSchema = z.object({
  mediaUrls: z.array(z.string().url()).max(4),
  platform: z.enum([...platforms, "unknown"]),
  title: z.string().max(1000).optional(),
  transcript: z.string().max(500_000),
  url: z.string().url()
}).strict();

const transcribeVideoSchema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1).max(240),
  videoId: z.string().min(1).max(500),
  mediaUrl: z.string().url().optional(),
  douyinMediaUrl: z.string().url().optional(),
  allowRemoteDownload: z.boolean().optional()
}).strict();

const transcribeLinkSchema = z.object({
  url: z.string().url(),
  titleHint: z.string().max(1000).optional(),
  analyzeVideo: z.boolean().optional()
}).strict();

const linkMediaSchema = z.object({
  url: z.string().url(),
  resolvedUrl: z.string().url().optional(),
  platform: z.enum([...platforms, "unknown"]).optional()
}).strict();

const linkDownloadSchema = z.object({
  url: z.string().url(),
  kind: z.enum(["video", "cover", "audio"])
}).strict();

const feishuPublishSchema = z.object({
  title: z.string().min(1).max(1000),
  content: z.string().min(1).max(1_500_000)
}).strict();

const feishuReadSchema = z.object({
  url: z.string().min(1).max(4000)
}).strict();

const wecomSchema = z.object({
  method: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  input: z.record(z.string(), z.unknown())
}).strict();

type BridgeOperation = typeof REMOTE_CAPABILITY_OPERATIONS[number];
type BridgeAsset = {
  assetId: string;
  downloadTokenHash: Buffer;
  filePath: string;
  cleanupTargets: string[];
  fileName: string;
  contentType: string;
  byteLength: number;
  expiresAt: number;
  claimed: boolean;
};

const assets = new Map<string, BridgeAsset>();
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_ASSET_TTL_MS = 10 * 60 * 1000;

export class CapabilityBridgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CapabilityBridgeError";
  }
}

export function getCapabilityBridgeStatus() {
  return {
    enabled: !isCloudRuntime() && Boolean(bridgeToken()),
    cloudRuntime: isCloudRuntime(),
    tokenConfigured: Boolean(bridgeToken()),
    publicUrlConfigured: Boolean(process.env.SITES_CAPABILITY_BRIDGE_PUBLIC_URL?.trim()),
    operations: [...REMOTE_CAPABILITY_OPERATIONS]
  };
}

export async function handleCapabilityBridgePost(request: Request) {
  assertLocalBridgeRuntime();
  authenticateBridgeRequest(request);
  const text = await readBoundedRequestBody(request);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CapabilityBridgeError("请求正文不是有效 JSON。", 400);
  }
  const envelope = parseSchema(bridgeEnvelopeSchema, raw, "远程能力请求格式不正确");
  const controller = createBridgeAbortController(request.signal);

  try {
    return await dispatchCapability(envelope.operation, envelope.payload, {
      signal: controller.signal,
      requestUrl: request.url
    });
  } finally {
    controller.clear();
  }
}

export function authenticateBridgeRequest(request: Request) {
  const expected = bridgeToken();
  if (!expected) {
    throw new CapabilityBridgeError("远程能力服务未配置 SITES_CAPABILITY_BRIDGE_TOKEN。", 503);
  }
  if (expected.length < 32) {
    throw new CapabilityBridgeError("SITES_CAPABILITY_BRIDGE_TOKEN 至少需要 32 个字符。", 503);
  }
  const value = request.headers.get("authorization") || "";
  const provided = value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!provided || !safeTokenEqual(provided, expected)) {
    throw new CapabilityBridgeError("远程能力服务鉴权失败。", 401);
  }
}

export function formatCapabilityBridgeError(error: unknown) {
  if (error instanceof CapabilityBridgeError) {
    return { status: error.status, error: sanitizeBridgeError(error.message) };
  }
  if (error instanceof z.ZodError) {
    return { status: 400, error: "远程能力请求参数不正确。" };
  }
  const message = error instanceof Error ? error.message : "远程能力执行失败";
  return { status: 500, error: sanitizeBridgeError(message) || "远程能力执行失败" };
}

export async function takeCapabilityBridgeAsset(assetId: string, authorization: string | null) {
  assertLocalBridgeRuntime();
  await pruneExpiredAssets();
  const asset = assets.get(assetId);
  if (!asset || asset.expiresAt <= Date.now() || asset.claimed) {
    throw new CapabilityBridgeError("下载文件不存在或已过期。", 404);
  }
  const provided = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!provided || !safeHashEqual(hashToken(provided), asset.downloadTokenHash)) {
    throw new CapabilityBridgeError("下载文件鉴权失败。", 401);
  }
  asset.claimed = true;
  return asset;
}

export async function cleanupCapabilityBridgeAsset(asset: BridgeAsset) {
  assets.delete(asset.assetId);
  await Promise.all(
    [...new Set(asset.cleanupTargets.filter(Boolean))].map((target) =>
      fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
    )
  );
}

async function dispatchCapability(
  operation: BridgeOperation,
  payload: unknown,
  context: { signal: AbortSignal; requestUrl: string }
) {
  switch (operation) {
    case "opencli": {
      const input = parseSchema(openCliSchema, payload, "OpenCLI 参数不正确");
      return {
        stdout: await runOpenCli(input.args, {
          signal: context.signal,
          timeout: bridgeTimeoutMs(),
          timingStage: "sites-capability-opencli"
        })
      };
    }
    case "material-analysis": {
      const input = parseSchema(materialAnalysisSchema, payload, "素材分析参数不正确");
      await Promise.all(input.mediaUrls.map(assertPublicHttpUrl));
      return analyzeCopySourceMaterial({ ...input, signal: context.signal });
    }
    case "transcribe-video": {
      const input = parseSchema(transcribeVideoSchema, payload, "视频转写参数不正确");
      for (const url of [input.mediaUrl, input.douyinMediaUrl].filter(Boolean) as string[]) {
        await assertPublicHttpUrl(url);
      }
      return transcribeStandaloneVideo({
        platform: input.platform,
        videoId: input.videoId,
        mediaUrl: input.mediaUrl,
        douyinMediaUrl: input.douyinMediaUrl,
        signal: context.signal
      });
    }
    case "transcribe-link": {
      const input = parseSchema(transcribeLinkSchema, payload, "链接转写参数不正确");
      await assertPublicHttpUrl(input.url);
      return transcribeLinkSource({ ...input, signal: context.signal });
    }
    case "link-media": {
      const input = parseSchema(linkMediaSchema, payload, "媒体解析参数不正确");
      await assertPublicHttpUrl(input.url);
      if (input.resolvedUrl) await assertPublicHttpUrl(input.resolvedUrl);
      return resolveLinkSourceMedia({ ...input, signal: context.signal });
    }
    case "link-download": {
      const input = parseSchema(linkDownloadSchema, payload, "媒体下载参数不正确");
      await assertPublicHttpUrl(input.url);
      const asset = await prepareLinkSourceDownload(input, { signal: context.signal });
      return exposeCapabilityDownloadAsset(asset, context.requestUrl);
    }
    case "feishu-publish": {
      const input = parseSchema(feishuPublishSchema, payload, "飞书发布参数不正确");
      return publishFeishuDocument(input);
    }
    case "feishu-doc-read": {
      const input = parseSchema(feishuReadSchema, payload, "飞书文档参数不正确");
      const [document] = await fetchFeishuSupportDocuments(input.url, { signal: context.signal });
      if (!document?.content?.trim()) {
        throw new Error(document?.error || "飞书文档服务没有返回可用正文。");
      }
      return { title: document.title, content: document.content };
    }
    case "wecom-doc": {
      const input = parseSchema(wecomSchema, payload, "企业微信文档参数不正确");
      return callLocalWecomDocumentCommand(input.method, input.input, { signal: context.signal });
    }
  }
}

export async function exposeCapabilityDownloadAsset(asset: LinkSourceDownloadAsset, requestUrl: string) {
  if (asset.remoteUrl) {
    return {
      kind: asset.kind,
      fileName: asset.fileName,
      contentType: asset.contentType,
      remoteUrl: asset.remoteUrl,
      requestHeaders: asset.requestHeaders
    };
  }
  if (!asset.filePath) throw new Error("本地媒体处理没有生成可下载文件。");
  const stats = await fs.stat(asset.filePath);
  const assetId = randomBytes(18).toString("base64url");
  const downloadToken = randomBytes(32).toString("base64url");
  const record: BridgeAsset = {
    assetId,
    downloadTokenHash: hashToken(downloadToken),
    filePath: asset.filePath,
    cleanupTargets: asset.cleanupTargets?.length ? asset.cleanupTargets : [asset.filePath],
    fileName: asset.fileName,
    contentType: asset.contentType,
    byteLength: stats.size,
    expiresAt: Date.now() + bridgeAssetTtlMs(),
    claimed: false
  };
  await pruneExpiredAssets();
  assets.set(assetId, record);
  const publicUrl = capabilityPublicUrl(requestUrl);
  return {
    kind: asset.kind,
    fileName: asset.fileName,
    contentType: asset.contentType,
    remoteUrl: `${publicUrl}/assets/${encodeURIComponent(assetId)}`,
    requestHeaders: {
      authorization: `Bearer ${downloadToken}`
    }
  };
}

async function readBoundedRequestBody(request: Request) {
  const limit = bridgeBodyLimit();
  const declaredLength = Number.parseInt(request.headers.get("content-length") || "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new CapabilityBridgeError(`请求正文超过 ${formatBytes(limit)} 上限。`, 413);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > limit) {
    throw new CapabilityBridgeError(`请求正文超过 ${formatBytes(limit)} 上限。`, 413);
  }
  return text;
}

function createBridgeAbortController(parentSignal: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, bridgeTimeoutMs());
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abort);
      if (timedOut) {
        throw new CapabilityBridgeError("远程能力执行超时。", 504);
      }
    }
  };
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, message: string) {
  const result = schema.safeParse(value);
  if (!result.success) throw new CapabilityBridgeError(message, 400);
  return result.data;
}

function assertLocalBridgeRuntime() {
  if (isCloudRuntime()) {
    throw new CapabilityBridgeError("远程能力执行入口不能运行在 Sites Worker 内。", 503);
  }
}

function isCloudRuntime() {
  return process.env.SITES_STORAGE_MODE === "cloud" || process.env.SITES_RUNTIME === "cloud";
}

function bridgeToken() {
  return process.env.SITES_CAPABILITY_BRIDGE_TOKEN?.trim() || "";
}

function capabilityPublicUrl(requestUrl: string) {
  const configured = process.env.SITES_CAPABILITY_BRIDGE_PUBLIC_URL?.trim();
  const value = (configured || new URL(requestUrl).origin + "/api/capability-bridge").replace(/\/+$/, "");
  const parsed = new URL(value);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new CapabilityBridgeError("SITES_CAPABILITY_BRIDGE_PUBLIC_URL 必须使用 HTTPS。", 503);
  }
  return value;
}

function bridgeTimeoutMs() {
  return boundedEnvNumber("SITES_CAPABILITY_BRIDGE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 5_000, 30 * 60 * 1000);
}

function bridgeBodyLimit() {
  return boundedEnvNumber("SITES_CAPABILITY_BRIDGE_BODY_LIMIT_BYTES", DEFAULT_BODY_LIMIT, 64 * 1024, 8 * 1024 * 1024);
}

function bridgeAssetTtlMs() {
  return boundedEnvNumber("SITES_CAPABILITY_BRIDGE_ASSET_TTL_MS", DEFAULT_ASSET_TTL_MS, 60_000, 60 * 60 * 1000);
}

function boundedEnvNumber(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeTokenEqual(left: string, right: string) {
  return safeHashEqual(hashToken(left), hashToken(right));
}

function safeHashEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest();
}

async function pruneExpiredAssets() {
  const now = Date.now();
  const expired = [...assets.values()].filter((asset) => asset.expiresAt <= now);
  await Promise.all(expired.map(cleanupCapabilityBridgeAsset));
}

async function assertPublicHttpUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CapabilityBridgeError("远程媒体只支持 HTTP/HTTPS 链接。", 400);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new CapabilityBridgeError("远程媒体不能指向本机或内网地址。", 400);
  }
  const addresses = isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new CapabilityBridgeError("远程媒体不能指向本机或内网地址。", 400);
  }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1" || /^(?:fc|fd)/.test(normalized) || /^fe[89ab]/.test(normalized);
  }
  return true;
}

function sanitizeBridgeError(value: string) {
  const home = process.env.HOME?.trim();
  let text = value.replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g, "[已隐藏令牌]");
  if (home) text = text.split(home).join("[本地目录]");
  text = text.split(process.cwd()).join("[项目目录]");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, 1000);
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)}MB` : `${Math.round(bytes / 1024)}KB`;
}
