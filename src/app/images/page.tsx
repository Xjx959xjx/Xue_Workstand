"use client";
import { Suspense, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Columns2, LayoutGrid, Plus, RefreshCw, Scan } from "lucide-react";
import { type ImageFile, type ImageGenerationSummary } from "@/lib/image-generation-types";
import { useImageWorkbench } from "./_hooks/useImageWorkbench";
import { ImageControls } from "./_components/ImageControls";
import { ImageInspectorPanel } from "./_components/ImageInspectorPanel";
import { ImageGallery } from "./_components/ImageGallery";
import { ImageResults } from "./_components/ImageResults";
const ImagePreview = dynamic(() => import("./_components/ImagePreview").then((module) => module.ImagePreview), { ssr: false });
const ImageCompare = dynamic(() => import("./_components/ImageCompare"), { ssr: false });

export default function ImagesPage() {
  return <Suspense fallback={<div className="empty-state-panel" role="status">正在加载生图工作台…</div>}><ImageWorkbench /></Suspense>;
}
function ImageWorkbench() {
  const w = useImageWorkbench();
  const [jump, setJump] = useState<{ id: string; version: number; submission: string } | null>(null);
  const [view, setView] = useState<"canvas" | "gallery">("canvas");
  const [inspector, setInspector] = useState<"record" | null>(null);
  const [preview, setPreview] = useState<ImageFile | null>(null);
  const [previewDrafts, setPreviewDrafts] = useState<Record<string, string>>({});
  const [compared, setCompared] = useState<ImageFile[]>([]);
  const [comparing, setComparing] = useState(false);
  const [draggedImage, setDraggedImage] = useState<ImageFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  function statusFor(record: ImageGenerationSummary) {
    const task = w.jobs.find((entry) => entry.id === record.id);
    if (task?.status === "running") return `生成中 · 已保存 ${record.imageCount}/${record.count} 张`;
    if (task?.status === "queued") return "排队中";
    if (task?.status === "failed") return `生成失败 · 已保存 ${record.imageCount} 张`;
    if (task?.status === "cancelled") return `已停止 · 已保存 ${record.imageCount} 张`;
    if (task?.status === "interrupted") return `已中断 · 已保存 ${record.imageCount} 张`;
    return record.imageCount === record.count ? `${record.imageCount} 张已保存` : `${record.imageCount}/${record.count} 张 · 未完成`;
  }
  function select(id: string) { if (!w.select(id)) return; setJump({ id, version: Date.now(), submission: w.submissionKey }); setView("canvas"); setInspector(null); }
  function toggleCompare(image: ImageFile) {
    if (compared.some((item) => item.id === image.id)) setCompared((items) => items.filter((item) => item.id !== image.id));
    else if (compared.length < 4) setCompared((items) => [...items, image]);
    else w.fail(new Error("最多同时对比 4 张图片，请先取消一张。"));
  }
  const list = view === "gallery" ? w.records : w.boardRecords;
  const total = view === "gallery" ? w.total : w.boardTotal;
  return <div className="page images-page" data-unsaved-changes={w.dirty ? "true" : undefined}>
    <header className="page-header image-page-header"><div className="page-title-group"><span className="page-title-eyebrow">CREATE / 02</span><div className="page-title-copy"><h1>让想象，有迹可见</h1><p className="subtle">参考、提示词与画布，组成一次完整创作。</p></div></div><div className="page-header-meta"><button className="btn primary" type="button" disabled={w.busy || w.uploading || w.active} onClick={() => { if (w.newRecord()) setView("canvas"); }}><Plus size={16} aria-hidden="true" />新建画布</button></div></header>
    <header className="image-workbench-toolbar"><div className="image-view-switch" role="group" aria-label="工作区视图"><button ref={settingsButton} className="btn" type="button" aria-pressed={view === "canvas"} onClick={() => setView("canvas")}><Scan size={16} />图片创作</button><button className="btn" type="button" aria-pressed={view === "gallery"} onClick={() => setView("gallery")}><LayoutGrid size={16} />作品图库 <small>{w.total}</small></button></div><div className="image-toolbar-actions">{compared.length ? <button className="btn small" type="button" onClick={() => setComparing(true)} disabled={compared.length < 2}><Columns2 size={15} />对比 {compared.length ? `${compared.length}/4` : "方案"}</button> : null}{compared.length ? <button className="btn small" type="button" onClick={() => setCompared([])}>清空选择</button> : null}<button className="btn icon" type="button" aria-label="刷新生成记录" onClick={() => { void w.refresh(); void w.refreshBoard(); }}><RefreshCw size={15} /></button></div></header>
    <section className={`image-workbench ${view === "canvas" ? "is-creation-view" : ""}`}>
      {w.deletion ? <div className="image-deletion-feedback" role="status">{w.deletion.message}{w.deletion.operationId ? <button className="btn small" type="button" disabled={w.deleting} onClick={() => void w.undoDelete()}>撤销删除</button> : null}</div> : null}
      {w.error ? <div className="error image-workbench-error" role="alert">{w.error}</div> : null}
      {(w.batchJobs.length ? w.batchJobs : w.job ? [w.job] : []).filter((task) => task.status !== "completed").map((task) => <div key={task.id} className="image-job-status" aria-live="polite" aria-busy={task.status === "running" || task.status === "queued"}><span>{task.title} · {task.error || task.message}</span>{task.status === "running" || task.status === "queued" ? <progress max={100} value={task.progress} aria-label="图片生成进度" /> : null}</div>)}
      <div className="image-workspace">
        <div className="image-workspace-main">
          {view === "canvas" ? <>
          <div className="image-canvas-toolbar"><span>{w.record ? "当前生成画布" : "未命名画布"}</span><span className="image-canvas-size">{w.form.size}</span><button className="btn small" type="button" onClick={() => setView("gallery")}>图片库</button></div>
          <ImageResults jump={jump?.submission === w.submissionKey ? jump : null} submissionKey={w.submissionKey} previewOpen={Boolean(preview)} jobs={w.jobs} records={w.boardRecords} record={w.record} loading={w.boardLoading} active={w.active} disabled={w.busy || w.uploading} onReproduce={(id) => { void w.reproduce(id); }} onReference={w.addResultReferences} onPreview={setPreview} onDragImage={setDraggedImage}>{list.length < total ? <div className="image-more-records"><button className="btn small" type="button" disabled={w.moreLoading} onClick={() => void w.loadMore(true)}>{w.moreLoading ? "加载中…" : `加载更多 · ${list.length}/${total}`}</button></div> : null}</ImageResults></> : <ImageGallery records={w.records} loading={w.loading} selectedId={w.id} compared={compared} onSelect={select} onCompare={toggleCompare} deleting={w.deleting} onDelete={(id) => { void w.deleteRecords({ action: "delete", id }); }} onClearFailed={() => { void w.deleteRecords({ action: "clear-failed" }); }} statusFor={statusFor} />}
          {view === "gallery" && list.length < total ? <div className="image-more-records"><button className="btn small" type="button" disabled={w.moreLoading} onClick={() => void w.loadMore(false)}>{w.moreLoading ? "加载中…" : `加载更多 · ${list.length}/${total}`}</button></div> : null}
          <div className="image-composer-dock" hidden={view !== "canvas"}><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { void w.upload(Array.from(event.target.files || [])); event.target.value = ""; }} />
            <ImageControls draggedImage={draggedImage} onUpload={() => fileInput.current?.click()} workbench={w} onLocate={(id) => { const image = [...w.availableReferences, ...w.recordReferences].find((item) => item.id === id); if (image) setPreview(image); }} />
          </div>
        </div>
        <ImageInspectorPanel workbench={w} view={view} showRecord={Boolean(inspector)} onShowRecord={() => setInspector("record")} onCloseRecord={() => { setInspector(null); settingsButton.current?.focus(); }} onUpload={() => fileInput.current?.click()} onPreview={setPreview} onFocusPrompt={() => document.getElementById("image-prompt")?.focus()} />
      </div>
    </section>
    {preview ? <ImagePreview drafts={previewDrafts} onDraftChange={(id, text) => setPreviewDrafts((current) => ({ ...current, [id]: text }))} workbench={w} image={preview} images={w.record?.images.length ? w.record.images : w.references} onClose={() => setPreview(null)} /> : null}
    {comparing ? <ImageCompare images={compared} onClose={() => setComparing(false)} /> : null}
  </div>;
}
