import { NextResponse } from "next/server";
import { z } from "zod";
import { saveDraft } from "@/lib/storage";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  title: z.string().min(1),
  mode: z.enum(["topic", "rewrite"]),
  prompt: z.string().min(1),
  input: z.string().optional(),
  content: z.string().min(1),
  styleRef: z.object({
    platform: z.enum(platforms),
    accountId: z.string(),
    accountName: z.string(),
    videoIds: z.array(z.string()).optional()
  })
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await saveDraft(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存草稿失败" },
      { status: 400 }
    );
  }
}
