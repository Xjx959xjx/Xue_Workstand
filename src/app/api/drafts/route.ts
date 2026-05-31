import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { deleteDrafts, getDrafts, saveDraft, updateDraftTitle } from "@/lib/storage";
import { platforms } from "@/lib/types";

export const runtime = "nodejs";

const accountDraftSchema = z.object({
  targetType: z.literal("account").optional(),
  platform: z.enum(platforms),
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  title: z.string().min(1),
  mode: z.enum(["topic", "rewrite"]),
  prompt: z.string().min(1),
  input: z.string().optional(),
  supportDocLinks: z.string().optional(),
  content: z.string().min(1),
  assets: z.any().optional(),
  styleRef: z.object({
    platform: z.enum(platforms),
    accountId: z.string(),
    accountName: z.string(),
    videoIds: z.array(z.string()).optional()
  })
});

const projectDraftSchema = z.object({
  targetType: z.literal("project"),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  title: z.string().min(1),
  mode: z.enum(["topic", "rewrite"]),
  prompt: z.string().min(1),
  input: z.string().optional(),
  supportDocLinks: z.string().optional(),
  content: z.string().min(1),
  assets: z.any().optional(),
  styleRef: z.object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    sourceAccountIds: z.array(z.string()).optional(),
    sourceMaterialIds: z.array(z.string()).optional()
  })
});

const schema = z.union([accountDraftSchema, projectDraftSchema]);
const deleteSchema = z.object({
  draftIds: z.array(z.string().min(1)).min(1)
});
const updateSchema = z.object({
  draftId: z.string().min(1),
  title: z.string().trim().min(1)
});

export async function GET() {
  return apiJson(async () => ({ drafts: await getDrafts() }), {
    fallbackMessage: "读取草稿失败",
    status: 500
  });
}

export async function POST(request: Request) {
  return apiJson(async () => saveDraft(await parseJsonBody(request, schema)), {
    fallbackMessage: "保存草稿失败"
  });
}

export async function DELETE(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, deleteSchema);
    return deleteDrafts(input.draftIds);
  }, {
    fallbackMessage: "删除草稿失败"
  });
}

export async function PATCH(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, updateSchema);
    return updateDraftTitle(input.draftId, input.title);
  }, {
    fallbackMessage: "更新草稿名称失败"
  });
}
