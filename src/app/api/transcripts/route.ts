import { NextResponse } from "next/server";
import { z } from "zod";
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
  try {
    const url = new URL(request.url);
    const input = schema.parse({
      platform: url.searchParams.get("platform"),
      accountId: url.searchParams.get("accountId"),
      videoId: url.searchParams.get("videoId")
    });
    return NextResponse.json({ transcript: await readTranscript(input.platform, input.accountId, input.videoId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取转写稿失败" },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const input = updateSchema.parse(await request.json());
    const result = await saveTranscript({
      platform: input.platform,
      accountId: input.accountId,
      videoId: input.videoId,
      text: input.transcript,
      source: "manual"
    });
    return NextResponse.json({ transcript: result.transcript });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存转写稿失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await deleteTranscript(input.platform, input.accountId, input.videoId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除转写稿失败" },
      { status: 400 }
    );
  }
}
