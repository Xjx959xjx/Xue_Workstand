import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDraftEngagement } from "@/lib/engagement";

export const runtime = "nodejs";

const schema = z.object({
  draftId: z.string().min(1),
  commentCount: z.number().int().min(1).max(200).default(50),
  danmakuCount: z.number().int().min(1).max(300).default(100)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await generateDraftEngagement(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成评论和弹幕失败" },
      { status: 400 }
    );
  }
}
