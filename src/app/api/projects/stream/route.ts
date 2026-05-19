import { NextResponse } from "next/server";
import { z } from "zod";
import { saveAndGenerateProjectStyleProfile } from "@/lib/ai";
import { createNdjsonStream } from "@/lib/streaming";

export const runtime = "nodejs";

const schema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  sourceAccountIds: z.array(z.string()).default([]),
  sourceMaterialIds: z.array(z.string()).optional()
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());

    const stream = createNdjsonStream(async (emit) => {
      emit({ type: "stage", stage: "validate", message: "正在校验项目配置", progress: 15 });
      if (!input.sourceAccountIds.length && !input.sourceMaterialIds?.length) {
        throw new Error("先加案例或账号");
      }

      emit({ type: "stage", stage: "generate", message: "正在保存项目并读取参考样本", progress: 45 });
      const result = await saveAndGenerateProjectStyleProfile(input);

      emit({ type: "stage", stage: "finalize", message: "正在写入项目风格卡", progress: 92 });
      emit({ type: "result", data: result });
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动总结项目风格失败" },
      { status: 400 }
    );
  }
}
