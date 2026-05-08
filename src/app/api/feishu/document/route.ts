import { NextResponse } from "next/server";
import { z } from "zod";
import { publishFeishuDocument } from "@/lib/feishu";

export const runtime = "nodejs";

const schema = z.object({
  title: z.string().min(1).max(120),
  content: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await publishFeishuDocument(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "发布飞书文档失败" },
      { status: 400 }
    );
  }
}
