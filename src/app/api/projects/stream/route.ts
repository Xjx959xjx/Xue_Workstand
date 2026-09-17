import { z } from "zod";
import {
  buildSavedProjectStyleResult,
  completeCachedProjectStyle,
  completePreparedProjectStyle,
  prepareSavedProjectStyleContext,
  streamStyleResponseTextWithFallback
} from "@/lib/ai";
import { apiError, parseJsonBody } from "@/lib/api-route";
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
    const input = await parseJsonBody(request, schema);

    const stream = createNdjsonStream(async (emit, signal) => {
      const startedAt = Date.now();
      emit({ type: "stage", stage: "validate", message: "正在校验项目配置", progress: 15 });
      if (!input.sourceAccountIds.length && !input.sourceMaterialIds?.length) {
        throw new Error("先加案例或账号");
      }

      emit({ type: "stage", stage: "prepare", message: "正在保存项目并读取参考样本", progress: 35 });
      const prepared = await prepareSavedProjectStyleContext(input, {
        signal,
        onAnalysisProgress(progress) {
          const percent = progress.analysisCount
            ? Math.floor((progress.completedCount / progress.analysisCount) * 30)
            : 0;
          emit({
            type: "stage",
            stage: "analysis",
            message: progress.message || `正在分析完整样本 ${progress.completedCount}/${progress.analysisCount}`,
            progress: Math.min(44, 15 + percent)
          });
        }
      });
      const cached = completeCachedProjectStyle(prepared.context);
      if (cached) {
        emit({ type: "stage", stage: "cache", message: "样本未变化，已复用现有项目风格卡", progress: 100 });
        emit({ type: "delta", delta: cached.style });
        emit({
          type: "result",
          data: await buildSavedProjectStyleResult(prepared, { ...cached, totalMs: Date.now() - startedAt })
        });
        return;
      }

      let generated = "";
      let firstDeltaMs: number | undefined;
      emit({ type: "stage", stage: "generate", message: "正在生成项目风格卡", progress: 45 });
      const completion = await streamStyleResponseTextWithFallback({
        messages: prepared.context.messages,
        signal,
        onDelta(delta) {
          if (firstDeltaMs === undefined) firstDeltaMs = Date.now() - startedAt;
          generated += delta;
          emit({ type: "delta", delta });
        }
      });

      if (!generated.trim() && completion.text) {
        if (firstDeltaMs === undefined) firstDeltaMs = Date.now() - startedAt;
        emit({ type: "delta", delta: completion.text });
      }

      emit({ type: "stage", stage: "finalize", message: "正在写入项目风格卡", progress: 92 });
      const saved = await completePreparedProjectStyle(prepared.context, completion, {
        firstDeltaMs,
        totalMs: Date.now() - startedAt
      });
      const result = await buildSavedProjectStyleResult(prepared, saved);
      emit({ type: "result", data: result });
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
      fallbackMessage: "自动总结项目风格失败"
    });
  }
}
