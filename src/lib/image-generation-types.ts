import { z } from "zod";

export const imageSizes = ["1024x1024", "1536x1024", "1024x1536"] as const;
export const imageQualities = ["auto", "high", "medium", "low"] as const;
export const imageGenerationInputSchema = z.object({
  prompt: z.string().trim().min(1, "请填写提示词。").max(12000, "提示词最多 12000 字。"),
  size: z.enum(imageSizes),
  quality: z.enum(imageQualities),
  count: z.number().int().min(1).max(4, "每次最多生成 4 张图片。"),
  referenceIds: z.array(z.string().uuid("参考图 ID 不合法。")).max(6, "最多使用 6 张参考图。")
});
export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>;
export type ImageFile = { id: string; name: string; format: "png" | "jpeg" | "webp"; createdAt: string };
export type ImageGenerationRecord = ImageGenerationInput & {
  schemaVersion: number;
  id: string;
  model: string;
  images: ImageFile[];
  createdAt: string;
  updatedAt: string;
};
export type ImageGenerationSummary = Pick<ImageGenerationRecord, "id" | "model" | "size" | "count" | "createdAt" | "updatedAt"> & {
  title: string;
  imageCount: number;
  thumbnail?: ImageFile;
};
export type ImageGenerationConfig = { configured: boolean; model: string };
export type ImageGenerationList = { records: ImageGenerationSummary[]; total: number };
export function imageFileUrl(id: string, download = false) {
  return `/api/images/files/${encodeURIComponent(id)}${download ? "?download=1" : ""}`;
}
