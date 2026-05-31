import { z } from "zod";
import { apiJson, parseJsonBody } from "@/lib/api-route";
import {
  createCopySourceProject,
  deleteCopySources,
  getCopySources,
  resolveCopySource,
  saveCopySource,
  updateCopySourceMaterialAnalysis
} from "@/lib/storage";
import { resolveLinkSourceMedia, transcribeLinkSource } from "@/lib/transcription";
import { analyzeCopySourceMaterial } from "@/lib/material-analysis";
import { createUrlPreprocessor } from "@/lib/link-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const transcribeSchema = z.object({
  action: z.literal("transcribe").optional(),
  url: z.preprocess(createUrlPreprocessor({ kind: "video" }), z.string().url()),
  titleHint: z.string().optional(),
  analyzeVideo: z.boolean().optional()
});

const projectSchema = z.object({
  action: z.literal("create_project"),
  name: z.string().min(1),
  description: z.string().optional(),
  sourceMaterialIds: z.array(z.string().min(1)).min(1)
});

const deleteSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1)
});

const reanalyzeSchema = z.object({
  action: z.literal("reanalyze"),
  sourceId: z.string().min(1)
});

export async function GET() {
  return apiJson(async () => ({ sources: await getCopySources() }), {
    fallbackMessage: "读取文案素材失败",
    status: 500
  });
}

export async function POST(request: Request) {
  return apiJson(async () => {
    const body = await request.json();
    const projectInput = projectSchema.safeParse(body);
    if (projectInput.success) {
      return {
        project: await createCopySourceProject(projectInput.data)
      };
    }

    const reanalyzeInput = reanalyzeSchema.safeParse(body);
    if (reanalyzeInput.success) {
      const source = await resolveCopySource(reanalyzeInput.data.sourceId);
      const media = await resolveLinkSourceMedia({
        url: source.url,
        resolvedUrl: source.resolvedUrl,
        platform: source.platform
      });
      const materialAnalysis = await analyzeCopySourceMaterial({
        mediaUrls: media.mediaUrls,
        platform: media.platform,
        title: media.title || source.title,
        transcript: source.transcript,
        url: media.resolvedUrl || source.resolvedUrl || source.url
      });
      const updated = await updateCopySourceMaterialAnalysis(source.id, materialAnalysis);
      return { source: updated };
    }

    const input = transcribeSchema.parse(body);
    const result = await transcribeLinkSource({
      url: input.url,
      titleHint: input.titleHint,
      analyzeVideo: Boolean(input.analyzeVideo)
    });
    const materialAnalysis = input.analyzeVideo
      ? await analyzeCopySourceMaterial({
          mediaUrls: result.mediaUrls || [],
          platform: result.platform,
          title: result.title,
          transcript: result.text,
          url: result.resolvedUrl || result.url
        })
      : undefined;
    const source = await saveCopySource({
      title: result.title,
      platform: result.platform,
      url: result.url,
      resolvedUrl: result.resolvedUrl,
      transcript: result.text,
      source: result.source,
      fallback: result.fallback,
      fallbackReason: result.fallbackReason,
      materialAnalysis
    });

    return { source, result };
  }, {
    fallbackMessage: "链接转写失败"
  });
}

export async function DELETE(request: Request) {
  return apiJson(async () => {
    const input = await parseJsonBody(request, deleteSchema);
    return deleteCopySources(input.sourceIds);
  }, {
    fallbackMessage: "删除文案素材失败"
  });
}
