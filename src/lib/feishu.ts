import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type FeishuConfig = {
  folderToken: string;
  opencliBin: string;
  identity: string;
};

function feishuConfig(): FeishuConfig {
  return {
    folderToken: process.env.FEISHU_FOLDER_TOKEN || "",
    opencliBin: process.env.OPENCLI_BIN || "opencli",
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
    const { stdout, stderr } = await execFileAsync(config.opencliBin, ["lark-cli", "doctor", "--offline"], {
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

  const { stdout, stderr } = await spawnWithInput(config.opencliBin, args, input.content, {
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
      try {
        return JSON.parse(output.slice(start));
      } catch {
        return {};
      }
    }
    return {};
  }
}
