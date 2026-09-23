import path from "path";
import { z } from "zod";
import { styleEvidenceSchema, writerContextSchema } from "../writer-context";
import { imageGenerationInputSchema } from "../image-generation-types";

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
  version: z.object({ batchId: z.string().min(1).max(100).optional() }).passthrough().optional(),
  id: z.string().min(1),
  title: z.string().min(1),
  mode: z.enum(["topic", "rewrite"]),
  prompt: z.string(),
  originalSourceInput: z.string().optional(),
  content: z.string(),
  styleRef: z.record(z.unknown()),
  styleRefs: z.array(draftStyleReferenceSchema).min(1).optional(),
  writerContext: writerContextSchema.optional(),
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

const styleAnalysisSchema = versionedObject.extend({
  version: z.literal(1), cacheKey: z.string().min(1),
  kind: z.enum(["account-video", "copy-source"]), sourceId: z.string().min(1),
  title: z.string(), inputChars: z.number().nonnegative(), analysis: z.string(),
  evidence: styleEvidenceSchema.optional(), usedModel: z.string(),
  reasoningEffort: z.string(), generatedAt: timestampSchema
}).passthrough();

const styleMetaSchema = versionedObject.extend({
  sampleHash: z.string().min(1), sampleCount: z.number().int().nonnegative(),
  usedModel: z.string(), updatedAt: timestampSchema,
  sampleFingerprints: z.array(z.object({ videoId: z.string(), hash: z.string() })).optional(),
  sampleVideoIds: z.array(z.string()).optional()
}).passthrough();

export type StoredRecordKind =
  | "image-generation"
  | "image-file"
  | "style-analysis"
  | "style-meta"
  | "account"
  | "video"
  | "project"
  | "draft"
  | "copy-source"
  | "engagement"
  | "support-document-cache";

const schemas: Record<StoredRecordKind, z.ZodTypeAny> = {
  "image-generation": imageGenerationInputSchema.extend({
    schemaVersion: z.literal(STORAGE_SCHEMA_VERSION), id: z.string().min(1), model: z.string().min(1),
    createdAt: timestampSchema, updatedAt: timestampSchema, deletedAt: timestampSchema.optional(),
    images: z.array(z.object({ id: z.string().uuid(), name: z.string(), format: z.enum(["png", "jpeg", "webp"]), createdAt: timestampSchema })).max(4)
  }),
  "image-file": z.object({ schemaVersion: z.literal(STORAGE_SCHEMA_VERSION), id: z.string().uuid(), name: z.string(), format: z.enum(["png", "jpeg", "webp"]), createdAt: timestampSchema }),
  "style-analysis": styleAnalysisSchema,
  "style-meta": styleMetaSchema,
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
  if (segments[0] === "images" && segments.length === 3 && file.endsWith(".json")) {
    if (segments[1] === "records") return "image-generation";
    if (segments[1] === "files") return "image-file";
  }

  if (["bilibili", "douyin", "projects"].includes(segments[0]) && segments.length === 3 && file === "style.meta.json") return "style-meta";

  if (((segments[0] === "bilibili" || segments[0] === "douyin") && segments.length === 4 && segments[2] === "style-samples" && file.endsWith(".json")) ||
    (segments[0] === "copy-tools" && segments[1] === "sources" && file.endsWith(".style-analysis.json"))) return "style-analysis";

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


export const aiPolicyValueSchema = z.object({
  model: z.string().trim().max(120, "模型名称不能超过 120 字符").regex(/^[A-Za-z0-9._:/-]*$/, "模型名称只能包含字母、数字及 . _ : / -"),
  effort: z.enum(["default", "none", "low", "medium", "high", "xhigh"], { errorMap: () => ({ message: "推理等级不受支持" }) })
}).strict();
export const aiSettingsSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().nullable(), overrides: z.record(aiPolicyValueSchema)
}).strict();

const radarGradeSchema = z.enum(["吊爆了", "有点东西", "能做", "还行", "先看看"]);
const radarRatingSchema = z.enum(["吊爆了", "还行", "不行"]);
const radarBoardSchema = z.enum(["entertainment", "game", "esports", "ai"]);
const radarMonitorSchema = z.enum(["operations", "official", "esports", "breakout"]);
const strings = z.array(z.string());
const radarSignalSchema = z.object({
  inputKind: z.enum(["hotlist", "rss", "video"]).optional(), observedAt: z.string().optional(),
  metrics: z.object({ rank: z.number().optional(), likes: z.number().optional(), comments: z.number().optional(), views: z.number().optional() }).optional(),
  id: z.string(), sourceId: z.string(), sourceName: z.string(), sourceType: z.enum(["official", "news", "video", "community", "social"]),
  board: radarBoardSchema, title: z.string(), url: z.string().optional(), game: z.string(), category: z.string(), capturedAt: z.string(), publishedAt: z.string().optional(), heat: z.number(), trend: z.string(), tags: strings, summary: z.string().optional()
});
const radarEventSchema = z.object({
  eventFingerprint: z.string().optional(), updatedAt: z.string().optional(), development: z.string().optional(),
  timeline: z.array(z.object({ signalId: z.string(), title: z.string(), source: z.string(), url: z.string(), publishedAt: z.string().optional() })).max(30).optional(),
  id: z.string(), board: radarBoardSchema, monitorType: radarMonitorSchema, monitorLabel: z.string(), triggerMode: z.string(), thresholdHint: z.string(), actionWindow: z.string(), priorityLabel: z.string(), scopeMatches: strings,
  title: z.string(), game: z.string(), category: z.string(), status: z.enum(["ready", "watch", "risk"]), score: z.number(), freshness: z.string(), sources: z.number(), summary: z.string(), whyNow: z.string(), playerFocus: strings, angles: strings, evidence: strings, research: strings, risks: strings, accounts: strings, signalIds: strings,
  gradeLabel: radarGradeSchema.optional(), userRating: radarRatingSchema.optional(), entryPoint: z.string().optional(), commentDirection: z.string().optional(), publishedAt: z.string().optional(), retainedUntil: z.string().optional(),
  displayInfo: z.object({ kind: radarMonitorSchema, subject: z.string(), headline: z.string(), statusLine: z.string(), timeLabel: z.string(), sourceLine: z.string(), facts: strings, primaryAction: z.string() })
});
const radarCounts = { sourceCount: z.number(), completedSourceCount: z.number(), failedSourceCount: z.number(), signalCount: z.number(), hotspotCount: z.number(), readyCount: z.number(), averageScore: z.number() };
export const hotspotSnapshotSchema = z.object({
  // 兼容现有规则版快照，后续写入统一添加版本号，不批量改写旧资产。
  schemaVersion: z.literal(1).optional(), generatedAt: z.string(),
  scouts: z.array(z.object({ id: z.string(), board: radarBoardSchema, name: z.string(), scope: z.string(), cadence: z.string(), cacheStatus: z.enum(["fresh", "validated", "network", "stale"]).optional(), sources: strings, status: z.enum(["running", "queued", "paused", "failed"]), coverage: z.number(), itemCount: z.number(), lastCheckedAt: z.string().optional(), error: z.string().optional() })),
  signals: z.array(radarSignalSchema), hotspots: z.array(radarEventSchema),
  summary: z.object({ ...radarCounts, generatedAt: z.string(), boardStats: z.array(z.object({ ...radarCounts, board: radarBoardSchema, topScore: z.number() })) }),
  refresh: z.object({ requested: z.number(), completed: z.number(), failed: z.number(), sources: z.array(z.object({ id: z.string(), board: radarBoardSchema, name: z.string(), status: z.enum(["completed", "failed"]), itemCount: z.number(), error: z.string().optional() })) }),
  analysis: z.object({ method: z.literal("ai-two-pass"), pipeline: z.literal("unified-events").optional(), eventCount: z.number().optional(), candidateCount: z.number(), coarseCount: z.number(), analyzedCount: z.number(), coverage: z.number(), reusedItemCount: z.number().optional(), fallback: z.boolean(), fallbackReason: z.string().optional() }).optional(),
  dailyReport: z.object({ headline: z.string(), overview: z.string(), signals: strings, communityMood: z.string(), tomorrowWatch: strings }).optional()
});
export const hotspotFeedbackSchema = z.object({
  schemaVersion: z.literal(1),
  ratings: z.array(z.object({ hotspotId: z.string(), title: z.string(), summary: z.string(), rating: radarRatingSchema, updatedAt: z.string() })).max(1000),
  history: z.array(z.object({ hotspotId: z.string(), rating: radarRatingSchema, updatedAt: z.string() })).max(1000)
});

export const hotspotCollectionSchema = z.object({
  pipeline: z.literal("unified-events").optional(),
  schemaVersion: z.literal(1), generatedAt: z.string(),
  signals: z.array(radarSignalSchema), scouts: hotspotSnapshotSchema.shape.scouts,
  status: z.enum(["collected", "analyzing", "completed", "failed", "cancelled"]),
  analysis: hotspotSnapshotSchema.shape.analysis,
  completedSignalIds: strings.optional(),
  error: z.string().optional(), partialHotspots: z.array(radarEventSchema),
  analyzedCount: z.number().nonnegative(), candidateCount: z.number().nonnegative()
});

export const hotspotCheckpointSchema = z.object({
  schemaVersion: z.literal(1), key: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(), result: z.unknown(), fallbackReason: z.string().optional()
});

export const hotspotRequestCacheSchema = z.object({
  schemaVersion: z.literal(1), url: z.string(), body: z.string().optional(),
  etag: z.string().optional(), lastModified: z.string().optional(),
  checkedAt: z.number(), failures: z.number().int().nonnegative(),
  nextRetryAt: z.number(), error: z.string().optional()
});

export const engagementReviewCacheSchema = z.object({
  schemaVersion: z.literal(1), engineVersion: z.string().min(1), cachedAt: z.string().datetime(),
  decisions: z.array(z.object({ id: z.number().int().nonnegative(), keep: z.boolean() })).max(60)
});
