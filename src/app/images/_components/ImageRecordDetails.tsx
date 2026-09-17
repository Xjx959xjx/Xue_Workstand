"use client";
/* eslint-disable @next/next/no-img-element -- Local image history and references. */
import { Download } from "lucide-react";
import { imageFileUrl, type ImageFile } from "@/lib/image-generation-types";
import { imagePromptLabel } from "@/lib/image-mentions";
import { imageModelLabel } from "@/lib/image-profile-options";
import type { useImageWorkbench } from "../_hooks/useImageWorkbench";

type Workbench = ReturnType<typeof useImageWorkbench>;
export function ImageRecordDetails({ workbench: w, onPreview, onReuse }: { workbench: Workbench; onPreview: (image: ImageFile) => void; onReuse: (image?: ImageFile) => void }) {
  if (!w.record) return <p>选择画布上的记录查看详情。</p>;
  const record = w.record;
  return <div className="image-record-detail">
    <div className="image-record-meta"><strong>{imageModelLabel(record.model)}</strong><small>{record.size.replace("x", " × ")} · {record.images.length}/{record.count} 张 · 输出质量：{{ auto: "自动", high: "高", medium: "中", low: "低" }[record.quality]}</small></div>
    {record.images.map((image, index) => <article className="image-detail-result" key={image.id}>
      <button className="image-detail-open" type="button" aria-label={`放大方案 ${index + 1}`} onClick={() => onPreview(image)}><img src={imageFileUrl(image.id)} alt={`方案 ${index + 1}`} /></button>
      <div className="image-detail-actions"><button className="btn small" type="button" disabled={w.busy || w.uploading} title="把这张结果图作为参考，填写新的修改要求" onClick={() => onReuse(image)}>用这张图继续创作</button><a className="btn icon small" href={imageFileUrl(image.id, true)} download aria-label={`下载方案 ${index + 1}`}><Download size={14} /></a></div>
    </article>)}
    <details className="image-record-prompt-details"><summary>查看提示词与参考图</summary><p className="image-record-prompt">{imagePromptLabel(record.prompt)}</p>{w.recordReferences.length ? <div className="image-detail-references">{w.recordReferences.map((image, index) => <button className="btn small" key={image.id} type="button" title={`加入当前输入：${image.name}`} aria-label={`使用参考图 ${index + 1}`} disabled={w.busy || w.uploading} onClick={() => w.addReference(image)}><img src={imageFileUrl(image.id)} alt="" />参考图 {index + 1}</button>)}</div> : null}</details>
    <button className="btn" type="button" disabled={w.busy || w.uploading} title="将这次的提示词、参考图和参数载入下方编辑区" onClick={() => onReuse()}>载入这次设置</button>
  </div>;
}
