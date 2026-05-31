import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { deleteTranscript, readTranscript, saveTranscript } from "@/lib/storage";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  videoId: z.string().min(1)
});

const updateSchema = schema.extend({
  transcript: z.string()
});

export async function GET(request: Request) {
  return apiJson(async () => {
    const url = new URL(request.url);
    const input = schema.parse({
      platform: url.searchParams.get("platform"),
      accountId: url.searchParams.get("accountId"),
      videoId: url.searchParams.get("videoId")
    });
    return { transcript: await readTranscript(input.platform, input.accountId, input.videoId) };
  }, {
    fallbackMessage: "读取转写稿失败"
  });
}

export async function PUT(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, updateSchema);
    const result = await saveTranscript({
      platform: input.platform,
      accountId: input.accountId,
      videoId: input.videoId,
      text: input.transcript,
      source: "manual"
    });
    return { transcript: result.transcript };
  }, {
    fallbackMessage: "保存转写稿失败"
  });
}

export async function DELETE(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, schema);
    return deleteTranscript(input.platform, input.accountId, input.videoId);
  }, {
    fallbackMessage: "删除转写稿失败"
  });
}
