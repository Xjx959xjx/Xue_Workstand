import { z } from "zod";
import { generateProjectStyleProfile, saveAndGenerateProjectStyleProfile } from "@/lib/ai";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { deleteProjects, getProjectDetail, getProjectSummary, saveProjectStyle, upsertProject } from "@/lib/storage";

export const runtime = "nodejs";

const baseSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  sourceAccountIds: z.array(z.string()).default([]),
  sourceMaterialIds: z.array(z.string()).optional()
});

export async function GET(request: Request) {
  return apiJson(async () => {
    const { searchParams } = new URL(request.url);
    const input = z.object({ projectId: z.string().min(1) }).parse({
      projectId: searchParams.get("projectId")
    });
    return getProjectDetail(input.projectId, {
      includeStyle: parseBooleanFlag(searchParams.get("includeStyle"))
    });
  }, {
    fallbackMessage: "读取项目详情失败"
  });
}

function parseBooleanFlag(value: string | null) {
  return value === "1" || value === "true";
}

export async function POST(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, baseSchema);
    const project = await upsertProject(input);
    return getProjectSummary(project);
  }, {
    fallbackMessage: "保存项目失败"
  });
}

export async function PUT(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, z.object({ projectId: z.string().min(1), content: z.string().min(1) }));
    const style = await saveProjectStyle(input.projectId, input.content);
    return { style };
  }, {
    fallbackMessage: "保存项目风格失败"
  });
}

export async function PATCH(request: Request) {
  return apiJson(async () => {
    const body = await request.json();
    const saveAndGenerateSchema = baseSchema.extend({
      sourceAccountIds: z.array(z.string().min(1)).default([])
    });
    const legacySchema = z.object({ projectId: z.string().min(1) });
    const parsed = saveAndGenerateSchema.safeParse(body);

    if (parsed.success && "name" in body) {
      return saveAndGenerateProjectStyleProfile(parsed.data, { signal: request.signal });
    }

    const input = legacySchema.parse(body);
    return generateProjectStyleProfile(input.projectId, { signal: request.signal });
  }, {
    fallbackMessage: "自动总结项目风格失败"
  });
}

export async function DELETE(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, z.object({ projectIds: z.array(z.string().min(1)).min(1) }));
    return deleteProjects(input.projectIds);
  }, {
    fallbackMessage: "删除项目失败"
  });
}
