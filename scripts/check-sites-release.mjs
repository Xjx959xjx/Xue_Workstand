import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distRoot = path.join(root, "dist");
const serverRoot = path.join(distRoot, "server");
const failures = [];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

async function main() {
  const required = [
    path.join(serverRoot, "index.js"),
    path.join(serverRoot, "wrangler.json")
  ];
  for (const target of required) {
    if (!(await exists(target))) failures.push(`缺少 Sites 构建文件：${path.relative(root, target)}`);
  }

  const migrationRoot = path.join(serverRoot, "migrations");
  const migrationFiles = (await walk(migrationRoot)).filter((file) => file.endsWith(".sql"));
  if (!migrationFiles.length) failures.push("Sites 构建产物没有 D1 migration。");

  if (await exists(path.join(serverRoot, "wrangler.json"))) {
    try {
      const config = JSON.parse(await readFile(path.join(serverRoot, "wrangler.json"), "utf8"));
      if (config.main !== "index.js") failures.push("wrangler.json 的 main 必须指向 index.js。");
      if (config.vars?.SITES_STORAGE_MODE !== "cloud") failures.push("wrangler.json 未将 SITES_STORAGE_MODE 设为 cloud。");
      const d1 = config.d1_databases?.some((item) => item.binding === "DB");
      const r2 = config.r2_buckets?.some((item) => item.binding === "FILES");
      if (!d1) failures.push("wrangler.json 缺少 D1 绑定 DB。");
      if (!r2) failures.push("wrangler.json 缺少 R2 绑定 FILES。");
    } catch (error) {
      failures.push(`wrangler.json 无法解析：${error instanceof Error ? error.message : "JSON 格式错误"}`);
    }
  }

  const files = await walk(distRoot);
  const forbiddenPath = /(^|[\\/])(?:\.env(?:\.[^/\\]+)?|style-library)(?:$|[\\/])/i;
  for (const file of files) {
    const relative = path.relative(root, file);
    if (forbiddenPath.test(relative)) failures.push(`构建产物疑似包含受保护数据路径：${relative}`);
    const extension = path.extname(file).toLowerCase();
    if (![".js", ".mjs", ".json", ".html", ".css", ".txt", ".map"].includes(extension)) continue;
    const content = await readFile(file, "utf8").catch(() => "");
    if (/\bsk-[A-Za-z0-9]{20,}\b/.test(content)) failures.push(`构建产物疑似包含 OpenAI 密钥：${relative}`);
    if (/\bAIza[A-Za-z0-9_-]{30,}\b/.test(content)) failures.push(`构建产物疑似包含 Google API 密钥：${relative}`);
  }

  if (failures.length) {
    console.error("Sites 发布前检查失败：");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Sites 发布前检查通过：Worker、D1 migration、DB/FILES 绑定和数据边界均正常（${migrationFiles.length} 个 migration）。`);
}

await main();
