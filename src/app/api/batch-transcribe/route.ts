import { NextResponse } from "next/server";
import { z } from "zod";
import { runBatchTranscribe } from "@/lib/batch-transcribe";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  limit: z.union([z.number().int().min(1), z.literal("all")]).default(5),
  updateStyle: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await runBatchTranscribe(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量转写失败" },
      { status: 400 }
    );
  }
}
