import { NextResponse } from "next/server";
import { z } from "zod";
import { collectDraftCoverReferences } from "@/lib/cover";
import { saveUploadedDraftCoverReferences } from "@/lib/storage";

export const runtime = "nodejs";

const jsonSchema = z.object({
  draftId: z.string().min(1)
});

const MAX_REFERENCE_FILES = 8;
const MAX_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 40 * 1024 * 1024;
const ALLOWED_REFERENCE_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const draftId = String(formData.get("draftId") || "");
      if (!draftId) throw new Error("缺少草稿 ID");
      const imageFiles = formData
        .getAll("files")
        .filter((item): item is File => item instanceof File);
      if (!imageFiles.length) throw new Error("请选择至少一张参考图");
      if (imageFiles.length > MAX_REFERENCE_FILES) {
        throw new Error(`最多一次上传 ${MAX_REFERENCE_FILES} 张参考图`);
      }

      let totalBytes = 0;
      const files = await Promise.all(
        imageFiles.map(async (file) => {
          if (!ALLOWED_REFERENCE_IMAGE_TYPES.has(file.type)) {
            throw new Error(`不支持的参考图格式：${file.name || file.type}`);
          }
          if (file.size > MAX_REFERENCE_FILE_BYTES) {
            throw new Error(`单张参考图不能超过 10MB：${file.name || "未命名文件"}`);
          }
          totalBytes += file.size;
          if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) {
            throw new Error("参考图总大小不能超过 40MB");
          }
          return {
            name: file.name,
            type: file.type,
            data: Buffer.from(await file.arrayBuffer())
          };
        })
      );
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
