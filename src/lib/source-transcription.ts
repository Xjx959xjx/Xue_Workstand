import { extractRewriteSourceMaterial, RewriteSourceExtraction, SourceMaterial } from "./source-extraction";
import { isSupportedVideoSourceLink, transcribeLinkSource, LinkTranscriptionResult } from "./transcription";

type ResolveRewriteSourceMaterialOptions = {
  linkMode?: "all" | "video-only";
};

export async function resolveRewriteSourceMaterial(
  input: string,
  options: ResolveRewriteSourceMaterialOptions = {}
): Promise<RewriteSourceExtraction> {
  const extracted = extractRewriteSourceMaterial(input);
  if (!extracted.materials.some((material) => material.urls.length)) return extracted;

  const materials = await Promise.all(
    extracted.materials.map(async (material) => {
      if (!material.urls.length) return material;

      const transcriptBlocks: string[] = [];
      const errors: string[] = [];
      for (const url of material.urls) {
        if (options.linkMode === "video-only" && !isSupportedVideoSourceLink(url)) continue;
        try {
          const result = await transcribeLinkSource({
            url,
            titleHint: material.text
          });
          transcriptBlocks.push(formatLinkTranscript(result));
        } catch (error) {
          errors.push(`${url}：${error instanceof Error ? error.message : "链接转写失败"}`);
        }
      }

      return {
        ...material,
        transcribedText: transcriptBlocks.join("\n\n").trim(),
        transcriptionError: errors.join("\n")
      } satisfies SourceMaterial;
    })
  );

  const linkMaterials = materials.filter((material) => material.urls.length);
  const attemptedLinkMaterials = linkMaterials.filter((material) => material.transcribedText?.trim() || material.transcriptionError?.trim());
  const successfulLinkMaterials = linkMaterials.filter((material) => material.transcribedText?.trim());
  if (attemptedLinkMaterials.length && !successfulLinkMaterials.length) {
    const detail = attemptedLinkMaterials
      .map((material) => material.transcriptionError)
      .filter(Boolean)
      .join("\n");
    throw new Error(`链接视频文稿转写失败${detail ? `：${detail}` : ""}`);
  }

  return {
    ...extracted,
    materials,
    normalizedText: buildResolvedSourceText(materials, input),
    textMaterialCount: materials.filter((material) => (material.transcribedText || material.text).trim()).length
  };
}

function buildResolvedSourceText(materials: SourceMaterial[], fallback: string) {
  const trimmedFallback = fallback.trim();
  if (!materials.length) return trimmedFallback;

  return materials
    .map((material) => {
      const lines = [`素材 ${material.index}：`];
      if (material.transcribedText) {
        lines.push(material.transcribedText);
      } else {
        if (material.text) lines.push(material.text);
        if (material.urls.length) {
          if (material.transcriptionError) {
            lines.push("链接转写失败，未取得可用视频文稿。");
            lines.push(material.transcriptionError);
          } else if (!material.text) {
            lines.push(`原始链接：${material.urls.join(" ")}`);
          }
        }
      }
      if (material.urls.length) lines.push(`来源链接：${material.urls.join(" ")}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

function formatLinkTranscript(result: LinkTranscriptionResult) {
  const lines = [];
  if (result.title) lines.push(`标题：${result.title}`);
  lines.push(`视频文稿：\n${result.text}`);
  if (result.fallbackReason) lines.push(`转写说明：${result.fallbackReason}`);
  return lines.join("\n");
}
