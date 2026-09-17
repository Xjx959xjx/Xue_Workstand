import type { ImageFile, ImageGenerationRecord, ImageGenerationSummary } from "./image-generation-types";

export function imageCanvasLinks(records: ImageGenerationSummary[], references: ImageFile[], selected: ImageGenerationRecord | null) {
  const recordIds = new Set(records.map((record) => record.id));
  const sources = new Map(references.map((image) => [image.id, `ref-${image.id}`]));
  for (const record of records) if (record.thumbnail) sources.set(record.thumbnail.id, record.id);
  if (selected && recordIds.has(selected.id)) for (const image of selected.images) sources.set(image.id, selected.id);
  const links: { source: string; target: string; label: string; kind: "branch" | "reference" }[] = [];
  for (const record of records) {
    const seen = new Set<string>();
    if (record.parentRecordId && recordIds.has(record.parentRecordId) && record.parentRecordId !== record.id) {
      seen.add(record.parentRecordId);
      links.push({ source: record.parentRecordId, target: record.id, label: "修改分支", kind: "branch" });
    }
    const ids = record.referenceIds || (selected?.id === record.id ? selected.referenceIds : []);
    ids.forEach((id, index) => {
      const source = sources.get(id);
      if (!source || source === record.id || seen.has(source)) return;
      seen.add(source);
      links.push({ source, target: record.id, label: `参考图 ${index + 1}`, kind: "reference" });
    });
  }
  return links;
}
