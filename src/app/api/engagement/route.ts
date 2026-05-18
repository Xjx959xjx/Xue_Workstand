import { NextResponse } from "next/server";
import { z } from "zod";
import { generateEngagement } from "@/lib/engagement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    url: z.string().url(),
    ...optionsSchema
  })
]);

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await generateEngagement(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成评论失败" },
      { status: 400 }
    );
  }
}
