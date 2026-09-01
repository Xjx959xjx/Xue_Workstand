import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const includeLibrary = args.has("--include-library");
const libraryRoot = path.resolve(root, process.env.STYLE_LIBRARY_DIR || "style-library");
const outputPath = path.resolve(root, readOption("--output") || "dist/sites-library-migration-manifest.json");

if (!includeLibrary) {
  console.log(JSON.stringify({
    mode: "dry-run",
    includeLibrary: false,
    message: "未读取 style-library。只有显式传入 --include-library 才会生成本地迁移清单；本命令不会上传数据。"
  }, null, 2));
  process.exit(0);
}

assertOutputIsInDist(outputPath);
const files = await collectFiles(libraryRoot);
const manifest = {
  schemaVersion: 1,
  kind: "sites-library-migration-manifest",
  sourceRoot: path.basename(libraryRoot),
  generatedAt: new Date().toISOString(),
  uploadAuthorized: false,
  files,
  totals: {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.byteLength, 0)
  }
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(`已生成只读迁移清单：${outputPath}`);
console.log(`文件 ${manifest.totals.files} 个，共 ${manifest.totals.bytes} 字节。未复制或上传任何素材。`);

async function collectFiles(directory, relativeParent = "") {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`素材库不存在：${directory}`);
    }
    throw error;
  });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))) {
    assertSafeName(entry.name);
    const relativePath = relativeParent ? `${relativeParent}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) throw new Error(`迁移清单拒绝符号链接：${relativePath}`);
    if (metadata.isDirectory()) {
      files.push(...await collectFiles(absolutePath, relativePath));
      continue;
    }
    if (!metadata.isFile()) throw new Error(`迁移清单只支持普通文件：${relativePath}`);
    files.push({
      path: relativePath,
      byteLength: metadata.size,
      sha256: await hashFile(absolutePath),
      modifiedAt: metadata.mtime.toISOString()
    });
  }
  return files;
}

function hashFile(target) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(target);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function assertSafeName(name) {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(`素材库包含不安全路径段：${JSON.stringify(name)}`);
  }
  if (/^\.env(?:\.|$)/i.test(name)) throw new Error(`素材库包含禁止迁移的环境文件：${name}`);
}

function assertOutputIsInDist(target) {
  const distRoot = path.join(root, "dist");
  const relative = path.relative(distRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("迁移清单输出必须位于项目 dist/ 目录内。");
  }
}

function readOption(flag) {
  const argv = process.argv.slice(2);
  const direct = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] || "" : "";
}
