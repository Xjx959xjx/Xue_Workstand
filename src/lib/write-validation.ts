import { z } from "zod";
import { platforms } from "./types";
import { normalizeRewritePrompt, splitWriterSourceInput } from "./source-extraction";

const writeStyleReferenceSchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("account"),
    platform: z.enum(platforms),
    accountId: z.string().min(1)
  }),
  z.object({
    targetType: z.literal("project"),
    projectId: z.string().min(1)
  })
]);

export const writeCopyInputSchema = z.object({
  action: z.enum(["create", "revise"]).optional().default("create"),
  targetType: z.enum(["account", "project"]).optional(),
  platform: z.enum(platforms).optional(),
  accountId: z.string().optional(),
  projectId: z.string().optional(),
  styleRefs: z.array(writeStyleReferenceSchema).min(1).max(8, "一次最多并发生成 8 个风格").optional(),
  mode: z.enum(["topic", "rewrite"]),
  prompt: z.string().optional().default(""),
  originalSourceInput: z.string().optional(),
  sourceText: z.string().optional(),
  supportDocLinks: z.string().optional(),
  save: z.boolean().optional(),
  useWebResearch: z.boolean().optional(),
  parentDraftId: z.string().min(1).optional(),
  currentContent: z.string().max(120_000).optional(),
  revisionInstruction: z.string().trim().max(4_000).optional(),
  revisionScope: z.enum(["full", "selection"]).optional().default("full"),
  selectedText: z.string().max(30_000).optional()
}).superRefine((input, ctx) => {
  if (input.action === "revise") {
    if (!input.parentDraftId) {
      ctx.addIssue({ code: "custom", message: "请选择要继续修改的稿件版本", path: ["parentDraftId"] });
    }
    if (!input.currentContent?.trim()) {
      ctx.addIssue({ code: "custom", message: "当前稿件内容为空，无法继续修改", path: ["currentContent"] });
    }
    if (!input.revisionInstruction?.trim()) {
      ctx.addIssue({ code: "custom", message: "请填写本轮修改要求", path: ["revisionInstruction"] });
    }
    if (input.revisionScope === "selection" && !input.selectedText?.trim()) {
      ctx.addIssue({ code: "custom", message: "请先在稿件中选中需要修改的段落", path: ["selectedText"] });
    }
    return;
  }

  const mode = input.mode;
  const combinedSourceInput = [input.sourceText?.trim(), input.supportDocLinks?.trim()].filter(Boolean).join("\n\n");
  const separatedInput = splitWriterSourceInput(input.sourceText || "", input.supportDocLinks || "");
  const prompt = normalizeRewritePrompt(input.mode, input.prompt, combinedSourceInput);
  const sourceText = separatedInput.sourceText;

  if (mode === "topic" && !prompt.trim()) {
    ctx.addIssue({ code: "custom", message: "请填写写作主题", path: ["prompt"] });
  } else if (mode === "rewrite" && !prompt.trim() && !sourceText && !separatedInput.supportDocLinks) {
    ctx.addIssue({ code: "custom", message: "请填写改写要求或粘贴原文素材", path: ["sourceText"] });
  }

  if (input.styleRefs?.length) return;

  if (input.targetType === "project" || input.projectId) {
    if (!input.projectId) {
      ctx.addIssue({ code: "custom", message: "请选择参考项目", path: ["projectId"] });
    }
    return;
  }

  if (!input.platform || !input.accountId) {
    ctx.addIssue({ code: "custom", message: "请选择至少一个参考风格", path: ["accountId"] });
  }
});
