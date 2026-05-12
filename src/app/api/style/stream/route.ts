import { NextResponse } from "next/server";
import { z } from "zod";
import {
  completePreparedAccountStyle,
  prepareAccountStyleContext,
  streamResponseTextWithFallback
} from "@/lib/ai";
import { createNdjsonStream } from "@/lib/streaming";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());

    const stream = createNdjsonStream(async (emit) => {
      emit({ type: "stage", stage: "prepare", message: "正在读取账号转写样本", progress: 12 });
      const context = await prepareAccountStyleContext(input.platform, input.accountId);

      let generated = "";
      emit({ type: "stage", stage: "generate", message: "正在生成账号风格卡", progress: 35 });
      const result = await streamResponseTextWithFallback({
        messages: context.messages,
        maxOutputTokens: 3200,
        onDelta(delta) {
          generated += delta;
          emit({ type: "delta", delta });
        }
      });

      if (!generated.trim() && result.text) {
        emit({ type: "delta", delta: result.text });
      }

      emit({ type: "stage", stage: "save", message: "正在写入账号风格卡", progress: 90 });
      const saved = await completePreparedAccountStyle(context, result);
      emit({ type: "result", data: saved });
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
      { error: error instanceof Error ? error.message : "自动总结风格失败" },
      { status: 400 }
    );
  }
}
