import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
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
  return apiJson(async () => {
    const input = await parseJsonBody(request, schema);
    const { account, video } = await getVideo(input.platform, input.accountId, input.videoId);
    const hydrated = input.platform === "bilibili" ? await hydrateBilibiliVideoStats(video) : video;
    return { video: await saveVideo(account, hydrated) };
  }, {
    fallbackMessage: "补充视频数据失败"
  });
}
