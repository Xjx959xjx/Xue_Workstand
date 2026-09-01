import { execFile } from "child_process";
import { constants as fsConstants, promises as fs } from "fs";
import { promisify } from "util";
import packageJson from "../../package.json";
import { getChatRuntimeConfig, getWebResearchCapability } from "./ai";
import { getImageRuntimeConfig } from "./cover";
import { getAppMode } from "./app-mode";
import { resolveOpenCliCommand } from "./opencli-runtime";
import { hasRemoteCapabilityBridge } from "./remote-capabilities";
import { libraryRoot } from "./storage";
import { isCloudStorageMode, storageFs } from "./storage/fs";
import type { RemoteServiceHealth, RemoteStatusResponse } from "./types";

const execFileAsync = promisify(execFile);
const startedAt = process.env.APP_STARTED_AT || new Date().toISOString();
const CACHE_TTL_MS = 60_000;

let cached: { expiresAt: number; value: RemoteStatusResponse } | null = null;
let pending: Promise<RemoteStatusResponse> | null = null;

export async function getRemoteStatus(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value;
  if (!options.fresh && pending) return pending;

  pending = buildRemoteStatus().then((value) => {
    cached = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value
    };
    return value;
  }).finally(() => {
    pending = null;
  });
  return pending;
}

async function buildRemoteStatus(): Promise<RemoteStatusResponse> {
  const chat = getChatRuntimeConfig();
  const webResearch = getWebResearchCapability();
  const image = getImageRuntimeConfig();
  const [storage, opencli, ffmpeg] = await Promise.all([
    checkStorage(),
    checkOpenCli(),
    isCloudStorageMode()
      ? Promise.resolve(hasRemoteCapabilityBridge()
        ? service("ok", "远程媒体处理能力已配置")
        : service("unavailable", "未配置远程媒体处理能力服务"))
      : checkCommand(process.env.FFMPEG_BIN || "ffmpeg", ["-version"], "ffmpeg")
  ]);
  const browserBridge = await checkBrowserBridge(opencli.status === "ok");
  const services = {
    storage,
    opencli,
    browserBridge,
    ffmpeg,
    chat: chat.configured
      ? service("ok", `已配置 ${chat.model}`)
      : service("unconfigured", "未配置对话模型"),
    image: image.configured
      ? service("ok", `已配置 ${image.model}`)
      : service("unconfigured", "未配置图片模型")
  } satisfies RemoteStatusResponse["services"];
  const degraded = Object.values(services).some((item) => item.status === "unavailable");

  return {
    app: {
      status: degraded ? "degraded" : "ok",
      version: packageJson.version,
      buildId: process.env.APP_BUILD_ID || `dev-${packageJson.version}`,
      startedAt,
      appMode: getAppMode()
    },
    services,
    capabilities: {
      webResearch
    },
    checkedAt: new Date().toISOString()
  };
}

async function checkStorage(): Promise<RemoteServiceHealth> {
  if (isCloudStorageMode()) {
    try {
      await storageFs.stat(libraryRoot());
      return service("ok", "Sites D1/R2 云存储已连接");
    } catch (error) {
      return service("unavailable", error instanceof Error ? error.message : "Sites D1/R2 云存储不可用");
    }
  }
  try {
    await fs.access(libraryRoot(), fsConstants.R_OK | fsConstants.W_OK);
    return service("ok", "本地素材库可读写");
  } catch {
    return service("unavailable", "本地素材库不可读写");
  }
}

async function checkOpenCli(): Promise<RemoteServiceHealth> {
  if (isCloudStorageMode()) {
    return hasRemoteCapabilityBridge()
      ? service("ok", "远程 OpenCLI 能力已配置")
      : service("unavailable", "未配置远程 OpenCLI 能力服务");
  }
  const runtime = resolveOpenCliCommand();
  return checkCommand(runtime.command, [...runtime.argsPrefix, "--version"], "OpenCLI");
}

async function checkBrowserBridge(openCliAvailable: boolean): Promise<RemoteServiceHealth> {
  if (!openCliAvailable) return service("unavailable", "OpenCLI 不可用，无法检查浏览器桥接");
  if (isCloudStorageMode()) return service("ok", "远程浏览器采集能力已配置");

  const runtime = resolveOpenCliCommand();
  try {
    const { stdout, stderr } = await execFileAsync(runtime.command, [...runtime.argsPrefix, "doctor"], {
      env: {
        ...process.env,
        OPENCLI_BROWSER_CONNECT_TIMEOUT: "1"
      },
      timeout: 2_500,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    const output = `${stdout}\n${stderr}`;
    if (/(?:Extension|Browser Bridge)[^\n]*(?:connected|已连接)|:\s*connected\b/i.test(output)) {
      return service("ok", "浏览器桥接已连接");
    }
    return service("unavailable", "浏览器桥接未连接，请保持 Chrome 扩展在线");
  } catch {
    return service("unavailable", "浏览器桥接未连接或检查超时");
  }
}

async function checkCommand(command: string, args: string[], label: string): Promise<RemoteServiceHealth> {
  try {
    await execFileAsync(command, args, {
      timeout: 2_500,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    return service("ok", `${label} 可用`);
  } catch {
    return service("unavailable", `${label} 不可用`);
  }
}

function service(status: RemoteServiceHealth["status"], message: string): RemoteServiceHealth {
  return { status, message };
}
