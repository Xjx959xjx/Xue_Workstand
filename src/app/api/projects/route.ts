import { NextResponse } from "next/server";
import { z } from "zod";
import { generateProjectStyleProfile, saveAndGenerateProjectStyleProfile } from "@/lib/ai";
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
  try {
    const { searchParams } = new URL(request.url);
    const input = z.object({ projectId: z.string().min(1) }).parse({
      projectId: searchParams.get("projectId")
    });
    return NextResponse.json(
      await getProjectDetail(input.projectId, {
        includeStyle: parseBooleanFlag(searchParams.get("includeStyle"))
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取项目详情失败" },
      { status: 400 }
    );
  }
}

function parseBooleanFlag(value: string | null) {
  return value === "1" || value === "true";
}

export async function POST(request: Request) {
  try {
    const input = baseSchema.parse(await request.json());
    const project = await upsertProject(input);
    return NextResponse.json(await getProjectSummary(project));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存项目失败" },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const input = z.object({ projectId: z.string().min(1), content: z.string().min(1) }).parse(await request.json());
    const style = await saveProjectStyle(input.projectId, input.content);
    return NextResponse.json({ style });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存项目风格失败" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const saveAndGenerateSchema = baseSchema.extend({
      sourceAccountIds: z.array(z.string().min(1)).default([])
    });
    const legacySchema = z.object({ projectId: z.string().min(1) });
    const parsed = saveAndGenerateSchema.safeParse(body);

    if (parsed.success && "name" in body) {
      return NextResponse.json(await saveAndGenerateProjectStyleProfile(parsed.data));
    }

    const input = legacySchema.parse(body);
    return NextResponse.json(await generateProjectStyleProfile(input.projectId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动总结项目风格失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = z.object({ projectIds: z.array(z.string().min(1)).min(1) }).parse(await request.json());
    return NextResponse.json(await deleteProjects(input.projectIds));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除项目失败" },
      { status: 400 }
    );
  }
}
