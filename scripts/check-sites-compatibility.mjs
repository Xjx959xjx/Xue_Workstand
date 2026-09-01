import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceEntries = [
  ".openai",
  "db",
  "public",
  "scripts",
  "src",
  ".env.example",
  "drizzle.config.ts",
  "env.d.ts",
  "middleware.ts",
  "next-env.d.ts",
  "next.config.mjs",
  "package.json",
  "tsconfig.json",
  "vite.config.ts"
];

const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "account-style-sites-check-"));

try {
  for (const entry of sourceEntries) {
    const source = path.join(root, entry);
    if (await exists(source)) {
      await fs.promises.cp(source, path.join(temporaryRoot, entry), { recursive: true });
    }
  }
  await run(process.execPath, [path.join(root, "node_modules", "vinext", "dist", "cli.js"), "check"], {
    cwd: temporaryRoot
  });
} finally {
  await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
}

function run(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Sites 兼容检查失败：code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

async function exists(target) {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}
