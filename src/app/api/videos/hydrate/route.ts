import { NextResponse } from "next/server";
import { z } from "zod";
import { hydrateBilibiliVideoStats } from "@/lib/opencli";
import { getVideo, saveVideo } from "@/lib/storage";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  videoId: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const { account, video } = await getVideo(input.platform, input.accountId, input.videoId);
    const hydrated = input.platform === "bilibili" ? await hydrateBilibiliVideoStats(video) : video;
    return NextResponse.json({ video: await saveVideo(account, hydrated) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "补充视频数据失败" },
      { status: 400 }
    );
  }
}
