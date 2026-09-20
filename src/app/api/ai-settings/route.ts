import { apiJson, parseJsonBody } from "@/lib/api-route";
import { getAiSettingsView } from "@/lib/ai-policy-runtime";
import { aiSettingsSchema } from "@/lib/storage/schemas";
import { saveAiSettings, validateAiSettings } from "@/lib/storage/ai-settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return apiJson(getAiSettingsView, { fallbackMessage: "读取 AI 模型配置失败" });
}
export async function PUT(request: Request) {
  return apiJson(async () => {
    const body = await parseJsonBody(request, aiSettingsSchema);
    let value;
    try { value = validateAiSettings(body); }
    catch (error) { throw Object.assign(error instanceof Error ? error : new Error("AI 配置无效"), { status: 400 }); }
    await saveAiSettings(value);
    return getAiSettingsView();
  }, { fallbackMessage: "保存 AI 模型配置失败" });
}
