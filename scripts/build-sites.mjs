import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "account-style-sites-build-"));
const sourceEntries = [
  ".openai", "db", "drizzle", "public", "scripts", "src", ".env.example",
  "drizzle.config.ts", "env.d.ts", "middleware.ts", "next-env.d.ts",
  "next.config.mjs", "package.json", "tsconfig.json", "vite.config.ts"
];

try {
  for (const entry of sourceEntries) {
    const source = path.join(root, entry);
    try {
      await fs.access(source);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await fs.cp(source, path.join(temporaryRoot, entry), { recursive: true });
  }
  await fs.symlink(path.join(root, "node_modules"), path.join(temporaryRoot, "node_modules"), "dir");
  await run(path.join(root, "node_modules", "vinext", "dist", "cli.js"), ["build"]);
  await run(path.join(temporaryRoot, "scripts", "prepare-sites-output.mjs"));
  // Only replace generated output after both the build and migration preparation succeed.
  const output = path.join(root, "dist");
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(path.join(temporaryRoot, "dist"), output, { recursive: true });
} catch (error) {
  console.error(`Sites 隔离构建失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: temporaryRoot,
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`构建命令失败：code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}
