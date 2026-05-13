import { NextResponse } from "next/server";
import { z } from "zod";
import { collectDraftCoverReferences } from "@/lib/cover";
import { saveUploadedDraftCoverReferences } from "@/lib/storage";

export const runtime = "nodejs";

const jsonSchema = z.object({
  draftId: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const draftId = String(formData.get("draftId") || "");
      if (!draftId) throw new Error("缺少草稿 ID");
      const files = await Promise.all(
        formData
          .getAll("files")
          .filter((item): item is File => item instanceof File)
          .map(async (file) => {
            if (!file.type.startsWith("image/")) {
              throw new Error(`不支持的参考图格式：${file.name || file.type}`);
            }
            return {
              name: file.name,
              type: file.type,
              data: Buffer.from(await file.arrayBuffer())
            };
          })
      );
      if (!files.length) throw new Error("请选择至少一张参考图");
      return NextResponse.json(await saveUploadedDraftCoverReferences({ draftId, files }));
    }

    const input = jsonSchema.parse(await request.json());
    return NextResponse.json(await collectDraftCoverReferences(input.draftId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "处理封面参考图失败" },
      { status: 400 }
    );
  }
}
