import { writeCopy } from "@/lib/ai";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { writeCopyInputSchema } from "@/lib/write-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return apiJson(async () => writeCopy(await parseJsonBody(request, writeCopyInputSchema), { signal: request.signal }), {
    fallbackMessage: "生成文案失败"
  });
}
