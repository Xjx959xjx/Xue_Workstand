import { completePreparedWriteCopy, prepareWriteCopyContext, streamResponseTextWithFallback } from "@/lib/ai";
import { apiError, parseJsonBody } from "@/lib/api-route";
import { hasFeishuDocLink } from "@/lib/feishu";
import { createNdjsonStream } from "@/lib/streaming";
import { writeCopyInputSchema } from "@/lib/write-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, writeCopyInputSchema);

    const stream = createNdjsonStream(async (emit, signal) => {
      emit({ type: "stage", stage: "prepare", message: "正在读取风格卡和代表样本", progress: 10 });
      if (input.mode === "rewrite" && /https?:\/\//i.test(input.sourceText || "")) {
        emit({ type: "stage", stage: "transcribe-links", message: "正在转写链接里的视频文稿", progress: 18 });
      }
      if (hasFeishuDocLink(input.supportDocLinks)) {
        emit({ type: "stage", stage: "fetch-support-docs", message: "正在读取商单支持文档", progress: 24 });
      }
      const prepared = await prepareWriteCopyContext(input);

      if (input.useWebResearch) {
        const researchUnavailable = prepared.research?.startsWith("联网资料：模型联网暂时不可用");
        emit({
          type: "stage",
          stage: "research",
          message: researchUnavailable ? "联网检索暂不可用，正在继续生成" : "联网检索已完成，正在整理资料",
          progress: 35
        });
        if (prepared.research) {
          emit({ type: "result", data: { research: prepared.research, phase: "research" } });
        }
      }

      emit({ type: "stage", stage: "generate", message: "正在生成文案", progress: 55 });
      const result = await streamResponseTextWithFallback({
        messages: prepared.messages,
        signal,
        onDelta(delta) {
          emit({ type: "delta", delta });
        }
      });

      if (!result.text.trim()) {
        emit({ type: "stage", stage: "fallback", message: "正在切换到本地模板", progress: 76 });
      }

      if (input.save) {
        emit({ type: "stage", stage: "save-draft", message: "正在保存历史记录", progress: 88 });
      }

      const finalResult = await completePreparedWriteCopy({
        prepared,
        result,
        save: input.save
      });

      emit({ type: "stage", stage: "finalize", message: "正在整理最终结果", progress: 95 });
      emit({ type: "result", data: finalResult });
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
      fallbackMessage: "生成文案失败"
    });
  }
}
