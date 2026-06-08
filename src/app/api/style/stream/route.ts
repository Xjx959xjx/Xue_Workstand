import { z } from "zod";
import {
  completeCachedAccountStyle,
  completePreparedAccountStyle,
  prepareAccountStyleContext,
  streamResponseTextWithFallback
} from "@/lib/ai";
import { apiError, parseJsonBody } from "@/lib/api-route";
import { createNdjsonStream } from "@/lib/streaming";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  platform: z.enum(platforms),
  accountId: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, schema);

    const stream = createNdjsonStream(async (emit, signal) => {
      emit({ type: "stage", stage: "prepare", message: "正在读取账号转写样本", progress: 12 });
      const context = await prepareAccountStyleContext(input.platform, input.accountId);
      const cached = completeCachedAccountStyle(context);
      if (cached) {
        emit({ type: "stage", stage: "cache", message: "样本未变化，已复用现有风格卡", progress: 100 });
        emit({ type: "delta", delta: cached.style });
        emit({ type: "result", data: cached });
        return;
      }

      let generated = "";
      emit({
        type: "stage",
        stage: "generate",
        message: context.generationMode === "incremental" ? "正在增量更新账号风格卡" : "正在生成账号风格卡",
        progress: 35
      });
      const result = await streamResponseTextWithFallback({
        messages: context.messages,
        maxOutputTokens: 3200,
        signal,
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
    }, { signal: request.signal });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    return apiError(error, {
      fallbackMessage: "自动总结风格失败"
    });
  }
}
