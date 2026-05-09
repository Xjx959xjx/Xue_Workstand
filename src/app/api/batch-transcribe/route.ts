import { NextResponse } from "next/server";
import { z } from "zod";
import { generateStyleProfile } from "@/lib/ai";
import { getAccountSummary, resolveAccount } from "@/lib/storage";
import { transcribeVideo } from "@/lib/transcription";
import { BatchTranscribeResult, platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  limit: z.union([z.number().int().min(1), z.literal("all")]).default(5),
  updateStyle: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const account = await resolveAccount(input.platform, input.accountId);
    const summary = await getAccountSummary(account);
    const limit = input.limit === "all" ? summary.videos.length : Math.min(input.limit, summary.videos.length);
    const candidates = summary.videos.slice(0, limit);

    const result: BatchTranscribeResult = {
      account: summary,
      requested: candidates.length,
      completed: 0,
      skipped: 0,
      failed: 0,
      results: []
    };

    for (const video of candidates) {
      if (video.transcriptStatus === "completed") {
        result.skipped += 1;
        result.results.push({
          videoId: video.id,
          title: video.title,
          status: "skipped",
          source: video.transcriptSource || "existing"
        });
        continue;
      }

      try {
        const transcribed = await transcribeVideo({
          platform: input.platform,
          accountId: input.accountId,
          videoId: video.id,
          allowRemoteDownload: true
        });
        result.completed += 1;
        result.results.push({
          videoId: video.id,
          title: video.title,
          status: "completed",
          source: transcribed.video.transcriptSource || transcribed.usedProvider
        });
      } catch (error) {
        result.failed += 1;
        result.results.push({
          videoId: video.id,
          title: video.title,
          status: "failed",
          error: error instanceof Error ? error.message : "转写失败"
        });
      }
    }

    if (input.updateStyle) {
      try {
        const styleResult = await generateStyleProfile(input.platform, input.accountId);
        result.style = styleResult.style;
        result.styleUpdated = true;
        result.fallback = styleResult.fallback;
        result.usedModel = styleResult.usedModel;
      } catch (error) {
        result.styleUpdated = false;
        result.styleError = error instanceof Error ? error.message : "风格卡更新失败";
      }
    }

    result.account = await getAccountSummary(account);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量转写失败" },
      { status: 400 }
    );
  }
}
