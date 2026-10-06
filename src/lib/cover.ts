import { resolveAiPolicy } from "./ai-policy-runtime";
import { callImageApi, imageConfig } from "./image-runtime";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { draftCoverInputSchema, type DraftCoverInput } from "./cover-types";
import { detectImageFormat } from "./storage/images";
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
import { Draft, DraftCoverReference, DraftCoverImage } from "./types";
import { clampText, nowIso, shortHash } from "./utils";

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
        : await getBilibiliVideoReference(video);
      if (!reference?.thumbnail) throw new Error(`视频「${video.title}」未返回封面参考图，已有参考图已保留。`);
      if (!existing) {
        await saveVideoAssetFields("bilibili", context.accountId, video.id, {
          coverUrl: reference.thumbnail,
          raw: {
            ...(typeof video.raw === "object" && video.raw ? video.raw : {}),
            coverHydratedAt: nowIso()
          }
        });
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
    return {
      ...current,
      cover: {
        references: mergeReferences([...(current.cover?.references || []), ...references]),
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

export async function generateDraftCover(input: DraftCoverInput & {
  signal?: AbortSignal;
  onStage?: (payload: { stage: string; message: string; progress?: number }) => void | Promise<void>;
  onSaved?: (images: DraftCoverImage[]) => Promise<void>;
}) {
  const params = draftCoverInputSchema.parse(input);
  throwIfAborted(input.signal);
  const baseConfig = imageConfig();
  const policy = await resolveAiPolicy("image_cover");
  const config = { ...baseConfig, model: policy.model || baseConfig.model };
  if (!config.apiKey) {
    throw new Error("未配置 IMAGE_API_KEY，无法生成封面图片。");
  }

  await input.onStage?.({ stage: "prepare", message: "正在读取草稿和参考图", progress: 12 });
  const resolved = await resolveDraft(params.draftId);
  const draft = resolved.draft;
  const references = draft.assets?.cover?.references || [];
  const selected = params.referenceIds.length
    ? params.referenceIds.map((id) => {
      const reference = references.find((entry) => entry.id === id);
      if (!reference) throw new Error("所选封面参考图不存在，请刷新后重新选择。");
      return reference;
    })
    : references.slice(0, 3);
  const referenceFiles = await prepareReferenceImages(draft.id, selected, input.signal);
  const count = params.count;
  const prompt = buildCoverPrompt(draft, params.prompt, selected);
  const images = [];

  for (let index = 0; index < count; index += 1) {
    throwIfAborted(input.signal);
    await input.onStage?.({
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
    await input.onStage?.({
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
    });
    images.push(saved.image);
    await input.onSaved?.([...images]);
  }

  await input.onStage?.({ stage: "done", message: "封面生成完成", progress: 100 });
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
      const file = await getDraftAssetFile(draftId, reference.path).catch(() => { throw new Error(`读取封面参考图「${reference.label}」失败，请检查素材文件是否完整。`); });
      validateReferenceBytes(file.bytes);
      files.push({ name: `${reference.id}.${detectImageFormat(file.bytes)}`, bytes: file.bytes, contentType: `image/${detectImageFormat(file.bytes)}` });
      continue;
    }
    if (reference.url) {
      const remote = await downloadReferenceImage(reference.url, signal);
      files.push({ name: `${reference.id}.${detectImageFormat(remote.bytes)}`, ...remote });
    } else throw new Error(`封面参考图「${reference.label}」缺少文件路径或地址，请重新采集。`);
  }
  return files;
}

async function downloadReferenceImage(url: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const proxyUrl = imageConfig().proxyUrl;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const timeout = AbortSignal.timeout(30_000);
  try {
    const response = await undiciFetch(normalizeImageUrl(url), {
      headers: { "User-Agent": "Mozilla/5.0 style-library" }, dispatcher,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`下载封面参考图失败（${response.status}），请重新采集。`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("封面参考图未返回图片内容，请重新采集。");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10 * 1024 * 1024) throw new Error("封面参考图超过 10MB，请缩小后重新上传。");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => { /* 图片读取已结束，只忽略流清理失败。 */ }); }
    const bytes = Buffer.concat(chunks);
    validateReferenceBytes(bytes);
    return { bytes, contentType: `image/${detectImageFormat(bytes)}` };
  } catch (error) {
    throwIfAborted(signal);
    if (timeout.aborted) throw new Error("下载封面参考图超时，请检查网络后重试。");
    if (error instanceof TypeError) throw new Error("下载封面参考图失败，请检查图片地址、代理和网络。");
    throw error;
  } finally { await dispatcher?.close(); }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("任务已停止");
  error.name = "AbortError";
  throw error;
}

function validateReferenceBytes(bytes: Buffer) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("封面参考图不能为空，且每张不能超过 10MB。");
  detectImageFormat(bytes);
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
