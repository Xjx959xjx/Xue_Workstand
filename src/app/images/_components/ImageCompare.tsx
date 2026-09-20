"use client";
/* eslint-disable @next/next/no-img-element -- Compare original local images. */
import { useLayoutEffect, useRef } from "react";
import { useDialogInteraction } from "@/components/useDialogInteraction";
import { X, Download } from "lucide-react";
import { imageFileUrl, type ImageFile } from "@/lib/image-generation-types";
export default function ImageCompare({ images, onClose }: { images: ImageFile[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  const closeDialog = useDialogInteraction(ref, { onClose, returnFocusRef });
  return <dialog ref={ref} tabIndex={-1} className="modal-panel image-compare" aria-modal="true" aria-labelledby="image-compare-title" onCancel={(event) => { event.preventDefault(); closeDialog(); }}><header className="image-pane-heading"><h2 id="image-compare-title">方案对比 · {images.length} 张</h2><button type="button" className="btn icon" aria-label="关闭对比" onClick={onClose}><X size={18} /></button></header><div className="image-compare-grid">{images.map((image, index) => <figure key={image.id}><img src={imageFileUrl(image.id)} alt={`对比方案 ${index + 1}：${image.name}`} /><figcaption><span>方案 {index + 1}</span><a className="btn small" download href={imageFileUrl(image.id, true)}><Download size={14} />下载</a></figcaption></figure>)}</div></dialog>;
}
