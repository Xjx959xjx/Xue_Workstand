import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDraftCover } from "@/lib/cover";
import { createNdjsonStream } from "@/lib/streaming";

export const runtime = "nodejs";

const schema = z.object({
  draftId: z.string().min(1),
  referenceIds: z.array(z.string()).default([]),
  prompt: z.string().optional(),
  count: z.number().int().min(1).max(4).default(2)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const stream = createNdjsonStream(async (emit) => {
      const result = await generateDraftCover({
        ...input,
        onStage(stage) {
          emit({ type: "stage", ...stage });
        }
      });
      emit({ type: "result", data: result });
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成封面失败" },
      { status: 400 }
    );
  }
}
