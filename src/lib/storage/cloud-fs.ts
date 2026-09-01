import { createHash } from "node:crypto";

type CloudBinding = {
  DB: D1Database;
  FILES: R2Bucket;
};

type CloudEntry = {
  path: string;
  parent_path: string;
  name: string;
  kind: "file" | "directory";
  content_type: string;
  object_key: string;
  byte_length: number;
  sha256: string;
  revision: number;
  created_at: number;
  updated_at: number;
};

export type CloudDirent = {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
};

let bindingsPromise: Promise<CloudBinding> | null = null;

async function bindings() {
  if (!bindingsPromise) {
    const workersModule = "cloudflare:" + "workers";
    bindingsPromise = import(workersModule).then(({ env }) => {
      const runtime = env as unknown as Partial<CloudBinding>;
      if (!runtime.DB || !runtime.FILES) {
        throw new Error("Sites 云存储绑定不可用：请确认 D1 `DB` 和 R2 `FILES` 已配置。");
      }
      return runtime as CloudBinding;
    });
  }
  return bindingsPromise;
}

function rootFromTarget(target: string) {
  const root = process.env.STYLE_LIBRARY_DIR || "style-library";
  const normalizedTarget = target.split("\\").join("/");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const marker = `/${normalizedRoot}/`;
  const index = normalizedTarget.lastIndexOf(marker);
  if (index >= 0) return normalizedTarget.slice(index + marker.length);
  if (normalizedTarget === normalizedRoot || normalizedTarget.endsWith(`/${normalizedRoot}`)) return "";
  if (normalizedTarget.startsWith(`${normalizedRoot}/`)) return normalizedTarget.slice(normalizedRoot.length + 1);
  return normalizedTarget.replace(/^\.?\/?/, "");
}

function normalizeVirtualPath(target: string) {
  const value = rootFromTarget(target).replace(/^\/+|\/+$/g, "");
  if (!value || value === ".") return "";
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`云端素材路径不合法：${target}`);
  }
  return segments.join("/");
}

function parentPath(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function objectKey(path: string, revision: number, bytes: Uint8Array) {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `library/${path || "root"}/r${revision}-${digest}`;
}

async function findEntry(path: string) {
  const { DB } = await bindings();
  return (await DB.prepare("SELECT * FROM cloud_objects WHERE path = ?1 LIMIT 1").bind(path).first()) as CloudEntry | null;
}

async function ensureParentDirectories(path: string) {
  const { DB } = await bindings();
  const parents: string[] = [];
  let current = parentPath(path);
  while (current) {
    parents.push(current);
    current = parentPath(current);
  }
  const now = Date.now();
  for (const directory of parents.reverse()) {
    const existing = await findEntry(directory);
    if (existing) continue;
    await DB.prepare(
      "INSERT OR IGNORE INTO cloud_objects (path,parent_path,name,kind,content_type,object_key,byte_length,sha256,revision,created_at,updated_at) VALUES (?1,?2,?3,'directory','application/x-directory','',0,'',1,?4,?4)"
    ).bind(directory, parentPath(directory), directory.split("/").at(-1) || directory, now).run();
  }
}

export async function cloudReadFile(target: string, encoding?: BufferEncoding) {
  const path = normalizeVirtualPath(target);
  const entry = await findEntry(path);
  if (!entry || entry.kind !== "file") throw Object.assign(new Error(`云端文件不存在：${path}`), { code: "ENOENT" });
  const { FILES } = await bindings();
  const object = await FILES.get(entry.object_key);
  if (!object) throw new Error(`云端对象缺失：${entry.object_key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  return encoding ? new TextDecoder().decode(bytes) : Buffer.from(bytes);
}

export async function cloudWriteFile(target: string, value: string | Uint8Array, encoding?: BufferEncoding) {
  const path = normalizeVirtualPath(target);
  if (!path) throw new Error("不能把素材库根目录作为文件写入目标");
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  await ensureParentDirectories(path);
  const { DB, FILES } = await bindings();
  const digest = createHash("sha256").update(bytes).digest("hex");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await findEntry(path);
    if (current?.kind === "directory") throw new Error(`云端路径已是目录，不能写入文件：${path}`);
    const revision = (current?.revision || 0) + 1;
    const key = objectKey(path, revision, bytes);
    await FILES.put(key, bytes);
    const now = Date.now();
    try {
      const results = await DB.batch([
        DB.prepare("INSERT INTO cloud_object_history (path,revision,object_key,byte_length,sha256,created_at) VALUES (?1,?2,?3,?4,?5,?6)").bind(path, revision, key, bytes.byteLength, digest, now),
        current
          ? DB.prepare("UPDATE cloud_objects SET object_key=?2,byte_length=?3,sha256=?4,revision=?5,updated_at=?6 WHERE path=?1 AND revision=?7").bind(path, key, bytes.byteLength, digest, revision, now, current.revision)
          : DB.prepare("INSERT INTO cloud_objects (path,parent_path,name,kind,content_type,object_key,byte_length,sha256,revision,created_at,updated_at) VALUES (?1,?2,?3,'file',?4,?5,?6,?7,?8,?9,?9)").bind(path, parentPath(path), path.split("/").at(-1) || path, encoding ? "text/plain; charset=utf-8" : "application/octet-stream", key, bytes.byteLength, digest, revision, now)
      ]);
      if (current && (results[1]?.meta?.changes || 0) !== 1) {
        await DB.prepare(
          "DELETE FROM cloud_object_history WHERE path = ?1 AND revision = ?2 AND object_key = ?3"
        ).bind(path, revision, key).run();
        await FILES.delete(key);
        throw new Error("云端文件 revision 已变化");
      }
      return;
    } catch (error) {
      lastError = error;
      await DB.prepare(
        "DELETE FROM cloud_object_history WHERE path = ?1 AND revision = ?2 AND object_key = ?3"
      ).bind(path, revision, key).run().catch(() => undefined);
      await FILES.delete(key).catch(() => undefined);
      if (!/UNIQUE|PRIMARY KEY|constraint/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
  throw new Error(`云端文件并发写入冲突，重试后仍未成功：${path}。${lastError instanceof Error ? lastError.message : "数据库约束冲突"}`);
}

export async function cloudAccess(target: string) {
  const path = normalizeVirtualPath(target);
  if (!path) return;
  if (!(await findEntry(path))) throw Object.assign(new Error(`云端路径不存在：${path}`), { code: "ENOENT" });
}

export async function cloudMkdir(target: string) {
  const path = normalizeVirtualPath(target);
  if (!path) return;
  await ensureParentDirectories(`${path}/.keep`);
  const existing = await findEntry(path);
  if (existing) {
    if (existing.kind !== "directory") throw new Error(`云端路径已是文件：${path}`);
    return;
  }
  const { DB } = await bindings();
  const now = Date.now();
  await DB.prepare(
    "INSERT OR IGNORE INTO cloud_objects (path,parent_path,name,kind,content_type,object_key,byte_length,sha256,revision,created_at,updated_at) VALUES (?1,?2,?3,'directory','application/x-directory','',0,'',1,?4,?4)"
  ).bind(path, parentPath(path), path.split("/").at(-1) || path, now).run();
}

export async function cloudReaddir(target: string, options?: { withFileTypes?: boolean }) {
  const path = normalizeVirtualPath(target);
  const { DB } = await bindings();
  const rows = (await DB.prepare("SELECT path,name,kind FROM cloud_objects WHERE parent_path = ?1 ORDER BY name").bind(path).all()).results as Array<Pick<CloudEntry, "path" | "name" | "kind">>;
  if (!options?.withFileTypes) return rows.map((row) => row.name);
  return rows.map((row): CloudDirent => ({
    name: row.name,
    isFile: () => row.kind === "file",
    isDirectory: () => row.kind === "directory"
  }));
}

export async function cloudStat(target: string) {
  const path = normalizeVirtualPath(target);
  if (!path) {
    const now = Date.now();
    return { size: 0, mtimeMs: now, mtime: new Date(now), isFile: () => false, isDirectory: () => true };
  }
  const entry = await findEntry(path);
  if (!entry) throw Object.assign(new Error(`云端路径不存在：${path}`), { code: "ENOENT" });
  return {
    size: entry.byte_length,
    mtimeMs: entry.updated_at,
    mtime: new Date(entry.updated_at),
    isFile: () => entry.kind === "file",
    isDirectory: () => entry.kind === "directory"
  };
}

export const cloudLstat = cloudStat;

export async function cloudRm(target: string, options?: { recursive?: boolean; force?: boolean }) {
  const path = normalizeVirtualPath(target);
  if (!path) {
    if (options?.force) return;
    throw new Error("不能删除素材库根目录");
  }
  const entry = await findEntry(path);
  if (!entry) {
    if (options?.force) return;
    throw Object.assign(new Error(`云端路径不存在：${path}`), { code: "ENOENT" });
  }
  const { DB, FILES } = await bindings();
  const rows = entry.kind === "directory" && options?.recursive
    ? (await DB.prepare("SELECT object_key FROM cloud_objects WHERE path = ?1 OR path LIKE ?2").bind(path, `${path}/%`).all()).results as Array<{ object_key: string }>
    : [{ object_key: entry.object_key }];
  const statement = entry.kind === "directory" && options?.recursive
    ? DB.prepare("DELETE FROM cloud_objects WHERE path = ?1 OR path LIKE ?2").bind(path, `${path}/%`)
    : DB.prepare("DELETE FROM cloud_objects WHERE path = ?1").bind(path);
  await statement.run();
  await Promise.all(rows.filter((row) => row.object_key).map((row) => FILES.delete(row.object_key)));
}

export async function cloudRename(source: string, destination: string) {
  const sourcePath = normalizeVirtualPath(source);
  const destinationPath = normalizeVirtualPath(destination);
  const entry = await findEntry(sourcePath);
  if (!entry) throw Object.assign(new Error(`云端路径不存在：${sourcePath}`), { code: "ENOENT" });
  await ensureParentDirectories(destinationPath);
  const { DB, FILES } = await bindings();
  if (entry.kind === "file") {
    const object = await FILES.get(entry.object_key);
    if (!object) throw new Error(`云端对象缺失：${entry.object_key}`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    await cloudWriteFile(destination, bytes);
    await cloudRm(source, { force: true });
    return;
  }
  const children = (await DB.prepare("SELECT path FROM cloud_objects WHERE path = ?1 OR path LIKE ?2 ORDER BY path").bind(sourcePath, `${sourcePath}/%`).all()).results as Array<{ path: string }>;
  for (const child of children.reverse()) {
    const suffix = child.path === sourcePath ? "" : child.path.slice(sourcePath.length + 1);
    const destinationChild = suffix ? `${destinationPath}/${suffix}` : destinationPath;
    const childEntry = await findEntry(child.path);
    if (childEntry?.kind === "file") await cloudRename(child.path, destinationChild);
  }
  await cloudRm(source, { recursive: true, force: true });
}
