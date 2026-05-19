import { NextResponse } from "next/server";
import { z } from "zod";
import { generateEngagement } from "@/lib/engagement";
import { extractFirstSourceUrl } from "@/lib/source-extraction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const urlSchema = z.preprocess(
  (value) => (typeof value === "string" ? extractFirstSourceUrl(value) || value.trim() : value),
  z.string().url("链接格式不正确，请粘贴完整的 http(s) 地址。")
);

const optionsSchema = {
  includeComments: z.boolean().optional().default(true),
  commentCount: z.number().int().min(1).max(200).optional().default(50),
  includeDanmaku: z.boolean().optional().default(false),
  danmakuCount: z.number().int().min(1).max(300).optional().default(100)
};

const schema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceType: z.literal("draft"),
    draftId: z.string().min(1),
    ...optionsSchema
  }),
  z.object({
    sourceType: z.literal("text"),
    title: z.string().optional(),
    text: z.string().min(1),
    ...optionsSchema
  }),
  z.object({
    sourceType: z.literal("url"),
    url: urlSchema,
    ...optionsSchema
  })
]);

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await generateEngagement(input));
  } catch (error) {
    return NextResponse.json(
      { error: formatEngagementError(error) },
      { status: 400 }
    );
  }
}

function formatEngagementError(error: unknown) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (!issue) return "生成评论失败：参数不完整。";
    if (issue.path.join(".") === "url") return "链接格式不正确，请粘贴完整的 http(s) 地址。";
    if (issue.message && !/^Invalid\b/i.test(issue.message)) return issue.message;
    return "生成评论失败：参数不完整或格式不正确。";
  }

  return error instanceof Error ? error.message : "生成评论失败";
}
