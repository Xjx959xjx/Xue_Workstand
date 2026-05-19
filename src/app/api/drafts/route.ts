import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteDrafts, getDrafts, saveDraft } from "@/lib/storage";
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

export async function GET() {
  try {
    return NextResponse.json({ drafts: await getDrafts() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取草稿失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await saveDraft(input));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存草稿失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = deleteSchema.parse(await request.json());
    return NextResponse.json(await deleteDrafts(input.draftIds));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除草稿失败" },
      { status: 400 }
    );
  }
}
