import { apiJson } from "@/lib/api-route";
import { getLibrary } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return apiJson(() => getLibrary(), {
    fallbackMessage: "读取风格库失败",
    status: 500
  });
}
