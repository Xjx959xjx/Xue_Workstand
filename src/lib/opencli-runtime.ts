import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const HIDDEN_CHILD_PROCESS_OPTIONS = { windowsHide: true };

type OpenCliBrowserWindowMode = "foreground" | "background";

export type OpenCliTimingMeta = Record<string, string | number | boolean | null | undefined>;
export type OpenCliTimingEntry = {
  stage: string;
  ms: number;
  ok: boolean;
  meta?: OpenCliTimingMeta;
  error?: string;
};
export type OpenCliTimingSink = (entry: OpenCliTimingEntry) => void;

export type OpenCliTimingOptions = {
  timingMeta?: OpenCliTimingMeta;
  onTiming?: OpenCliTimingSink;
  signal?: AbortSignal;
};

export type RunOpenCliOptions = OpenCliTimingOptions & {
  timeout?: number;
  timingStage?: string;
};

export function opencliBin() {
  return process.env.OPENCLI_BIN || "opencli";
}

export function resolveOpenCliCommand() {
  const configured = opencliBin().trim() || "opencli";
  const scriptPath = process.env.OPENCLI_SCRIPT?.trim() || "";
  const nodeBin = process.env.OPENCLI_NODE_BIN?.trim() || process.execPath;

  if (scriptPath) {
    return {
      command: nodeBin,
      argsPrefix: [scriptPath]
    };
  }

  return {
    command: configured,
    argsPrefix: []
  };
}

export async function runOpenCli(args: string[], options: RunOpenCliOptions = {}) {
  let stdout: string;
  let stderr: string;
  const runtime = resolveOpenCliCommand();
  const startedAt = Date.now();
  let timingRecorded = false;

  try {
    const result = await execFileAsync(runtime.command, [...runtime.argsPrefix, ...args], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      maxBuffer: 1024 * 1024 * 20,
      timeout: options.timeout,
      signal: options.signal
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    recordTiming(options, startedAt, false, undefined, error);
    throw wrapOpenCliError(error);
  }

  if (stderr && stderr.toLowerCase().includes("error")) {
    const error = new Error(stderr.trim());
    recordTiming(options, startedAt, false, undefined, error);
    timingRecorded = true;
    throw error;
  }

  if (!timingRecorded) recordTiming(options, startedAt, true);
  return stdout.trim();
}

export async function timeOpenCliOperation<T>(
  options: OpenCliTimingOptions | undefined,
  stage: string,
  operation: () => Promise<T>,
  meta?: OpenCliTimingMeta
) {
  const startedAt = Date.now();
  try {
    const result = await operation();
    options?.onTiming?.(makeTimingEntry(stage, Date.now() - startedAt, true, mergeTimingMeta(options.timingMeta, meta)));
    return result;
  } catch (error) {
    options?.onTiming?.(makeTimingEntry(stage, Date.now() - startedAt, false, mergeTimingMeta(options?.timingMeta, meta), error));
    throw error;
  }
}

export function mergeTimingMeta(...metas: Array<OpenCliTimingMeta | undefined>) {
  const merged: OpenCliTimingMeta = {};
  for (const meta of metas) {
    if (!meta) continue;
    for (const [key, value] of Object.entries(meta)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

export function withTimingMeta(options: OpenCliTimingOptions | undefined, meta: OpenCliTimingMeta): OpenCliTimingOptions {
  return {
    onTiming: options?.onTiming,
    timingMeta: mergeTimingMeta(options?.timingMeta, meta),
    signal: options?.signal
  };
}

export function buildOpenCliBrowserArgs(
  session: string,
  command: string,
  commandArgs: string[] = [],
  options: {
    tab?: string;
    window?: OpenCliBrowserWindowMode;
  } = {}
) {
  const args = ["browser", session];
  if (options.window) {
    args.push("--window", options.window);
  }
  args.push(command);
  if (options.tab) {
    args.push("--tab", options.tab);
  }
  args.push(...commandArgs);
  return args;
}

export function parseOpenCliJsonish(stdout: string): unknown {
  return parseJsonish(stdout);
}

export function openCliRows(raw: unknown): unknown[] {
  return asArray(raw);
}

export function parseJsonish(stdout: string): unknown {
  if (!stdout) return [];
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

export function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    for (const key of ["data", "items", "results", "videos", "list", "users", "user_list"]) {
      if (Array.isArray(object[key])) return object[key] as unknown[];
    }
  }
  return [];
}

export function stringField(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function recordTiming(
  options: RunOpenCliOptions,
  startedAt: number,
  ok: boolean,
  meta?: OpenCliTimingMeta,
  error?: unknown
) {
  if (!options.timingStage || !options.onTiming) return;
  options.onTiming(makeTimingEntry(options.timingStage, Date.now() - startedAt, ok, mergeTimingMeta(options.timingMeta, meta), error));
}

function makeTimingEntry(
  stage: string,
  ms: number,
  ok: boolean,
  meta?: OpenCliTimingMeta,
  error?: unknown
): OpenCliTimingEntry {
  const entry: OpenCliTimingEntry = {
    stage,
    ms,
    ok
  };
  const cleanMeta = compactTimingMeta(meta);
  if (cleanMeta) entry.meta = cleanMeta;
  const message = formatTimingError(error);
  if (message) entry.error = message;
  return entry;
}

function compactTimingMeta(meta: OpenCliTimingMeta | undefined) {
  if (!meta) return undefined;
  const clean: OpenCliTimingMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) clean[key] = value;
  }
  return Object.keys(clean).length ? clean : undefined;
}

function formatTimingError(error: unknown) {
  if (!error) return "";
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 220);
}

function wrapOpenCliError(error: unknown) {
  if (isMissingExecutableError(error)) {
    return new Error("未检测到 opencli。数据维护 / 数据监控页面可以继续使用，但实时刷新 B站/抖音数据前请先运行 install-deps.cmd 安装 opencli。");
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error("opencli 执行失败");
}

function isMissingExecutableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? String((error as { message?: unknown }).message || "") : "";
  return code === "ENOENT" || /not found|enoent/i.test(message);
}
