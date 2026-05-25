import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { extractLinksFromInput } from "./link-input";
import { resolveOpenCliCommand } from "./opencli";
import { clampText } from "./utils";

const execFileAsync = promisify(execFile);

type FeishuConfig = {
  folderToken: string;
  opencliBin: string;
  identity: string;
};

export type FeishuFetchedDocument = {
  url: string;
  title?: string;
  content?: string;
  error?: string;
};

function feishuConfig(): FeishuConfig {
  const runtime = resolveOpenCliCommand();
  return {
    folderToken: process.env.FEISHU_FOLDER_TOKEN || "",
    opencliBin: runtime.command,
    identity: process.env.FEISHU_OPENCLI_AS || "user"
  };
}

export function getFeishuRuntimeConfig() {
  const config = feishuConfig();
  return {
    configured: true,
    mode: "lark-cli" as const,
    opencliBin: config.opencliBin,
    identity: config.identity,
    folderConfigured: Boolean(config.folderToken)
  };
}

export async function checkFeishuRuntime() {
  const config = feishuConfig();
  try {
    const runtime = resolveOpenCliCommand();
    const { stdout, stderr } = await execFileAsync(config.opencliBin, [...runtime.argsPrefix, "lark-cli", "doctor", "--offline"], {
      maxBuffer: 1024 * 1024,
      timeout: 10000
    });
    return {
      ...getFeishuRuntimeConfig(),
      doctor: {
        ok: true,
        message: (stdout || stderr).trim()
      }
    };
  } catch (error) {
    return {
      ...getFeishuRuntimeConfig(),
      doctor: {
        ok: false,
        message: error instanceof Error ? error.message : "lark-cli doctor 检查失败"
      }
    };
  }
}

export async function publishFeishuDocument(input: { title: string; content: string }) {
  return publishWithOpenCli(feishuConfig(), input);
}

export async function fetchFeishuSupportDocuments(input: string) {
  const urls = uniqueFeishuDocUrls(input).slice(0, 4);
  if (!urls.length) return [];

  const config = feishuConfig();
  const documents: FeishuFetchedDocument[] = [];
  for (const url of urls) {
    documents.push(await fetchFeishuDocument(config, url));
  }
  return documents;
}

export function hasFeishuDocLink(input?: string) {
  return uniqueFeishuDocUrls(input || "").length > 0;
}

async function publishWithOpenCli(config: FeishuConfig, input: { title: string; content: string }) {
  const args = [
    "lark-cli",
    "docs",
    "+create",
    "--title",
    input.title || "写作台生成文档",
    "--markdown",
    "-",
    "--as",
    config.identity
  ];
  if (config.folderToken) args.push("--folder-token", config.folderToken);
  const runtime = resolveOpenCliCommand();

  const { stdout, stderr } = await spawnWithInput(config.opencliBin, [...runtime.argsPrefix, ...args], input.content, {
    maxBuffer: 1024 * 1024 * 20,
    timeout: 120000
  });
  const output = stdout.trim();
  const payload = parseJsonish(output);
  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested = data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : {};
  const documentId = String(nested.doc_id || nested.document_id || data.doc_id || data.document_id || "");
  const url = String(nested.doc_url || nested.url || data.doc_url || data.url || "");

  if (!documentId && !url) {
    throw new Error(`飞书文档创建失败：${stderr.trim() || output || "opencli 未返回文档链接"}`);
  }

  return {
    title: input.title,
    documentId,
    url: url || `https://www.feishu.cn/docx/${documentId}`
  };
}

async function fetchFeishuDocument(config: FeishuConfig, url: string): Promise<FeishuFetchedDocument> {
  const args = [
    "lark-cli",
    "docs",
    "+fetch",
    "--api-version",
    "v2",
    "--doc",
    url,
    "--doc-format",
    "markdown",
    "--detail",
    "simple",
    "--format",
    "json",
    "--as",
    config.identity
  ];
  const runtime = resolveOpenCliCommand();

  try {
    const { stdout, stderr } = await execFileAsync(config.opencliBin, [...runtime.argsPrefix, ...args], {
      maxBuffer: 1024 * 1024 * 20,
      timeout: 60000
    });
    const payload = parseJsonish(stdout.trim());
    const document = extractFetchedDocument(payload);
    if (!document.content.trim()) {
      return {
        url,
        title: document.title,
        error: stderr.trim() || "lark-cli 没有返回可用正文"
      };
    }
    return {
      url,
      title: document.title,
      content: clampText(document.content.trim(), 5000)
    };
  } catch (error) {
    return {
      url,
      error: summarizeFeishuFetchError(error)
    };
  }
}

function spawnWithInput(command: string, args: string[], input: string, options: { maxBuffer: number; timeout: number }) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("飞书文档创建超时"));
    }, options.timeout);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > options.maxBuffer) {
        child.kill("SIGTERM");
        finish(new Error("飞书文档创建输出过大"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > options.maxBuffer) {
        child.kill("SIGTERM");
        finish(new Error("飞书文档创建错误输出过大"));
      }
    });
    child.on("error", finish);
    child.on("close", (code) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(stderr.trim() || `飞书文档创建失败：lark-cli 退出码 ${code}`));
    });

    child.stdin.end(input);
  });
}

function uniqueFeishuDocUrls(input: string) {
  const urls = extractLinksFromInput(input)
    .map((link) => link.url)
    .filter(isFeishuDocUrl);
  return [...new Set(urls)];
}

function isFeishuDocUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!/(^|\.)feishu\.cn$|(^|\.)larksuite\.com$|(^|\.)feishu-boe\.cn$/i.test(host)) return false;
    return /\/(?:docx|docs|doc|wiki)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractFetchedDocument(payload: unknown) {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const document = data.document && typeof data.document === "object" ? (data.document as Record<string, unknown>) : data;
  return {
    title: stringValue(document.title || document.name || data.title || root.title),
    content: stringValue(document.content || data.content || root.content)
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function summarizeFeishuFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/timeout|ETIMEDOUT|timed out/i.test(message)) return "lark-cli 读取超时";
  if (/permission|forbidden|403|unauthorized|401|无权限|权限/i.test(message)) return "当前 lark-cli 身份没有文档权限";
  if (/not found|404|不存在/i.test(message)) return "文档不存在或链接无效";
  if (/not found: opencli|ENOENT/i.test(message)) return "没有找到 opencli，请检查 OPENCLI_BIN";
  return message || "lark-cli 读取失败";
}

function parseJsonish(output: string): unknown {
  if (!output) return {};
  try {
    return JSON.parse(output);
  } catch {
    const firstBrace = output.indexOf("{");
    const firstBracket = output.indexOf("[");
    const candidates = [firstBrace, firstBracket].filter((index) => index >= 0);
    const start = Math.min(...candidates);
    if (Number.isFinite(start)) {
      const jsonText = extractBalancedJson(output.slice(start));
      if (jsonText) {
        try {
          return JSON.parse(jsonText);
        } catch {
          return {};
        }
      }
      try {
        return JSON.parse(output.slice(start));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function extractBalancedJson(input: string) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return input.slice(0, index + 1);
    }
  }
  return "";
}
