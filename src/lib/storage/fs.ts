import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import {
  cloudAccess,
  cloudLstat,
  cloudMkdir,
  cloudReadFile,
  cloudReaddir,
  cloudRename,
  cloudRm,
  cloudStat,
  cloudWriteFile
} from "./cloud-fs";
import type { CloudDirent } from "./cloud-fs";

export type StorageDirent = Pick<CloudDirent, "name" | "isFile" | "isDirectory">;
export type StorageStats = {
  size: number;
  mtimeMs: number;
  mtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
};

export function isCloudStorageMode() {
  return process.env.SITES_STORAGE_MODE === "cloud" || process.env.SITES_RUNTIME === "cloud";
}

export const storageFs = {
  access: async (target: string): Promise<void> => (isCloudStorageMode() ? cloudAccess(target) : fs.access(target)),
  readFile: async (target: string, encoding: BufferEncoding): Promise<string> =>
    isCloudStorageMode() ? await cloudReadFile(target, encoding) as string : await fs.readFile(target, encoding),
  readFileBytes: async (target: string): Promise<Buffer> =>
    isCloudStorageMode() ? Buffer.from(await cloudReadFile(target) as Uint8Array) : await fs.readFile(target),
  mkdir: async (target: string, options?: { recursive?: boolean }): Promise<void> => {
    if (isCloudStorageMode()) await cloudMkdir(target);
    else await fs.mkdir(target, options);
  },
  readdir: async (target: string): Promise<string[]> =>
    isCloudStorageMode() ? await cloudReaddir(target) as string[] : await fs.readdir(target),
  readdirEntries: async (target: string): Promise<StorageDirent[]> =>
    isCloudStorageMode() ? await cloudReaddir(target, { withFileTypes: true }) as StorageDirent[] : await fs.readdir(target, { withFileTypes: true }),
  stat: async (target: string): Promise<StorageStats> =>
    isCloudStorageMode() ? await cloudStat(target) : await fs.stat(target),
  lstat: async (target: string): Promise<StorageStats> =>
    isCloudStorageMode() ? await cloudLstat(target) : await fs.lstat(target),
  rm: async (target: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> =>
    isCloudStorageMode() ? await cloudRm(target, options) : await fs.rm(target, options),
  rename: async (source: string, destination: string): Promise<void> =>
    isCloudStorageMode() ? await cloudRename(source, destination) : await fs.rename(source, destination)
};

export async function fileExists(target: string) {
  try {
    await storageFs.access(target);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

export async function readJsonFile<T>(target: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await storageFs.readFile(target, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw new Error(`读取 JSON 文件失败：${target}。${describeFsError(error)}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`JSON 文件损坏，无法解析：${target}。${describeFsError(error)}`);
  }
}

export async function writeJsonFile(target: string, value: unknown) {
  return writeTextFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextFileAtomic(target: string, value: string) {
  return writeFileAtomic(target, value, "utf8");
}

export async function writeFileAtomic(target: string, value: string | Uint8Array, encoding?: BufferEncoding) {
  if (isCloudStorageMode()) {
    await cloudWriteFile(target, value, encoding);
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);

  try {
    if (encoding) {
      await fs.writeFile(temp, value, encoding);
    } else {
      await fs.writeFile(temp, value);
    }
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function describeFsError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "未知文件系统错误";
}
