"use client";

import Image from "next/image";
import { ArrowLeft, Plus, X } from "lucide-react";
import { imageFileUrl, type ImageFile } from "@/lib/image-generation-types";
import { imageRatioForSize, imageRatios, imageSizeForProfile } from "@/lib/image-profile-options";
import type { useImageWorkbench } from "../_hooks/useImageWorkbench";
import { ImageModelPicker } from "./ImageControls";
import { ImageRecordDetails } from "./ImageRecordDetails";

type Workbench = ReturnType<typeof useImageWorkbench>;

export function ImageInspectorPanel({ workbench: w, view, showRecord, onShowRecord, onCloseRecord, onUpload, onPreview, onFocusPrompt }: {
  workbench: Workbench;
  view: "canvas" | "gallery";
  showRecord: boolean;
  onShowRecord: () => void;
  onCloseRecord: () => void;
  onUpload: () => void;
  onPreview: (image: ImageFile) => void;
  onFocusPrompt: () => void;
}) {
  const disabled = w.busy || w.uploading;
  const profile = w.config?.profiles.find((item) => item.id === (w.form.profileId || "default"));
  const ratio = imageRatioForSize(w.form.size);

  if (view === "gallery") {
    return <aside id="image-inspector" className="image-inspector" aria-label="图库概览">
      <span className="page-title-eyebrow">LIBRARY / 已保存</span>
      <h2>作品图库</h2>
      <p>选择作品返回画布，或在图库中勾选 2–4 张进行对比。</p>
      <dl className="image-context-facts"><div><dt>已保存作品</dt><dd>{w.total} 组</dd></div><div><dt>当前画布</dt><dd>{w.record ? "已有作品" : "新画布"}</dd></div></dl>
    </aside>;
  }

  if (showRecord && w.record) {
    return <aside id="image-inspector" className="image-inspector" aria-label="生成详情" onKeyDown={(event) => { if (event.key === "Escape") onCloseRecord(); }}>
      <button className="btn compact image-inspector-back" type="button" onClick={onCloseRecord}><ArrowLeft size={15} aria-hidden="true" />返回画面设置</button>
      <header className="image-pane-heading"><h2>生成详情</h2><button className="btn icon small" type="button" aria-label="关闭详情栏" onClick={onCloseRecord}><X size={17} aria-hidden="true" /></button></header>
      <ImageRecordDetails workbench={w} onPreview={onPreview} onReuse={(image) => { if (w.reuse(image)) { onCloseRecord(); onFocusPrompt(); } }} />
    </aside>;
  }

  return <aside id="image-inspector" className="image-inspector" aria-label="画面设置">
    <span className="page-title-eyebrow">CONTEXT / 当前工作</span>
    <h2>画面设置</h2>
    <p>调整本次生成参数，提示词留在画布下方。</p>
    <div className="image-inspector-model"><ImageModelPicker workbench={w} /></div>
    <fieldset className="image-inspector-group" disabled={disabled}>
      <legend>画幅比例</legend>
      <div className="image-inspector-options">{imageRatios.map((value) => <button key={value} type="button" aria-pressed={ratio === value} onClick={() => w.setForm((current) => ({ ...current, size: imageSizeForProfile(profile, value) }))}>{value}</button>)}</div>
    </fieldset>
    <fieldset className="image-inspector-group" disabled={disabled}>
      <legend>生成数量</legend>
      <div className="image-inspector-options">{[1, 2, 3, 4].map((count) => <button key={count} type="button" aria-label={`${count} 张`} aria-pressed={w.form.count === count} onClick={() => w.setForm((current) => ({ ...current, count }))}>{count}</button>)}</div>
      {w.multiModels.length > 1 ? <small>每个模型各生成 {w.form.count} 张</small> : null}
    </fieldset>
    <div className="image-inspector-group"><div className="image-inspector-group-heading"><strong>参考图片</strong><span>{w.references.length}/6</span></div>
      {w.references.length ? <div className="image-context-references">{w.references.map((image) => <div className="image-context-reference" key={image.id}><button type="button" onClick={() => onPreview(image)}><Image src={imageFileUrl(image.id)} alt="" width={34} height={34} unoptimized /><span>{image.name}</span></button><button className="btn icon small" type="button" aria-label={`移除参考图 ${image.name}`} disabled={disabled} onClick={() => w.removeReference(image.id)}><X size={14} aria-hidden="true" /></button></div>)}</div> : <p className="image-inspector-empty">还没有参考图。</p>}
      <button className="btn compact image-inspector-upload" type="button" disabled={disabled || w.references.length >= 6} onClick={onUpload}><Plus size={15} aria-hidden="true" />添加参考图</button>
    </div>
    {w.record ? <button className="btn image-open-record" type="button" onClick={onShowRecord}>查看当前生成详情</button> : null}
  </aside>;
}
