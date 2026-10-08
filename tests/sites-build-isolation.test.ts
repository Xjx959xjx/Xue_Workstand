import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);

test("Sites 构建隔离类型文件及私人配置，准备失败保留已有产物", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sites-isolation-test-"));
  const buildScript = fileURLToPath(new URL("../scripts/build-sites.mjs", import.meta.url));
  try {
    await Promise.all(["scripts", "drizzle", "node_modules/vinext/dist", ".next/types"].map(directory => fs.mkdir(path.join(root, directory), { recursive: true })));
    await fs.copyFile(new URL("../scripts/prepare-sites-output.mjs", import.meta.url), path.join(root, "scripts/prepare-sites-output.mjs"));
    await fs.writeFile(path.join(root, ".next/types/routes.d.ts"), "Next 路由类型");
    await fs.writeFile(path.join(root, "next-env.d.ts"), "Next 环境类型");
    await fs.writeFile(path.join(root, ".env.local"), "PRIVATE_FIXTURE=must-not-copy");
    await fs.writeFile(path.join(root, "drizzle/fixture.sql"), "SELECT 1;");
    await fs.writeFile(path.join(root, "node_modules/vinext/dist/cli.js"), `
      const fs = require("node:fs");
      if (fs.existsSync(".env.local")) throw new Error("私人配置被复制");
      fs.mkdirSync(".next/types", { recursive: true });
      fs.writeFileSync(".next/types/routes.d.ts", "Vinext 路由类型");
      fs.writeFileSync("next-env.d.ts", "Vinext 环境类型");
      fs.mkdirSync("dist/server", { recursive: true });
      fs.writeFileSync("dist/server/index.js", "构建产物");
    `);
    await execute(process.execPath, [buildScript], { cwd: root });
    assert.equal(await fs.readFile(path.join(root, ".next/types/routes.d.ts"), "utf8"), "Next 路由类型");
    assert.equal(await fs.readFile(path.join(root, "next-env.d.ts"), "utf8"), "Next 环境类型");
    assert.equal(await fs.readFile(path.join(root, "dist/server/migrations/fixture.sql"), "utf8"), "SELECT 1;");
    await fs.writeFile(path.join(root, "dist/server/index.js"), "上一份可用产物");
    await fs.rm(path.join(root, "drizzle"), { recursive: true });
    await assert.rejects(execute(process.execPath, [buildScript], { cwd: root }), /Sites 隔离构建失败/);
    assert.equal(await fs.readFile(path.join(root, "dist/server/index.js"), "utf8"), "上一份可用产物");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
