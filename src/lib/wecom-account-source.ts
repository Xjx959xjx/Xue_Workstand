import { execFile } from "child_process";
import { promisify } from "util";
import type { GrossMarginAccountPrice } from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CONTENT_POLL_ATTEMPTS = 12;
const MAX_COMMAND_ATTEMPTS = 3;
const COMMAND_RETRY_BASE_DELAY_MS = 400;

export type AccountSourceResult = {
  accounts: GrossMarginAccountPrice[];
  source: "wecom" | "local";
  warning?: string;
  fetchedAt?: string;
  refreshing?: boolean;
};

type WecomResponse = {
  errcode?: number;
  errmsg?: string;
  task_id?: string;
  task_done?: boolean;
  content?: string;
};

let cachedResult: AccountSourceResult | null = null;
let refreshPromise: Promise<AccountSourceResult> | null = null;
let lastRefreshError = "";

export async function resolveGrossMarginAccounts(
  localAccounts: GrossMarginAccountPrice[],
  options: {
    persisted?: AccountSourceResult | null;
    refresh?: boolean;
    onFresh?: (result: AccountSourceResult) => Promise<void>;
  } = {}
): Promise<AccountSourceResult> {
  const url = process.env.WECOM_ACCOUNT_SHEET_URL?.trim();
  if (!url) {
    return { accounts: localAccounts, source: "local" };
  }

  if (!cachedResult && options.persisted?.source === "wecom" && options.persisted.accounts.length) {
    cachedResult = {
      accounts: options.persisted.accounts,
      source: "wecom",
      fetchedAt: options.persisted.fetchedAt
    };
  }

  const now = Date.now();
  if (cachedResult?.source === "wecom" && cachedResult.fetchedAt) {
    const fetchedAt = Date.parse(cachedResult.fetchedAt);
    if (!options.refresh && Number.isFinite(fetchedAt) && now - fetchedAt < cacheTtlMs()) return cachedResult;
  }

  if (options.refresh) {
    try {
      return await refreshGrossMarginAccounts(url, options.onFresh);
    } catch (error) {
      return resolveRefreshFailure(error, localAccounts);
    }
  }

  void refreshGrossMarginAccounts(url, options.onFresh).catch((error) => {
    const detail = sanitizeWecomError(error instanceof Error ? error.message : "未知错误");
    lastRefreshError = detail;
    console.warn(`[gross-margin-accounts] 在线账号表后台同步失败：${detail}`);
  });

  if (cachedResult?.source === "wecom" && cachedResult.accounts.length) {
    return {
      ...cachedResult,
      refreshing: true,
      warning: lastRefreshError
        ? `在线账号表后台同步失败，当前展示上次成功缓存：${lastRefreshError}`
        : "正在后台同步企业微信账号表，当前先展示上次成功缓存。"
    };
  }

  return {
    accounts: localAccounts,
    source: "local",
    refreshing: true,
    warning: lastRefreshError
      ? `在线账号表后台同步失败，当前使用本地账号缓存：${lastRefreshError}`
      : "正在后台同步企业微信账号表，当前先展示本地账号缓存。"
  };
}

function refreshGrossMarginAccounts(
  url: string,
  onFresh?: (result: AccountSourceResult) => Promise<void>
) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const content = await fetchWecomSheetContent(url);
    const accounts = parseWecomAccountSheet(content);
    if (!accounts.length) throw new Error("在线表没有识别到抖音或 B 站账号");
    const result: AccountSourceResult = {
      accounts,
      source: "wecom",
      fetchedAt: new Date().toISOString()
    };
    cachedResult = result;
    lastRefreshError = "";
    await onFresh?.(result);
    return result;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function resolveRefreshFailure(error: unknown, localAccounts: GrossMarginAccountPrice[]): AccountSourceResult {
  const detail = sanitizeWecomError(error instanceof Error ? error.message : "未知错误");
  lastRefreshError = detail;
  if (process.env.WECOM_ACCOUNT_SHEET_FALLBACK_LOCAL === "0") {
    throw new Error(`读取企业微信账号表失败：${detail}`);
  }
  const warning = cachedResult?.source === "wecom"
    ? `在线账号表同步失败，当前展示上次成功缓存：${detail}`
    : `在线账号表同步失败，当前使用本地账号缓存：${detail}`;
  console.warn(`[gross-margin-accounts] ${warning}`);
  return cachedResult?.source === "wecom" && cachedResult.accounts.length
    ? { ...cachedResult, warning }
    : { accounts: localAccounts, source: "local", warning };
}

async function fetchWecomSheetContent(url: string) {
  const first = await callWecomDoc({ url, type: 2 });
  let response = first;
  for (let attempt = 0; attempt < MAX_CONTENT_POLL_ATTEMPTS && !response.task_done; attempt += 1) {
    if (!response.task_id) throw new Error("企业微信表格内容任务缺少 task_id");
    await wait(250);
    response = await callWecomDoc({ url, type: 2, task_id: response.task_id });
  }
  if (!response.task_done || typeof response.content !== "string") {
    throw new Error("企业微信表格读取超时");
  }
  return response.content;
}

async function callWecomDoc(input: Record<string, unknown>): Promise<WecomResponse> {
  const command = process.env.WECOM_CLI_BIN?.trim() || "wecom-cli";
  let stdout = "";
  for (let attempt = 0; attempt < MAX_COMMAND_ATTEMPTS; attempt += 1) {
    try {
      const result = await execFileAsync(command, ["doc", "get_doc_content", "--json", JSON.stringify(input)], {
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
        timeout: timeoutMs()
      });
      stdout = result.stdout;
      break;
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new Error(`未检测到 ${command}，请先安装并登录 wecom-cli`);
      }
      if (isRetryableWecomError(error) && attempt < MAX_COMMAND_ATTEMPTS - 1) {
        await wait(COMMAND_RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new Error(`wecom-cli 执行失败：${formatWecomError(error)}`);
    }
  }

  let outer: unknown;
  try {
    outer = JSON.parse(stdout.trim());
  } catch {
    throw new Error("wecom-cli 返回了无法解析的结果");
  }
  const text = getTextContent(outer);
  if (!text) throw new Error("wecom-cli 没有返回表格内容");

  let response: WecomResponse;
  try {
    response = JSON.parse(text) as WecomResponse;
  } catch {
    throw new Error("wecom-cli 返回了无法解析的表格响应");
  }
  if (response.errcode && response.errcode !== 0) {
    throw new Error(response.errmsg ? sanitizeWecomError(response.errmsg) : `企业微信接口错误 ${response.errcode}`);
  }
  return response;
}

function getTextContent(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const result = (value as { result?: unknown }).result;
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const text = content.find((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text");
  return text && typeof (text as { text?: unknown }).text === "string" ? (text as { text: string }).text : "";
}

function parseWecomAccountSheet(markdown: string): GrossMarginAccountPrice[] {
  const accounts: GrossMarginAccountPrice[] = [];
  let section = "";
  let headers: Record<string, number> | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "抖音" || trimmed === "B站" || trimmed === "快手") {
      section = trimmed;
      headers = null;
      continue;
    }
    if (!trimmed.startsWith("|")) continue;
    const cells = splitMarkdownRow(trimmed);
    if (!headers && cells.includes("账号昵称")) {
      headers = Object.fromEntries(cells.map((cell, index) => [cell, index]));
      continue;
    }
    if (!headers || !cells.length) continue;

    const platform = cell(cells, headers, "平台") || section;
    const name = cell(cells, headers, "账号昵称");
    if (!name || (platform !== "抖音" && platform !== "B站")) continue;

    const account = platform === "抖音" ? parseDouyinAccount(cells, headers, name) : parseBilibiliAccount(cells, headers, name);
    if (account) accounts.push(account);
  }

  return accounts;
}

function parseDouyinAccount(cells: string[], headers: Record<string, number>, name: string): GrossMarginAccountPrice | null {
  const douyinId = cell(cells, headers, "抖音ID");
  const defaultPrice = parseMoney(cell(cells, headers, "21-60秒报价;（含税不含平台费）"));
  const secondaryPrice = parseMoney(cell(cells, headers, "60秒+报价;（含税不含平台费）"));
  if (!douyinId || defaultPrice === null || secondaryPrice === null) return null;
  return {
    platform: "douyin",
    name,
    defaultPrice,
    priceLabel: "20-60秒报价",
    secondaryPrice,
    secondaryPriceLabel: "60秒+报价",
    douyinId,
    cooperationCode: cell(cells, headers, "抖音合作码;（先填现在的 有更新再喊）") || undefined,
    homepage: parseLink(cell(cells, headers, "主页链接")) || undefined
  };
}

function parseBilibiliAccount(cells: string[], headers: Record<string, number>, name: string): GrossMarginAccountPrice | null {
  const bilibiliUid = cell(cells, headers, "UID").replace(/^;/, "");
  const implantPrice = parseMoney(cell(cells, headers, "植入视频报价;（含税不含平台费）"));
  const customPrice = parseMoney(cell(cells, headers, "定制视频报价;（含税不含平台费）"));
  if (!bilibiliUid || implantPrice === null || customPrice === null) return null;
  return {
    platform: "bilibili",
    name,
    defaultPrice: customPrice,
    priceLabel: "定制报价",
    secondaryPrice: implantPrice,
    secondaryPriceLabel: "植入报价",
    bilibiliUid,
    homepage: parseLink(cell(cells, headers, "主页链接")) || undefined
  };
}

function splitMarkdownRow(line: string) {
  return line
    .slice(1, line.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((cellValue) => cellValue.trim());
}

function cell(cells: string[], headers: Record<string, number>, header: string) {
  return cells[headers[header]]?.trim() || "";
}

function parseMoney(value: string) {
  const normalized = value.replace(/[,￥¥\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseLink(value: string) {
  const match = value.match(/\[[^\]]*\]\(([^)]+)\)/);
  return match?.[1]?.trim() || value.trim();
}

function timeoutMs() {
  const parsed = Number.parseInt(process.env.WECOM_ACCOUNT_SHEET_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(parsed, 120_000)) : DEFAULT_TIMEOUT_MS;
}

function cacheTtlMs() {
  const parsed = Number.parseInt(process.env.WECOM_ACCOUNT_SHEET_CACHE_TTL_MS || "", 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 60 * 60 * 1000)) : DEFAULT_CACHE_TTL_MS;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isMissingExecutable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "ENOENT";
}

function isRetryableWecomError(error: unknown) {
  return /MCP网络请求失败|error sending request|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network/i.test(
    getWecomErrorText(error)
  );
}

function formatWecomError(error: unknown) {
  const detail = sanitizeWecomError(getWecomErrorText(error));
  if (/authorization expired/i.test(detail)) {
    return "企业微信授权已过期，请重新运行 wecom-cli init";
  }
  if (/MCP网络请求失败|error sending request/i.test(detail)) {
    return "企业微信 MCP 网络请求失败，请稍后重试";
  }
  const lines = detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred = lines.find((line) => /^Error:/i.test(line)) || lines.at(-1) || "命令执行失败";
  return preferred.replace(/^Error:\s*/i, "").slice(0, 500);
}

function getWecomErrorText(error: unknown) {
  if (!error || typeof error !== "object") return typeof error === "string" ? error : "命令执行失败";
  const stderr = "stderr" in error ? (error as { stderr?: unknown }).stderr : undefined;
  if (typeof stderr === "string" && stderr.trim()) return stderr;
  return error instanceof Error ? error.message : "命令执行失败";
}

function sanitizeWecomError(detail: string) {
  return detail
    .replace(/([?&]apikey=)[^&\s"'<>)}\]]+/gi, "$1[已隐藏]")
    .replace(/("apikey"\s*:\s*")[^"]+/gi, "$1[已隐藏]")
    .replace(/\b(apikey\s*[=:]\s*)[A-Za-z0-9._~-]+/gi, "$1[已隐藏]");
}
