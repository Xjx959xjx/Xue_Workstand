import { NextResponse } from "next/server";
import { z } from "zod";
import { createEngagementDocx } from "@/lib/engagement-export";

export const runtime = "nodejs";

const schema = z.object({
  recordId: z.string().min(1)
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = schema.parse({
      recordId: searchParams.get("recordId")
    });
    const result = await createEngagementDocx(input.recordId);
    const headers = new Headers({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "Cache-Control": "no-store"
    });

    return new NextResponse(new Uint8Array(result.buffer), { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出评论池失败" },
      { status: 400 }
    );
  }
}
