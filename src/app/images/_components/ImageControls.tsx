"use client";
/* eslint-disable @next/next/no-img-element -- Reference images are uploaded local files. */
import { useRef } from "react";
import { Upload, X, Sparkles, Square } from "lucide-react";
import { imageFileUrl, imageQualities, type ImageGenerationInput } from "@/lib/image-generation-types";
import type { useImageWorkbench } from "../_hooks/useImageWorkbench";

const sizes: { value: ImageGenerationInput["size"]; label: string; ratio: string }[] = [
  { value: "1024x1024", label: "方图", ratio: "1:1" },
  { value: "1536x1024", label: "横图", ratio: "3:2" },
  { value: "1024x1536", label: "竖图", ratio: "2:3" }
];
const qualityLabels = { auto: "自动", high: "高", medium: "中", low: "低" };
export function ImageControls({ workbench: w }: { workbench: ReturnType<typeof useImageWorkbench> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const disabled = w.busy || w.uploading || w.detailLoading;
  return <form className="image-controls" onSubmit={(event) => { event.preventDefault(); void w.generate(); }} onPaste={(event) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) { event.preventDefault(); void w.upload(files); }
  }}>
    <header className="image-pane-heading"><h2>生图工作台</h2><span className="status-pill">参数</span></header>
    <fieldset className="image-control-fields" disabled={disabled}>
      <label className="field image-field" htmlFor="image-prompt">提示词<textarea id="image-prompt" maxLength={12000} value={w.form.prompt} onChange={(event) => w.setForm((current) => ({ ...current, prompt: event.target.value }))} placeholder="描述画面主体、风格、构图、光线和用途…" rows={6} required /></label>
      <section className="image-field" aria-labelledby="reference-title">
        <div className="image-field-heading"><span id="reference-title">参考图 <small>{w.references.length}/6</small></span><button className="btn small" type="button" onClick={() => fileInput.current?.click()} disabled={w.references.length >= 6}><Upload size={14} />上传</button></div>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { void w.upload(Array.from(event.target.files || [])); event.target.value = ""; }} />
        <div className="image-reference-area" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!disabled) void w.upload(Array.from(event.dataTransfer.files)); }}>
          {w.references.length ? <div className="image-reference-grid">{w.references.map((image) => <div className="image-reference" key={image.id}><img src={imageFileUrl(image.id)} alt={image.name} /><button className="btn icon small" type="button" aria-label={`移除参考图 ${image.name}`} onClick={() => w.removeReference(image.id)}><X size={12} /></button></div>)}</div> : <button className="btn ghost image-upload-empty" type="button" onClick={() => fileInput.current?.click()}><Upload size={20} /><span>上传、拖入或粘贴参考图</span></button>}
        </div><small>PNG / JPEG / WebP · 每张最多 10MB</small>
      </section>
      <label className="field image-field" htmlFor="image-model">模型<select id="image-model" value={w.config?.model || ""} disabled><option value={w.config?.model || ""}>{w.config?.model || "正在读取配置…"}</option></select></label>
      <fieldset className="image-option-group"><legend>质量</legend><div className="image-options">{imageQualities.map((quality) => <button className="btn small" key={quality} type="button" aria-pressed={w.form.quality === quality} onClick={() => w.setForm((current) => ({ ...current, quality }))}>{qualityLabels[quality]}</button>)}</div></fieldset>
      <fieldset className="image-option-group"><legend>尺寸比例</legend><div className="image-options image-size-options">{sizes.map((size) => <button className="btn" key={size.value} type="button" aria-pressed={w.form.size === size.value} onClick={() => w.setForm((current) => ({ ...current, size: size.value }))}><span className="image-ratio-symbol" style={{ aspectRatio: size.ratio.replace(":", "/") }} aria-hidden="true" /><span>{size.ratio}</span><small>{size.label}</small></button>)}</div><small>{w.form.size.replace("x", " × ")} px</small></fieldset>
      <fieldset className="image-option-group"><legend>生成张数</legend><div className="image-options">{[1, 2, 3, 4].map((count) => <button className="btn small" key={count} type="button" aria-pressed={w.form.count === count} onClick={() => w.setForm((current) => ({ ...current, count }))}>{count} 张</button>)}</div></fieldset>
    </fieldset>
    <footer className="image-generate-footer">
      {w.config && !w.config.configured ? <p className="error" role="alert">图片服务未配置，请设置 IMAGE_API_KEY。</p> : null}
      <small aria-live="polite">{w.uploading ? "正在保存参考图…" : w.dirty ? "参数已修改，生成后保存到历史" : "生成结果自动保存到本地素材库"}</small>
      {w.active ? <button className="btn" type="button" disabled={w.busy} onClick={() => void w.cancel()}><Square size={15} />停止生成</button> : <button className="btn primary" type="submit" disabled={disabled || !w.config?.configured || !w.form.prompt.trim()} aria-busy={w.busy}><Sparkles size={16} />{w.busy ? "正在提交…" : w.record ? "再次生成" : "开始生成"}</button>}
    </footer>
  </form>;
}
