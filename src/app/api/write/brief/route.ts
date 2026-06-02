import { prepareWriteBrief } from "@/lib/ai";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { writeCopyInputSchema } from "@/lib/write-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return apiJson(async () => prepareWriteBrief(await parseJsonBody(request, writeCopyInputSchema)), {
    fallbackMessage: "准备写作 brief 失败"
  });
}
