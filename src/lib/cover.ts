import { fetch as undiciFetch, ProxyAgent, type RequestInit as UndiciRequestInit } from "undici";
import { getBilibiliVideoReference } from "./opencli";
import { normalizeRemoteImageUrl } from "./platform-links";
import {
  getAccountSummary,
  getDraftAssetFile,
  getProjectSummary,
  resolveAccount,
  resolveDraft,
  resolveProject,
  saveGeneratedCoverImage,
  saveVideoAssetFields,
  updateDraftAssets
} from "./storage";
import { Draft, DraftCoverReference } from "./types";
import { clampText, nowIso, shortHash } from "./utils";

type FetchInitWithDispatcher = UndiciRequestInit & {
  dispatcher?: ProxyAgent;
};

export function getImageRuntimeConfig() {
  const config = imageConfig();
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    size: config.size,
    quality: config.quality,
    proxyConfigured: Boolean(config.proxyUrl),
    configured: Boolean(config.apiKey)
  };
}

export async function collectDraftCoverReferences(draftId: string) {
  const resolved = await resolveDraft(draftId);
  const contexts = await getBilibiliDraftContexts(resolved.draft);
  if (!contexts.length) {
    return {
      draft: resolved.draft,
      references: resolved.draft.assets?.cover?.references || [],
      supportsCover: false
    };
  }

  const references: DraftCoverReference[] = [];
  for (const context of contexts) {
    const account = await resolveAccount("bilibili", context.accountId);
    const summary = await getAccountSummary(account);
    for (const video of summary.videos.slice(0, 8)) {
      const existing = video.coverUrl;
      const reference = existing
        ? { thumbnail: existing, title: video.title, bvid: video.id }
        : await getBilibiliVideoReference(video).catch(() => null);
      if (!reference?.thumbnail) continue;
      if (!existing) {
        await saveVideoAssetFields("bilibili", context.accountId, video.id, {
          coverUrl: reference.thumbnail,
          raw: {
            ...(typeof video.raw === "object" && video.raw ? video.raw : {}),
            coverHydratedAt: nowIso()
          }
        }).catch(() => undefined);
      }
      references.push({
        id: `account-${context.accountId}-${video.id}-${shortHash(reference.thumbnail)}`,
        source: "account",
        label: `${context.accountName} / ${video.title}`,
        url: normalizeImageUrl(reference.thumbnail),
        accountId: context.accountId,
        accountName: context.accountName,
        videoId: video.id,
        videoTitle: video.title,
        createdAt: nowIso()
      });
    }
  }

  const draft = await updateDraftAssets(draftId, (current) => {
    const uploaded = (current.cover?.references || []).filter((reference) => reference.source === "upload");
    return {
      ...current,
      cover: {
        references: mergeReferences([...references, ...uploaded]),
        images: current.cover?.images || [],
        updatedAt: nowIso()
      }
    };
  });

  return {
    draft,
    references: draft.assets?.cover?.references || [],
    supportsCover: true
  };
}

export async function generateDraftCover(input: {
  draftId: string;
  referenceIds: string[];
  prompt?: string;
  count: number;
  signal?: AbortSignal;
  onStage?: (payload: { stage: string; message: string; progress?: number }) => void;
}) {
  throwIfAborted(input.signal);
  const config = imageConfig();
  if (!config.apiKey) {
    throw new Error("未配置 IMAGE_API_KEY，无法生成封面图片。");
  }

  input.onStage?.({ stage: "prepare", message: "正在读取草稿和参考图", progress: 12 });
  const resolved = await resolveDraft(input.draftId);
  const draft = resolved.draft;
  const references = draft.assets?.cover?.references || [];
  const selected = input.referenceIds.length
    ? references.filter((reference) => input.referenceIds.includes(reference.id))
    : references.slice(0, 3);
  const referenceFiles = await prepareReferenceImages(draft.id, selected.slice(0, 6), input.signal);
  const count = Math.max(1, Math.min(Math.round(input.count || 2), 4));
  const prompt = buildCoverPrompt(draft, input.prompt, selected);
  const images = [];

  for (let index = 0; index < count; index += 1) {
    throwIfAborted(input.signal);
    input.onStage?.({
      stage: "generate",
      message: `正在生成第 ${index + 1} 张封面`,
      progress: 24 + Math.round((index / count) * 48)
    });
    const bytes = await callImageApi({
      config,
      prompt: `${prompt}\n\n变体编号：${index + 1}`,
      referenceFiles,
      signal: input.signal
    });
    throwIfAborted(input.signal);
    input.onStage?.({
      stage: "save",
      message: `正在保存第 ${index + 1} 张封面`,
      progress: 72 + Math.round((index / count) * 20)
    });
    const saved = await saveGeneratedCoverImage({
      draftId: draft.id,
      bytes,
      prompt,
      referenceIds: selected.map((reference) => reference.id),
      model: config.model,
      size: config.size,
      quality: config.quality,
      format: config.format
    });
    images.push(saved.image);
  }

  input.onStage?.({ stage: "done", message: "封面生成完成", progress: 100 });
  const next = await resolveDraft(draft.id);
  return {
    draft: next.draft,
    images,
    references: next.draft.assets?.cover?.references || []
  };
}

async function getBilibiliDraftContexts(draft: Draft) {
  if (draft.targetType !== "project") {
    return draft.platform === "bilibili"
      ? [{ accountId: draft.accountId, accountName: draft.accountName }]
      : [];
  }

  const project = await resolveProject(draft.projectId);
  const summary = await getProjectSummary(project);
  return summary.sourceAccounts
    .filter((account) => account.platform === "bilibili")
    .map((account) => ({
      accountId: account.id,
      accountName: account.name
    }));
}

async function prepareReferenceImages(draftId: string, references: DraftCoverReference[], signal?: AbortSignal) {
  const files: Array<{ name: string; bytes: Buffer; contentType: string }> = [];
  for (const reference of references) {
    throwIfAborted(signal);
    if (reference.path) {
      const file = await getDraftAssetFile(draftId, reference.path).catch(() => null);
      if (file) files.push({ name: `${reference.id}.${extensionFromContentType(file.contentType)}`, bytes: file.bytes, contentType: file.contentType });
      continue;
    }
    if (reference.url) {
      const remote = await downloadReferenceImage(reference.url, signal).catch((error) => {
        if (isAbortError(error)) throw error;
        return null;
      });
      if (remote) files.push({ name: `${reference.id}.${extensionFromContentType(remote.contentType)}`, ...remote });
    }
  }
  return files;
}

async function downloadReferenceImage(url: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const response = await undiciFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 style-library"
    },
    dispatcher: imageConfig().proxyUrl ? new ProxyAgent(imageConfig().proxyUrl) : undefined,
    signal
  } as FetchInitWithDispatcher);
  if (!response.ok) throw new Error(`下载参考图失败：${response.status}`);
  throwIfAborted(signal);
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type")?.split(";")[0] || "image/jpeg"
  };
}

async function callImageApi(input: {
  config: ReturnType<typeof imageConfig>;
  prompt: string;
  referenceFiles: Array<{ name: string; bytes: Buffer; contentType: string }>;
  signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const form = new FormData();
  form.set("model", input.config.model);
  form.set("prompt", input.prompt);
  form.set("size", input.config.size);
  form.set("quality", input.config.quality);
  form.set("output_format", input.config.format === "jpeg" ? "jpeg" : input.config.format);
  form.set("n", "1");

  for (const file of input.referenceFiles) {
    const arrayBuffer = new ArrayBuffer(file.bytes.byteLength);
    new Uint8Array(arrayBuffer).set(file.bytes);
    form.append("image[]", new Blob([arrayBuffer], { type: file.contentType }), file.name);
  }

  const endpoint = input.referenceFiles.length ? "/images/edits" : "/images/generations";
  const response = await undiciFetch(`${input.config.baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`
    },
    body: form,
    dispatcher: input.config.proxyUrl ? new ProxyAgent(input.config.proxyUrl) : undefined,
    signal: input.signal
  } as FetchInitWithDispatcher);

  if (!response.ok) {
    throw new Error(describeImageFailure(response.status, await response.text()));
  }

  throwIfAborted(input.signal);
  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = data.data?.[0];
  if (first?.b64_json) return Buffer.from(first.b64_json, "base64");
  if (first?.url) {
    const remote = await downloadReferenceImage(first.url, input.signal);
    return remote.bytes;
  }
  throw new Error("图片模型没有返回可保存的图片。");
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("任务已停止");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted|任务已停止/i.test(error.message));
}

function imageConfig() {
  return {
    apiKey: process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl: (process.env.IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.IMAGE_MODEL || "gpt-image-2",
    size: process.env.IMAGE_SIZE || "2048x1152",
    quality: process.env.IMAGE_QUALITY || "medium",
    format: normalizeImageFormat(process.env.IMAGE_FORMAT),
    proxyUrl: process.env.IMAGE_PROXY_URL || process.env.CHAT_PROXY_URL || ""
  };
}

function buildCoverPrompt(draft: Draft, extraPrompt: string | undefined, references: DraftCoverReference[]) {
  const referenceText = references.length
    ? `参考图风格：${references.map((reference) => reference.label).join("；")}。请学习构图、色彩、信息层级和账号封面节奏，但不要复刻原图。`
    : "没有参考图时，请基于文案生成适合 B站的 16:9 视频封面。";
  return [
    "为 B站视频生成一张 16:9 封面图。",
    "画面要清晰、信息密度适中、主体明确，适合中文内容账号；不要出现平台水印、真实商标、二维码、错误小字。",
    referenceText,
    extraPrompt ? `额外要求：${extraPrompt}` : "",
    `草稿标题：${draft.title}`,
    `文案内容：${clampText(draft.content, 1800)}`
  ]
    .filter(Boolean)
    .join("\n");
}

function mergeReferences(references: DraftCoverReference[]) {
  const byId = new Map<string, DraftCoverReference>();
  for (const reference of references) byId.set(reference.id, reference);
  return [...byId.values()];
}

function normalizeImageUrl(url: string) {
  return normalizeRemoteImageUrl(url);
}

function normalizeImageFormat(value?: string): "jpeg" | "png" | "webp" {
  return value === "png" || value === "webp" ? value : "jpeg";
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

function describeImageFailure(status: number, body: string) {
  const trimmed = body.trim().replace(/\s+/g, " ").slice(0, 260);
  if (status === 401 || status === 403) return "图片模型鉴权失败，请检查 IMAGE_API_KEY。";
  if (status === 429) return "图片模型服务限流，请稍后重试。";
  return `图片模型调用失败：${status}${trimmed ? ` ${trimmed}` : ""}`;
}
