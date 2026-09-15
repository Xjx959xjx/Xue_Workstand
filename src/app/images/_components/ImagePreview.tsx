"use client";
/* eslint-disable @next/next/no-img-element -- User-generated local assets have variable dimensions. */
import { useEffect, useRef } from "react";
import { Download, X } from "lucide-react";
import { imageFileUrl, type ImageFile } from "@/lib/image-generation-types";

export function ImagePreview({ image, onClose }: { image: ImageFile; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="modal-panel image-preview" aria-labelledby="image-preview-title" aria-modal="true" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="image-pane-heading"><h2 id="image-preview-title">图片预览</h2><button className="btn icon" type="button" aria-label="关闭图片预览" onClick={onClose}><X size={18} /></button></header>
    <img src={imageFileUrl(image.id)} alt={image.name} />
    <a className="btn" href={imageFileUrl(image.id, true)} download><Download size={16} />下载原图</a>
  </dialog>;
}
