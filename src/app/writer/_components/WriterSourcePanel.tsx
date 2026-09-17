"use client";

import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, FileText, Link2, Paperclip, Plus, Trash2, Upload, X } from "lucide-react";
import { WRITER_SOURCE_FILE_ACCEPT } from "@/lib/source-file-import";
import { splitWriterSourceItems } from "../_lib/source-items";

type Props = {
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  importing: boolean;
  onFiles: (files: File[]) => Promise<void>;
};

export function WriterSourcePanel({ value, onChange, importing, onFiles }: Props) {
  const items = useMemo(() => splitWriterSourceItems(value), [value]);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");

  const openComposer = () => {
    setComposing(true);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  return (
    <section className={`writer-materials ${dragging ? "drag-active" : ""}`} aria-labelledby="writer-materials-title" aria-busy={importing} data-unsaved-changes={text.trim() ? "true" : undefined} data-writer-pending-source={text.trim() ? "true" : undefined}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = importing ? "none" : "copy";
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!importing) void onFiles(Array.from(event.dataTransfer.files));
      }}>
      <div className="writer-section-heading">
        <h3 id="writer-materials-title">参考素材 <span>{items.length ? `${items.length} 项` : "可选"}</span></h3>
        <Paperclip aria-hidden="true" size={16} />
      </div>
      <div className="writer-material-actions">
        <button className="btn compact" disabled={importing} onClick={() => inputRef.current?.click()} type="button"><Upload size={15} aria-hidden="true" />{importing ? "正在读取文件…" : "添加文件"}</button>
        <button className="btn compact ghost" onClick={openComposer} type="button"><Plus size={15} aria-hidden="true" />文本 / 链接</button>
        <input className="writer-source-file-input" type="file" ref={inputRef} accept={WRITER_SOURCE_FILE_ACCEPT} multiple aria-label="选择素材文件" disabled={importing} onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = "";
          void onFiles(files);
        }} />
      </div>
      {!items.length && !composing ? (
        <button className="writer-material-drop" type="button" disabled={importing} onClick={() => inputRef.current?.click()}>
          <Upload size={22} aria-hidden="true" /><strong>拖入文件，或点击上传</strong><span>Word、TXT、Markdown、字幕等</span>
        </button>
      ) : null}
      <div className="writer-material-list">
        {items.map((item) => (
          <div className="writer-material-item" key={`${item.kind}-${item.start}`}>
            <details>
              <summary>
                <span className="writer-material-icon" aria-hidden="true">{item.kind === "link" ? <Link2 size={17} /> : <FileText size={17} />}</span>
                <span className="writer-material-copy"><strong>{item.title}</strong><small>{item.kind === "file" ? item.truncated ? "已读取 · 内容已截取" : "已读取" : item.kind === "link" ? "生成时解析" : "已添加"} · {item.content.length.toLocaleString()} 字</small></span>
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              {item.kind === "file" ? <pre className="writer-material-preview">{item.content}</pre> : (
                <label className="writer-material-edit"><span>编辑文本 / 链接</span><textarea className="writer-textarea" aria-label={`编辑${item.title}`} value={item.raw} onChange={(event) => {
                  const replacement = event.target.value;
                  onChange((current) => current.slice(0, item.start) + replacement + current.slice(item.end));
                }} /></label>
              )}
            </details>
            <button className="btn ghost icon-only small writer-material-remove" aria-label={`移除素材：${item.title}`} title="从本次写作移除" type="button" onClick={() => {
              if (window.confirm(`从本次写作移除“${item.title}”？原始文件和已保存稿件不受影响。`)) {
                onChange((current) => current.slice(0, item.start) + current.slice(item.end));
              }
            }}><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      {composing ? (
        <div className="writer-material-composer">
          <label htmlFor="writer-new-material">粘贴原文、视频或文档链接</label>
          <textarea className="writer-textarea" ref={textRef} id="writer-new-material" value={text} onChange={(event) => setText(event.target.value)} placeholder="支持抖音 / B站视频、飞书 / 企业微信文档或公开网页。" />
          <div className="writer-material-actions">
            <button className="btn compact primary" type="button" disabled={!text.trim()} onClick={() => {
              onChange((current) => [current, text].filter(Boolean).join("\n\n"));
              setText("");
              setComposing(false);
            }}>添加素材</button>
            <button className="btn compact ghost" type="button" onClick={() => setComposing(false)}><X size={14} aria-hidden="true" />收起</button>
          </div>
        </div>
      ) : null}
      <p className="writer-material-hint" role="status">{dragging ? importing ? "正在读取，请稍候再添加" : "松开即可添加文件" : importing ? "正在提取正文，读取成功后会出现在素材列表中。" : "文件、文本和链接可混合添加；拖入此区域继续补充。"}</p>
    </section>
  );
}
