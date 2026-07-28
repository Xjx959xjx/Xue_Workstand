import { execFile } from "child_process";
import { promisify } from "util";
import type { GrossMarginAccountPrice } from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CONTENT_POLL_ATTEMPTS = 12;

type AccountSourceResult = {
  accounts: GrossMarginAccountPrice[];
  source: "wecom" | "local";
  warning?: string;
  fetchedAt?: string;
};

type WecomResponse = {
  errcode?: number;
  errmsg?: string;
  task_id?: string;
  task_done?: boolean;
  content?: string;
};

let cachedResult: AccountSourceResult | null = null;

export async function resolveGrossMarginAccounts(localAccounts: GrossMarginAccountPrice[]): Promise<AccountSourceResult> {
  const url = process.env.WECOM_ACCOUNT_SHEET_URL?.trim();
  if (!url) {
    return { accounts: localAccounts, source: "local" };
  }

  const now = Date.now();
  if (cachedResult?.source === "wecom" && cachedResult.fetchedAt) {
    const fetchedAt = Date.parse(cachedResult.fetchedAt);
    if (Number.isFinite(fetchedAt) && now - fetchedAt < cacheTtlMs()) return cachedResult;
  }

  try {
    const content = await fetchWecomSheetContent(url);
    const accounts = parseWecomAccountSheet(content);
    if (!accounts.length) throw new Error("在线表没有识别到抖音或 B 站账号");
    cachedResult = {
      accounts,
      source: "wecom",
      fetchedAt: new Date().toISOString()
    };
    return cachedResult;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    const warning = `在线账号表同步失败，当前使用本地账号缓存：${detail}`;
    if (process.env.WECOM_ACCOUNT_SHEET_FALLBACK_LOCAL === "0") {
      throw new Error(`读取企业微信账号表失败：${detail}`);
    }
    console.warn(`[gross-margin-accounts] ${warning}`);
    const result = { accounts: localAccounts, source: "local" as const, warning };
    cachedResult = result;
    return result;
  }
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
  try {
    const result = await execFileAsync(command, ["doc", "get_doc_content", "--json", JSON.stringify(input)], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      timeout: timeoutMs()
    });
    stdout = result.stdout;
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new Error(`未检测到 ${command}，请先安装并登录 wecom-cli`);
    }
    const detail = error instanceof Error ? error.message : "命令执行失败";
    throw new Error(`wecom-cli 执行失败：${detail}`);
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
    throw new Error(response.errmsg || `企业微信接口错误 ${response.errcode}`);
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
