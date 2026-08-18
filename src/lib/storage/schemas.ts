import path from "path";
import { z } from "zod";

export const STORAGE_SCHEMA_VERSION = 1;

const platformSchema = z.enum(["bilibili", "douyin"]);
const timestampSchema = z.string().min(1);
const versionedObject = z.object({
  schemaVersion: z.number().int().nonnegative().optional()
});

const accountSchema = versionedObject.extend({
  id: z.string().min(1),
  slug: z.string().min(1),
  platform: platformSchema,
  name: z.string().min(1),
  uid: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).passthrough();

const videoSchema = versionedObject.extend({
  id: z.string().min(1),
  platform: platformSchema,
  accountId: z.string().min(1),
  title: z.string(),
  url: z.string(),
  stats: z.object({
    views: z.number().finite(),
    likes: z.number().finite(),
    comments: z.number().finite(),
    favorites: z.number().finite(),
    shares: z.number().finite().optional()
  }).passthrough(),
  hotScore: z.number().finite(),
  relativeViewRate: z.number().finite(),
  transcriptStatus: z.enum(["not_started", "pending", "transcribing", "failed", "completed"]),
  updatedAt: timestampSchema
}).passthrough();

const projectSchema = versionedObject.extend({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  sourceAccountIds: z.array(z.string()),
  sourceMaterialIds: z.array(z.string()).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).passthrough();

const draftStyleReferenceSchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("account"),
    platform: platformSchema,
    accountId: z.string().min(1),
    accountName: z.string().min(1),
    videoIds: z.array(z.string()).optional()
  }),
  z.object({
    targetType: z.literal("project"),
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    sourceAccountIds: z.array(z.string()).optional(),
    sourceMaterialIds: z.array(z.string()).optional()
  })
]);

const draftBaseSchema = versionedObject.extend({
  id: z.string().min(1),
  title: z.string().min(1),
  mode: z.enum(["topic", "rewrite"]),
  prompt: z.string(),
  originalSourceInput: z.string().optional(),
  content: z.string(),
  styleRef: z.record(z.unknown()),
  styleRefs: z.array(draftStyleReferenceSchema).min(1).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

const accountDraftSchema = draftBaseSchema.extend({
  targetType: z.literal("account").optional(),
  platform: platformSchema,
  accountId: z.string().min(1),
  accountName: z.string().min(1)
}).passthrough();

const projectDraftSchema = draftBaseSchema.extend({
  targetType: z.literal("project"),
  projectId: z.string().min(1),
  projectName: z.string().min(1)
}).passthrough();

const copySourceSchema = versionedObject.extend({
  id: z.string().min(1),
  title: z.string().min(1),
  platform: z.union([platformSchema, z.literal("unknown")]),
  url: z.string(),
  transcript: z.string(),
  transcriptPath: z.string(),
  source: z.enum(["platform_subtitle", "volcengine", "metadata", "manual"]),
  status: z.enum(["completed", "failed"]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).passthrough();

const engagementRecordSchema = versionedObject.extend({
  id: z.string().min(1),
  sourceType: z.enum(["draft", "text", "url"]),
  title: z.string().min(1),
  platform: z.union([platformSchema, z.literal("unknown")]),
  sourceText: z.string(),
  options: z.object({
    includeComments: z.boolean(),
    commentCount: z.number().int().nonnegative(),
    includeDanmaku: z.boolean(),
    danmakuCount: z.number().int().nonnegative()
  }).passthrough(),
  fallback: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).passthrough();

const supportDocumentCacheSchema = versionedObject.extend({
  cacheKey: z.string().min(1),
  url: z.string().min(1),
  provider: z.enum(["feishu", "lingxi", "wecom", "tencent-docs", "web"]),
  title: z.string().optional(),
  content: z.string().min(1),
  fetchedAt: timestampSchema
}).passthrough();

export type StoredRecordKind =
  | "account"
  | "video"
  | "project"
  | "draft"
  | "copy-source"
  | "engagement"
  | "support-document-cache";

const schemas: Record<StoredRecordKind, z.ZodTypeAny> = {
  account: accountSchema,
  video: videoSchema,
  project: projectSchema,
  draft: z.union([accountDraftSchema, projectDraftSchema]),
  "copy-source": copySourceSchema,
  engagement: engagementRecordSchema,
  "support-document-cache": supportDocumentCacheSchema
};

export function storedRecordKind(target: string, root: string): StoredRecordKind | null {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  const file = segments.at(-1) || "";

  if ((segments[0] === "bilibili" || segments[0] === "douyin") && segments.length === 3 && file === "account.json") {
    return "account";
  }
  if ((segments[0] === "bilibili" || segments[0] === "douyin") && segments.length === 4 && segments[2] === "videos" && file.endsWith(".json")) {
    return "video";
  }
  if ((segments[0] === "bilibili" || segments[0] === "douyin") && segments.length === 4 && segments[2] === "drafts" && file.endsWith(".json")) {
    return "draft";
  }
  if (segments[0] === "projects" && segments.length === 3 && file === "project.json") {
    return "project";
  }
  if (segments[0] === "projects" && segments.length === 4 && segments[2] === "drafts" && file.endsWith(".json")) {
    return "draft";
  }
  if (segments[0] === "copy-tools" && segments[1] === "sources" && file.endsWith(".json") && !file.endsWith(".style-analysis.json")) {
    return "copy-source";
  }
  if (segments[0] === "engagement" && segments.length === 2 && file.endsWith(".json")) {
    return "engagement";
  }
  if (segments[0] === ".cache" && segments[1] === "support-documents" && segments.length === 3 && file.endsWith(".json")) {
    return "support-document-cache";
  }
  return null;
}

export function parseStoredRecord<T>(target: string, value: unknown, kind: StoredRecordKind): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`存储记录结构无效：${target} 必须是 JSON 对象。`);
  }

  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version !== undefined && (!Number.isInteger(version) || Number(version) < 0)) {
    throw new Error(`存储记录版本无效：${target} 的 schemaVersion 必须是非负整数。`);
  }
  if (typeof version === "number" && version > STORAGE_SCHEMA_VERSION) {
    throw new Error(`存储记录版本过新：${target} 使用版本 ${version}，当前仅支持到 ${STORAGE_SCHEMA_VERSION}。`);
  }

  const parsed = schemas[kind].safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "根节点"}: ${issue.message}`)
      .join("；");
    throw new Error(`存储记录结构无效：${target}（${kind}）。${detail}`);
  }
  return parsed.data as T;
}

export function versionStoredRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    schemaVersion: STORAGE_SCHEMA_VERSION
  };
}
