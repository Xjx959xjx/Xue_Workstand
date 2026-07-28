import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { getHotspotRadar } from "@/lib/hotspots";

export const runtime = "nodejs";

const postSchema = z.object({
  action: z.enum(["refresh"]).default("refresh")
});

export async function GET(request: Request) {
  return apiJson(async () => getHotspotRadar({ signal: request.signal }), {
    fallbackMessage: "读取热点雷达失败"
  });
}

export async function POST(request: Request) {
  return apiJson(async () => {
    await parseJsonBody(request, postSchema);
    return getHotspotRadar({ refresh: true, signal: request.signal });
  }, {
    fallbackMessage: "刷新热点雷达失败"
  });
}
