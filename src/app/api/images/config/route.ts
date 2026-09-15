import { apiJson } from "@/lib/api-route";
import { assertJobKindAllowedForAppMode } from "@/lib/app-mode";
import { imageConfig } from "@/lib/image-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return apiJson(() => {
    assertJobKindAllowedForAppMode("image-generation");
    const config = imageConfig();
    return { configured: Boolean(config.apiKey), model: config.model };
  }, { fallbackMessage: "读取图片模型配置失败" });
}
