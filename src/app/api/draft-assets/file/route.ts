import { NextResponse } from "next/server";
import { getDraftAssetFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const draftId = url.searchParams.get("draftId") || "";
    const path = url.searchParams.get("path") || "";
    if (!draftId || !path) throw new Error("缺少素材路径");
    const file = await getDraftAssetFile(draftId, path);
    return new Response(file.bytes, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取素材失败" },
      { status: 400 }
    );
  }
}
