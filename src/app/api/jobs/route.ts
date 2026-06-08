import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { createJob, listJobSummaries } from "@/lib/jobs";
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
    updateStyle: z.boolean().optional()
  })
});

const engagementOptionsSchema = {
  includeComments: z.boolean().optional().default(true),
  commentCount: z.number().int().min(1).max(200).optional().default(100),
  includeDanmaku: z.boolean().optional().default(false),
  danmakuCount: z.number().int().min(1).max(300).optional().default(50)
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
    })
  ])
});

const startJobSchema = z.discriminatedUnion("kind", [
  writeCopySchema,
  accountStyleSchema,
  projectStyleSchema,
  transcribeVideoSchema,
  batchTranscribeSchema,
  engagementSchema
]);

export async function GET() {
  return apiJson(async () => ({ jobs: await listJobSummaries() }), {
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
