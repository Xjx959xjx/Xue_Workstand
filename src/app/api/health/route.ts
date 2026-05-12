import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { libraryRoot } from "@/lib/storage";
import { getChatRuntimeConfig } from "@/lib/ai";
import { checkFeishuRuntime } from "@/lib/feishu";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export async function GET() {
  const opencli = process.env.OPENCLI_BIN || "opencli";
  const chat = getChatRuntimeConfig();
  const feishu = await checkFeishuRuntime();
  let opencliOk = false;
  let opencliVersion = "";

  try {
    const { stdout } = await execFileAsync(opencli, ["--version"], { timeout: 5000 });
    opencliOk = true;
    opencliVersion = stdout.trim();
  } catch {
    opencliOk = false;
  }

  return NextResponse.json({
    opencli: {
      ok: opencliOk,
      bin: opencli,
      version: opencliVersion
    },
    libraryRoot: libraryRoot(),
    volcengineAsrConfigured: Boolean(
      process.env.VOLCENGINE_ASR_API_KEY ||
      process.env.VOLCENGINE_API_KEY ||
      (process.env.VOLCENGINE_ASR_APP_KEY && process.env.VOLCENGINE_ASR_ACCESS_KEY)
    ),
    chatConfigured: chat.configured,
    chat,
    feishuConfigured: feishu.configured,
    feishu
  });
}
