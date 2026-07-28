import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { deleteTranscript, getTranscriptSnapshot, restoreTranscriptVersion, saveTranscript } from "@/lib/storage";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  videoId: z.string().min(1)
});

const updateSchema = schema.extend({
  transcript: z.string(),
  expectedRevision: z.string().nullable()
});

const restoreSchema = schema.extend({
  versionId: z.string().min(1),
  expectedRevision: z.string().nullable()
});

export async function GET(request: Request) {
  return apiJson(async () => {
    const url = new URL(request.url);
    const input = schema.parse({
      platform: url.searchParams.get("platform"),
      accountId: url.searchParams.get("accountId"),
      videoId: url.searchParams.get("videoId")
    });
    return getTranscriptSnapshot(input.platform, input.accountId, input.videoId);
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
      source: "manual",
      expectedRevision: input.expectedRevision
    });
    return {
      transcript: result.transcript,
      revision: result.revision,
      previousVersionCreated: result.previousVersionCreated,
      versions: (await getTranscriptSnapshot(input.platform, input.accountId, input.videoId)).versions
    };
  }, {
    fallbackMessage: "保存转写稿失败"
  });
}

export async function PATCH(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, restoreSchema);
    const result = await restoreTranscriptVersion(input);
    return {
      transcript: result.transcript,
      revision: result.revision,
      previousVersionCreated: result.previousVersionCreated,
      versions: (await getTranscriptSnapshot(input.platform, input.accountId, input.videoId)).versions
    };
  }, {
    fallbackMessage: "恢复转写历史版本失败"
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
