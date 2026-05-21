import { NextResponse } from "next/server";
import { z } from "zod";
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
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await transcribeVideo(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "转写失败" },
      { status: 400 }
    );
  }
}
