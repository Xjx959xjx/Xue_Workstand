import { z } from "zod";
import { platforms } from "./types";
import { normalizeRewritePrompt } from "./source-extraction";

export const writeCopyInputSchema = z.object({
  targetType: z.enum(["account", "project"]).optional(),
  platform: z.enum(platforms).optional(),
  accountId: z.string().optional(),
  projectId: z.string().optional(),
  mode: z.enum(["topic", "rewrite"]),
  prompt: z.string().optional().default(""),
  sourceText: z.string().optional(),
  supportDocLinks: z.string().optional(),
  brief: z.string().optional(),
  save: z.boolean().optional(),
  useWebResearch: z.boolean().optional()
}).superRefine((input, ctx) => {
  const mode = input.mode;
  const prompt = normalizeRewritePrompt(input.mode, input.prompt, input.sourceText);
  const sourceText = input.sourceText?.trim() || "";

  if (mode === "topic" && !prompt.trim()) {
    ctx.addIssue({ code: "custom", message: "请填写写作主题", path: ["prompt"] });
  } else if (mode === "rewrite" && !prompt.trim() && !sourceText) {
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
