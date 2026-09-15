import { z } from "zod";
import { apiJson } from "@/lib/api-route";
import { assertJobKindAllowedForAppMode } from "@/lib/app-mode";
import { listImageRecords } from "@/lib/storage/images";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiJson(async () => {
    assertJobKindAllowedForAppMode("image-generation");
    const offset = z.coerce.number().int().min(0).parse(new URL(request.url).searchParams.get("offset") || 0);
    return listImageRecords(offset);
  }, { fallbackMessage: "读取生图历史失败" });
}
