import { NextResponse } from "next/server";
import { z } from "zod";
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
  try {
    return NextResponse.json({ sources: await getCopySources() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取文案素材失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectInput = projectSchema.safeParse(body);
    if (projectInput.success) {
      return NextResponse.json({
        project: await createCopySourceProject(projectInput.data)
      });
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
      return NextResponse.json({ source: updated });
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

    return NextResponse.json({ source, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "链接转写失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = deleteSchema.parse(await request.json());
    return NextResponse.json(await deleteCopySources(input.sourceIds));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除文案素材失败" },
      { status: 400 }
    );
  }
}
