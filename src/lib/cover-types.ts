import { z } from "zod";

export const draftCoverInputSchema = z.object({
  draftId: z.string().trim().min(1).max(160).regex(/^[\p{L}\p{N}_-]+$/u, "草稿 ID 不合法。"),
  referenceIds: z.array(z.string().min(1).max(300)).max(6, "最多使用 6 张封面参考图。").default([])
    .refine((ids) => new Set(ids).size === ids.length, "封面参考图重复，请移除重复选择。"),
  prompt: z.string().trim().max(12000, "封面提示词最多 12000 字。").optional(),
  count: z.number().int().min(1).max(4).default(2)
});
export type DraftCoverInput = z.infer<typeof draftCoverInputSchema>;
