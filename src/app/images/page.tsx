"use client";
/* eslint-disable @next/next/no-img-element -- Generated assets use their original local-file URLs. */
import { Suspense, useState } from "react";
import { Download, ImagePlus, Plus, RefreshCw, ZoomIn } from "lucide-react";
import { imageFileUrl, type ImageFile } from "@/lib/image-generation-types";
import { useImageWorkbench } from "./_hooks/useImageWorkbench";
import { ImageControls } from "./_components/ImageControls";
import { ImagePreview } from "./_components/ImagePreview";

export default function ImagesPage() {
  return <Suspense fallback={<div className="empty-state-panel" role="status">正在加载生图工作台…</div>}><ImageWorkbench /></Suspense>;
}
function ImageWorkbench() {
  const w = useImageWorkbench();
  const [preview, setPreview] = useState<ImageFile | null>(null);
  return <div className="image-workbench" data-unsaved-changes={w.dirty || w.uploading ? "true" : undefined}>
    <aside className="image-history" aria-label="生成历史">
      <header className="image-pane-heading"><h2>生成记录</h2><span className="status-pill">{w.total}</span></header>
      <div className="image-history-actions"><button className="btn small" type="button" onClick={w.newRecord} disabled={w.busy || w.uploading}><Plus size={14} />新建</button><button className="btn icon small" type="button" aria-label="刷新生成记录" onClick={() => void w.refresh()}><RefreshCw size={14} /></button></div>
      <div className="image-history-list" aria-busy={w.loading}>
        {w.loading ? <p className="image-help" role="status">正在读取历史…</p> : !w.records.length ? <div className="image-history-empty"><ImagePlus size={24} /><p>暂无生成记录</p><small>从一个画面想法开始</small></div> : null}
        {w.records.map((record) => <button className={`image-history-item ${w.id === record.id ? "selected" : ""}`} type="button" key={record.id} aria-pressed={w.id === record.id} onClick={() => w.select(record.id)} disabled={w.busy || w.uploading}>
          {record.thumbnail ? <img src={imageFileUrl(record.thumbnail.id)} alt="" loading="lazy" /> : <span className="image-history-placeholder"><ImagePlus size={20} /></span>}
          <strong>{record.title}</strong><small>{record.imageCount}/{record.count} 张 · {record.size.replace("x", " × ")}</small><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
        </button>)}
        {w.records.length < w.total ? <button className="btn small" type="button" disabled={w.moreLoading} onClick={() => void w.loadMore()}>{w.moreLoading ? "加载中…" : "加载更多"}</button> : null}
      </div>
    </aside>
    <ImageControls workbench={w} />
    <section className="image-results" aria-labelledby="image-results-title">
      <header className="image-pane-heading"><div><h1 id="image-results-title">生成结果</h1><small>{w.record ? `${w.record.model} · ${w.record.images.length} 张已保存` : "把画面想法变成图片"}</small></div><span className="status-pill">{w.form.size.replace("x", " × ")}</span></header>
      {w.error ? <div className="error" role="alert">{w.error}</div> : null}
      {w.job ? <div className="image-job-status" aria-live="polite" aria-busy={w.active}><span>{w.job.error || (w.job.status === "interrupted" ? "服务重启，生成已中断。已保存图片保留，可再次生成。" : w.job.status === "cancelled" ? "生成已停止，已保存图片保留。" : w.job.message)}</span>{w.active ? <progress value={w.job.progress} max={100} aria-label="图片生成进度" /> : null}{w.job.status === "failed" ? <small>已保存图片保留。修正参数后点击“再次生成”重试。</small> : null}</div> : null}
      <div className="image-result-scroll" aria-busy={w.detailLoading}>
        {w.record?.images.length ? <div className={`image-result-grid ${w.record.images.length === 1 ? "single" : ""}`}>{w.record.images.map((image, index) => <article className="image-result-card" key={image.id}>
          <button className="image-result-open" type="button" aria-label={`放大第 ${index + 1} 张图片`} onClick={() => setPreview(image)}><img src={imageFileUrl(image.id)} alt={`生成结果 ${index + 1}：${w.record?.prompt.slice(0, 100)}`} /><span className="image-zoom-label"><ZoomIn size={16} />放大预览</span></button>
          <footer><span>方案 {String(index + 1).padStart(2, "0")}</span><a className="btn small" href={imageFileUrl(image.id, true)} download><Download size={14} />下载</a></footer>
        </article>)}</div> : <div className="image-results-empty"><ImagePlus size={42} strokeWidth={1.3} /><h2>{w.active ? "正在构建你的画面" : w.detailLoading ? "正在读取图片" : "还没有生成图片"}</h2><p>{w.active ? "图片生成需要一些时间，完成后会逐张出现在这里。" : "输入提示词，选好比例，开始生成。"}</p><small>支持参考图引导 · 多方案生成 · 原图下载</small></div>}
      </div>
    </section>
    {preview ? <ImagePreview image={preview} onClose={() => setPreview(null)} /> : null}
  </div>;
}
