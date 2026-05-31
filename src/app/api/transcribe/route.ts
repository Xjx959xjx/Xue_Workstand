import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { transcribeVideo } from "@/lib/transcription";
import { createUrlPreprocessor } from "@/lib/link-input";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  videoId: z.string().min(1),
  mediaPath: z.string().optional(),
  mediaUrl: z.preprocess(createUrlPreprocessor(), z.string().url()).optional(),
  allowRemoteDownload: z.boolean().optional()
});

export async function POST(request: Request) {
  return apiJson(async () => transcribeVideo(await parseJsonBody(request, schema)), {
    fallbackMessage: "转写失败"
  });
}
