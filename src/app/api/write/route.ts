import { NextResponse } from "next/server";
import { z } from "zod";
import { writeCopy } from "@/lib/ai";
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
    return NextResponse.json(await writeCopy(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成文案失败" },
      { status: 400 }
    );
  }
}
