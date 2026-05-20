import { NextResponse } from "next/server";
import { z } from "zod";
import { completePreparedWriteCopy, prepareWriteCopyContext, streamResponseTextWithFallback } from "@/lib/ai";
import { createNdjsonStream } from "@/lib/streaming";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  targetType: z.enum(["account", "project"]).optional(),
  platform: z.enum(platforms).optional(),
  accountId: z.string().optional(),
  projectId: z.string().optional(),
  mode: z.enum(["topic", "rewrite"]),
  prompt: z.string().optional().default(""),
  sourceText: z.string().optional(),
  save: z.boolean().optional(),
  useWebResearch: z.boolean().optional()
}).superRefine((input, ctx) => {
  if (input.mode === "topic" && !input.prompt.trim()) {
    ctx.addIssue({ code: "custom", message: "请填写写作主题", path: ["prompt"] });
  }
  if (input.mode === "rewrite" && !input.prompt.trim() && !input.sourceText?.trim()) {
    ctx.addIssue({ code: "custom", message: "请填写改写要求或粘贴原文素材", path: ["sourceText"] });
  }

  if (input.targetType === "project" || input.projectId) {
    if (!input.projectId) {
      ctx.addIssue({ code: "custom", message: "请选择参考项目", path: ["projectId"] });
    }
    return;
  }

  if (!input.platform || !input.accountId) {
    ctx.addIssue({ code: "custom", message: "请选择参考账号", path: ["accountId"] });
  }
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());

    const stream = createNdjsonStream(async (emit) => {
      emit({ type: "stage", stage: "prepare", message: "正在读取风格卡和代表样本", progress: 10 });
      if (input.mode === "rewrite" && /https?:\/\//i.test(input.sourceText || "")) {
        emit({ type: "stage", stage: "transcribe-links", message: "正在转写链接里的视频文稿", progress: 18 });
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
      { error: error instanceof Error ? error.message : "生成文案失败" },
      { status: 400 }
    );
  }
}
