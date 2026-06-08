import { extractLinksFromInput } from "./platform-links";

export const DEFAULT_REWRITE_PROMPT = "按当前选中的账号/项目风格改写，保留素材核心信息和话题角度。";

export type SourceMaterial = {
  index: number;
  raw: string;
  text: string;
  urls: string[];
  transcribedText?: string;
  transcriptionError?: string;
};

export type RewriteSourceExtraction = {
  materials: SourceMaterial[];
  normalizedText: string;
  linkCount: number;
  textMaterialCount: number;
  onlyLinkCount: number;
  detectedShareText: boolean;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？、]+/gi;

export function extractRewriteSourceMaterial(input: string): RewriteSourceExtraction {
  const rawBlocks = splitSourceBlocks(input);
  const materials = rawBlocks
    .map((block, index) => {
      const urls = extractSourceUrls(block);
      return {
        index: index + 1,
        raw: block,
        text: cleanShareText(block, urls),
        urls
      } satisfies SourceMaterial;
    })
    .filter((material) => material.text || material.urls.length);

  const linkCount = materials.reduce((count, material) => count + material.urls.length, 0);
  const textMaterialCount = materials.filter((material) => material.text.trim()).length;
  const onlyLinkCount = materials.filter((material) => !material.text.trim() && material.urls.length).length;
  const detectedShareText = materials.some((material) => material.urls.length > 0 || /复制.*打开|直接观看视频/i.test(material.raw));

  return {
    materials,
    normalizedText: buildNormalizedSourceText(materials, input),
    linkCount,
    textMaterialCount,
    onlyLinkCount,
    detectedShareText
  };
}

export function normalizeRewritePrompt(mode: "topic" | "rewrite", prompt: string | undefined, sourceText: string | undefined) {
  const trimmedPrompt = (prompt || "").trim();
  if (trimmedPrompt || mode === "topic") return trimmedPrompt;

  const extracted = extractRewriteSourceMaterial(sourceText || "");
  return extracted.normalizedText.trim() ? DEFAULT_REWRITE_PROMPT : "";
}

function splitSourceBlocks(input: string) {
  const normalized = input
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!normalized) return [];

  return normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function extractSourceUrls(input: string) {
  return extractLinksFromInput(input).map((link) => link.url);
}

export function extractFirstSourceUrl(input: string) {
  return extractSourceUrls(input)[0] || "";
}

function cleanShareText(block: string, urls: string[]) {
  let text = block.replace(/\r\n?/g, "\n");

  for (const url of urls) {
    text = text.replaceAll(url, " ");
  }

  for (const link of extractLinksFromInput(block)) {
    text = text.replaceAll(link.raw, " ");
    text = text.replaceAll(link.url, " ");
  }

  text = text
    .replace(URL_PATTERN, " ")
    .replace(/复制此链接，?\s*打开(?:抖音|Dou音|Douyin).*?(?:直接)?观看视频[！!。]?/gi, " ")
    .replace(/复制(?:本条|这条)?(?:消息|链接).*?打开(?:抖音|Dou音|Douyin).*?$/gim, " ")
    .replace(/打开(?:抖音|Dou音|Douyin)(?:搜索)?.*?(?:观看视频|看视频)[！!。]?/gi, " ")
    .replace(/长按复制此条消息.*$/gim, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = stripDouyinSharePrefix(text);
  return text.replace(/\s+/g, " ").trim();
}

function stripDouyinSharePrefix(input: string) {
  const datePrefix = input.match(/^(.{0,80}?\b\d{1,2}\/\d{1,2}\s+)(?=[\u4e00-\u9fff#《【])/);
  if (datePrefix?.[1] && /[:：/@]|[A-Za-z][._-]/.test(datePrefix[1])) {
    return input.slice(datePrefix[1].length).trim();
  }

  const tokenPrefix = input.match(/^[\d.]+\s*[:：]\S+(?:\s+\S+){0,4}\s+(?=[\u4e00-\u9fff#《【])/);
  if (tokenPrefix?.[0]) {
    return input.slice(tokenPrefix[0].length).trim();
  }

  return input;
}

function buildNormalizedSourceText(materials: SourceMaterial[], fallback: string) {
  const trimmedFallback = fallback.trim();
  if (!materials.length) return trimmedFallback;

  if (materials.length === 1 && materials[0].text && !materials[0].urls.length) {
    return materials[0].text;
  }

  return materials
    .map((material) => {
      const lines = [`素材 ${material.index}：`];
      if (material.text) lines.push(material.text);
      if (material.urls.length) lines.push(`来源链接：${material.urls.join(" ")}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}
