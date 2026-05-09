import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteVideos } from "@/lib/storage";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const deleteSchema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  videoIds: z.array(z.string().min(1)).min(1)
});

export async function DELETE(request: Request) {
  try {
    const input = deleteSchema.parse(await request.json());
    return NextResponse.json(await deleteVideos(input.platform, input.accountId, input.videoIds));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除视频失败" },
      { status: 400 }
    );
  }
}
