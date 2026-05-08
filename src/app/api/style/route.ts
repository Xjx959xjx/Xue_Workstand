import { NextResponse } from "next/server";
import { z } from "zod";
import { generateStyleProfile } from "@/lib/ai";
import { saveStyle } from "@/lib/storage";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const baseSchema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = baseSchema.parse(await request.json());
    return NextResponse.json(await generateStyleProfile(input.platform, input.accountId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动总结风格失败" },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const input = baseSchema.extend({ content: z.string().min(1) }).parse(await request.json());
    const style = await saveStyle(input.platform, input.accountId, input.content);
    return NextResponse.json({ style });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存风格卡失败" },
      { status: 400 }
    );
  }
}
