import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getCloudBindings() {
  if (!env.DB || !env.FILES) {
    throw new Error("Sites 云存储绑定不可用：请确认 D1 `DB` 和 R2 `FILES` 已配置。");
  }
  return { db: env.DB, files: env.FILES };
}

export function getDb() {
  return drizzle(getCloudBindings().db, { schema });
}
