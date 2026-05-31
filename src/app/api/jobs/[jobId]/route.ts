import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import { cancelJob, getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  return apiJson(async () => {
    const { jobId } = await params;
    return { job: await getJob(jobId) };
  }, {
    fallbackMessage: "读取任务失败",
    status: 404
  });
}

const patchSchema = z.object({
  action: z.literal("cancel")
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, patchSchema);
    const { jobId } = await params;
    if (input.action !== "cancel") {
      throw new Error("不支持的任务操作");
    }
    return { job: await cancelJob(jobId) };
  }, {
    fallbackMessage: "停止任务失败"
  });
}
