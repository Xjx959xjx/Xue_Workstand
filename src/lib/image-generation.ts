import { callImageApi, imageConfig } from "./image-runtime";
import { imageGenerationInputSchema, type ImageGenerationInput, type ImageGenerationRecord } from "./image-generation-types";
import { getImageFile, saveImageFile, saveImageRecord } from "./storage/images";
import { STORAGE_SCHEMA_VERSION } from "./storage/schemas";

export async function generateImages(id: string, input: ImageGenerationInput, options: {
  signal?: AbortSignal;
  onProgress: (message: string, progress: number, saved: boolean) => Promise<void>;
}) {
  const params = imageGenerationInputSchema.parse(input);
  const config = imageConfig();
  const now = new Date().toISOString();
  const record: ImageGenerationRecord = { ...params, schemaVersion: STORAGE_SCHEMA_VERSION, id, model: config.model, images: [], createdAt: now, updatedAt: now };
  options.signal?.throwIfAborted();
  await saveImageRecord(record);
  await options.onProgress("正在准备参考图", 5, true);
  const referenceFiles = [];
  for (const referenceId of params.referenceIds) {
    options.signal?.throwIfAborted();
    const { image, bytes, contentType } = await getImageFile(referenceId);
    referenceFiles.push({ name: `${image.id}.${image.format}`, bytes, contentType });
  }
  for (let index = 0; index < params.count; index++) {
    options.signal?.throwIfAborted();
    await options.onProgress(`正在生成第 ${index + 1} / ${params.count} 张图片`, 10 + Math.floor(index / params.count * 85), false);
    const bytes = await callImageApi({ config: { ...config, size: params.size, quality: params.quality }, prompt: params.prompt, referenceFiles, signal: options.signal });
    options.signal?.throwIfAborted();
    const image = await saveImageFile(bytes, `生成图片 ${index + 1}`);
    record.images.push(image);
    record.updatedAt = new Date().toISOString();
    await saveImageRecord(record);
    await options.onProgress(`已保存 ${record.images.length} / ${params.count} 张图片`, 10 + Math.floor((index + 1) / params.count * 85), true);
  }
  return record;
}
