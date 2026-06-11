import { apiJson } from "@/lib/api-route";
import { getLibraryOverview } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeAuxiliary = searchParams.get("include") === "all";
  return apiJson(() => getLibraryOverview({ includeAuxiliary }), {
    fallbackMessage: "读取风格库概览失败",
    status: 500
  });
}
