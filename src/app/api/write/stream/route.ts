import {
  completePreparedWriteCopy,
  prepareWriteCopyContext,
  streamResponseTextWithFallback,
  WRITE_COPY_MAX_OUTPUT_TOKENS,
  WRITE_COPY_REASONING_EFFORT
} from "@/lib/ai";
import { apiError, parseJsonBody } from "@/lib/api-route";
import { hasSupportDocumentReference } from "@/lib/support-documents";
import { extractRewriteSourceMaterial, splitWriterSourceInput } from "@/lib/source-extraction";
import { createNdjsonStream } from "@/lib/streaming";
import { writeCopyInputSchema } from "@/lib/write-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, writeCopyInputSchema);

    const stream = createNdjsonStream(async (emit, signal) => {
      const isRevision = input.action === "revise";
      const separatedSourceInput = splitWriterSourceInput(input.sourceText || "", input.supportDocLinks || "");
      const sourceExtraction = extractRewriteSourceMaterial(separatedSourceInput.sourceText);
      emit({
        type: "stage",
        stage: "prepare",
        message: isRevision ? "正在读取当前稿件和版本上下文" : "正在读取风格卡和代表样本",
        progress: 10
      });
      if (!isRevision && input.mode === "rewrite" && sourceExtraction.pendingLinkCount > 0) {
        emit({ type: "stage", stage: "transcribe-links", message: "正在转写链接里的视频文稿", progress: 18 });
      }
      if (!isRevision && hasSupportDocumentReference(separatedSourceInput.supportDocLinks)) {
        emit({ type: "stage", stage: "fetch-support-docs", message: "正在读取商单支持文档", progress: 24 });
      }
      const prepared = await prepareWriteCopyContext(input, { signal });

      if (!isRevision && input.useWebResearch) {
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

      emit({
        type: "stage",
        stage: "generate",
        message: isRevision ? "正在按本轮要求生成新版本" : "正在生成文案",
        progress: 55
      });
      const result = await streamResponseTextWithFallback({
        messages: prepared.messages,
        reasoningEffort: WRITE_COPY_REASONING_EFFORT,
        maxOutputTokens: WRITE_COPY_MAX_OUTPUT_TOKENS,
        signal,
        onDelta(delta) {
          emit({ type: "delta", delta });
        }
      });

      if (input.save) {
        emit({ type: "stage", stage: "save-draft", message: "正在保存历史记录", progress: 88 });
      }

      const finalResult = await completePreparedWriteCopy({
        prepared,
        result,
        save: input.save,
        signal
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
