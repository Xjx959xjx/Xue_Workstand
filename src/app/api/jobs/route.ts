import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, listJobs } from "@/lib/jobs";
import { platforms } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const writeCopySchema = z.object({
  kind: z.literal("write-copy"),
  title: z.string().optional(),
  inputSummary: z.string().optional(),
  href: z.string().optional(),
  input: z.object({
    targetType: z.enum(["account", "project"]).optional(),
    platform: z.enum(platforms).optional(),
    accountId: z.string().optional(),
    projectId: z.string().optional(),
    mode: z.enum(["topic", "rewrite"]),
    prompt: z.string().optional().default(""),
    sourceText: z.string().optional(),
    save: z.boolean().optional(),
    useWebResearch: z.boolean().optional()
  })
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
    mediaPath: z.string().optional(),
    mediaUrl: z.string().url().optional(),
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
  commentCount: z.number().int().min(1).max(200).optional().default(50),
  includeDanmaku: z.boolean().optional().default(false),
  danmakuCount: z.number().int().min(1).max(300).optional().default(100)
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
      url: z.string().url(),
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
  try {
    const jobs = await listJobs();
    return NextResponse.json({
      jobs,
      active: jobs.filter((job) => job.status === "queued" || job.status === "running"),
      recent: jobs.slice(0, 12)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取任务失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = startJobSchema.parse(await request.json());
    const job = await createJob(input);
    return NextResponse.json({ job, jobId: job.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建任务失败" },
      { status: 400 }
    );
  }
}
