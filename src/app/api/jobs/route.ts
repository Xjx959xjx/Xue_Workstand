import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { createJob, listJobSummaryChanges } from "@/lib/jobs";
import { createUrlPreprocessor } from "@/lib/platform-links";
import { platforms } from "@/lib/types";
import { writeCopyInputSchema } from "@/lib/write-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const urlSchema = z.preprocess(
  createUrlPreprocessor(),
  z.string().url("链接格式不正确，请粘贴完整的 http(s) 地址。")
);

const writeCopySchema = z.object({
  kind: z.literal("write-copy"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: writeCopyInputSchema
});

const accountStyleSchema = z.object({
  kind: z.literal("account-style"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    platform: z.enum(platforms),
    accountId: z.string().min(1)
  })
});

const projectStyleSchema = z.object({
  kind: z.literal("project-style"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    projectId: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    sourceAccountIds: z.array(z.string()).default([]),
    sourceMaterialIds: z.array(z.string()).optional()
  })
});

const transcribeVideoSchema = z.object({
  kind: z.literal("transcribe-video"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    platform: z.enum(platforms),
    accountId: z.string().min(1),
    videoId: z.string().min(1),
    mediaUrl: urlSchema.optional(),
    allowRemoteDownload: z.boolean().optional()
  })
});

const batchTranscribeSchema = z.object({
  kind: z.literal("batch-transcribe"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    platform: z.enum(platforms),
    accountId: z.string().min(1),
    limit: z.union([z.number().int().min(1), z.literal("all")]).default(5),
    videoIds: z.array(z.string().min(1)).min(1).optional(),
    updateStyle: z.boolean().optional()
  })
});

const engagementOptionsSchema = {
  includeComments: z.boolean().optional().default(true),
  commentCount: z.number().int().min(1).max(200).optional().default(50),
  includeDanmaku: z.boolean().optional().default(false),
  danmakuCount: z.number().int().min(1).max(300).optional().default(50),
  generationMode: z.enum(["quick", "reference"]).optional().default("quick"),
  targetPlatform: z.enum(platforms).optional()
};

const engagementSchema = z.object({
  kind: z.literal("engagement"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.discriminatedUnion("sourceType", [
    z.object({
      sourceType: z.literal("draft"),
      draftId: z.string().min(1),
      ...engagementOptionsSchema
    }),
    z.object({
      sourceType: z.literal("text"),
      title: z.string().optional(),
      text: z.string().min(1),
      ...engagementOptionsSchema
    }),
    z.object({
      sourceType: z.literal("url"),
      url: urlSchema,
      ...engagementOptionsSchema
    }),
    z.object({
      sourceType: z.literal("record"),
      recordId: z.string().min(1),
      ...engagementOptionsSchema
    })
  ])
});

const hotlistRefreshSchema = z.object({
  kind: z.literal("hotlist-refresh"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    accountIds: z.array(z.string().min(1)).min(1).optional(),
    limit: z.number().int().min(1).max(120).optional(),
    window: z.string().min(1),
    automatic: z.boolean().optional()
  })
});

const collectAccountSchema = z.object({
  kind: z.literal("collect-account"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    platform: z.enum(platforms),
    name: z.string().min(1),
    uidOrUrl: z.string().optional(),
    limit: z.number().int().min(1).max(50),
    order: z.enum(["views", "likes", "favorites", "comments", "pubdate"]),
    fromDate: z.string().optional(),
    toDate: z.string().optional()
  })
});

const singleVideoTranscribeSchema = z.object({
  kind: z.literal("single-video-transcribe"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    url: urlSchema,
    titleHint: z.string().optional()
  })
});

const publishCopySchema = z.object({
  kind: z.literal("publish-copy"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    platform: z.enum(["bilibili", "douyin", "both"]).default("both"),
    sourceText: z.string().min(1, "请先粘贴原文案。"),
    topicHint: z.string().optional(),
    candidateCount: z.number().int().min(1).max(10).optional()
  })
});

const hotspotRefreshSchema = z.object({
  kind: z.literal("hotspot-refresh"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({})
});

const grossMarginRefreshSchema = z.object({
  kind: z.literal("gross-margin-refresh"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    recordIds: z.array(z.string().trim().min(1)).optional()
  })
});

const startJobSchema = z.discriminatedUnion("kind", [
  writeCopySchema,
  accountStyleSchema,
  projectStyleSchema,
  transcribeVideoSchema,
  batchTranscribeSchema,
  hotlistRefreshSchema,
  collectAccountSchema,
  singleVideoTranscribeSchema,
  publishCopySchema,
  hotspotRefreshSchema,
  grossMarginRefreshSchema,
  engagementSchema
]);

export async function GET(request: Request) {
  return apiJson(async () => listJobSummaryChanges(new URL(request.url).searchParams.get("cursor") || undefined), {
    fallbackMessage: "读取任务失败",
    status: 500
  });
}

export async function POST(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, startJobSchema);
    const job = await createJob(input);
    return { job, jobId: job.id };
  }, {
    fallbackMessage: "创建任务失败"
  });
}
