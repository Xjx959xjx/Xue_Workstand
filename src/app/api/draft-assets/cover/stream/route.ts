import { setTimeout } from "node:timers/promises";
import { apiError, parseJsonBody } from "@/lib/api-route";
import { draftCoverInputSchema } from "@/lib/cover-types";
import { cancelJob, createJob, getJob } from "@/lib/jobs";
import { resolveDraft } from "@/lib/storage";
import { createNdjsonStream } from "@/lib/streaming";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, draftCoverInputSchema);
    request.signal.throwIfAborted();
    const started = await createJob({ kind: "image-cover", input });
    const stream = createNdjsonStream(async (emit, signal) => {
      let updatedAt = "";
      let revision = 0;
      emit({ type: "stage", jobId: started.id, stage: "queued", message: "封面任务已排队", progress: 0 });
      try {
        while (!signal.aborted) {
          const job = await getJob(started.id);
          if (job.recoveryError) throw new Error(job.recoveryError);
          if (job.updatedAt !== updatedAt) {
            emit({ type: "stage", jobId: job.id, stage: job.stage || job.status, message: job.message, progress: job.progress });
            updatedAt = job.updatedAt;
          }
          if ((job.dataRevision || 0) > revision) {
            const draft = (await resolveDraft(input.draftId)).draft;
            const result = job.result as { imageIds?: string[] } | undefined;
            emit({ type: "result", data: { draft, images: (draft.assets?.cover?.images || []).filter((image) => result?.imageIds?.includes(image.id)), references: draft.assets?.cover?.references || [] } });
            revision = job.dataRevision || 0;
          }
          if (job.status === "completed") return;
          if (job.status === "failed" || job.status === "interrupted" || job.status === "cancelled") throw new Error(job.error || "封面任务已停止，已保存的图片仍然保留。");
          await setTimeout(500, undefined, { signal });
        }
      } finally {
        if (signal.aborted) {
          const job = await getJob(started.id);
          if (job.status === "queued" || job.status === "running") await cancelJob(job.id);
        }
      }
    }, { signal: request.signal });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    return apiError(error, {
      fallbackMessage: "生成封面失败"
    });
  }
}
