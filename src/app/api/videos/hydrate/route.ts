import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { hydrateBilibiliVideoStats, hydrateDouyinVideoStatsBatch } from "@/lib/opencli";
import { getVideo, saveVideo } from "@/lib/storage";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  videoId: z.string().min(1).optional(),
  videoIds: z.array(z.string().min(1)).min(1).max(20).optional()
}).refine((input) => Boolean(input.videoId) !== Boolean(input.videoIds), {
  message: "请传入一个 videoId 或一组 videoIds"
});

export async function POST(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, schema);
    const videoIds = input.videoIds || [input.videoId!];
    const records = await Promise.all(videoIds.map((videoId) => getVideo(input.platform, input.accountId, videoId)));
    const account = records[0].account;
    const videos = records.map((record) => record.video);
    const hydrated = input.platform === "bilibili"
      ? await Promise.all(videos.map((video) => hydrateBilibiliVideoStats(video)))
      : await hydrateDouyinVideoStatsBatch(videos);
    const saved = await Promise.all(hydrated.map((video) => saveVideo(account, video)));
    const failedCount = saved.filter((video) => video.statsHydration?.status === "failed").length;
    if (failedCount === saved.length) {
      throw new Error(saved[0]?.statsHydration?.error || "没有取得视频统计详情，请确认抖音网页会话仍有效。");
    }
    return input.videoId ? { video: saved[0] } : { videos: saved, failedCount };
  }, {
    fallbackMessage: "补充视频数据失败"
  });
}
