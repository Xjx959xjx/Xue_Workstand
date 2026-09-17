"use client";
/* eslint-disable @next/next/no-img-element -- Canvas displays local user assets. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Panel, ReactFlow, useNodesState, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { z } from "zod";
import { GripVertical, ImagePlus, X, Plus, Minus, LayoutGrid, Scan, Download, Pencil, Info } from "lucide-react";
import { imageFileUrl, type ImageFile, type ImageGenerationRecord, type ImageGenerationSummary } from "@/lib/image-generation-types";

type CardData = { onReference: (image: ImageFile) => void; referenceIds: string[]; disabled: boolean; onRemove: () => void; title: string; subtitle: string; images: ImageFile[]; reference: boolean; selected: boolean; onSelect: () => void; onPreview: (image: ImageFile) => void };
type CardNode = Node<CardData, "imageCard">;
function ImageCard({ data }: NodeProps<CardNode>) {
  return <article className={`image-canvas-card ${data.selected ? "is-selected" : ""}`}>
    <button className="btn icon small nodrag image-node-remove" type="button" disabled={data.disabled} aria-label={`移出画布 ${data.title}`} title="移出画布（保留原图与历史）" onClick={data.onRemove}><X size={14} /></button>
    <header className="image-node-heading"><span><GripVertical size={14} aria-hidden="true" />{data.title}</span><small>{data.subtitle}</small></header>
    {data.images.length ? <div className={`image-node-pictures ${data.images.length > 1 ? "multiple" : ""}`}>{data.images.map((image) => <div className="image-node-media nodrag" key={image.id}>
      <button type="button" className="image-node-picture" aria-label={`放大并编辑 ${image.name}`} onClick={() => data.onPreview(image)}><img src={imageFileUrl(image.id)} alt={image.name} loading="lazy" /></button>
      <div className="image-node-hover-actions"><button className="btn" type="button" onClick={() => data.onPreview(image)}><Pencil size={16} />编辑图片</button>{!data.reference ? <button className="btn" type="button" onClick={data.onSelect}><Info size={16} />生成详情</button> : null}<a className="btn" href={imageFileUrl(image.id, true)} download><Download size={16} />下载</a></div>
    </div>)}</div> : <div className="image-node-empty"><ImagePlus size={28} /><span>{data.subtitle}</span></div>}
  </article>;
}
const nodeTypes = { imageCard: ImageCard };
const positionSchema = z.object({ schemaVersion: z.literal(1), positions: z.record(z.object({ x: z.number().finite(), y: z.number().finite() })), hiddenIds: z.array(z.string()).default([]), viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(0.25).max(2) }).optional() });
export default function ImageCanvas({ loading, arrangeVersion, canvasId, records, record, references, recordReferences, selectedId, focusReference, focusVersion, onSelect, onPreview, onError, statusFor, disabled, onUpload, onRemoveReference, onAddReference }: {
  loading: boolean; arrangeVersion: number;
  onAddReference: (image: ImageFile) => boolean;
  disabled: boolean; onUpload: (files: File[]) => Promise<ImageFile[] | undefined>; onRemoveReference: (id: string) => boolean;
  canvasId: string; records: ImageGenerationSummary[]; record: ImageGenerationRecord | null; references: ImageFile[]; recordReferences: ImageFile[]; selectedId: string; focusReference: string; focusVersion: number;
  onSelect: (id: string) => void; onPreview: (image: ImageFile) => void; onError: (error: unknown) => void; statusFor: (record: ImageGenerationSummary) => string;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  const [flow, setFlow] = useState<ReactFlowInstance<CardNode> | null>(null);
  const focused = useRef(-1);
  const container = useRef<HTMLDivElement>(null);
  const pendingFit = useRef(false);
  const fitFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(fitFrame.current), []);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [knownReferences, setKnownReferences] = useState<ImageFile[]>([]);
  useEffect(() => { setKnownReferences((current) => [...new Map([...current, ...references, ...recordReferences].map((image) => [image.id, image])).values()]); }, [references, recordReferences]);
  const visibleReferences = useMemo(() => [...new Map([...knownReferences, ...references, ...recordReferences].map((image) => [image.id, image])).values()], [knownReferences, references, recordReferences]);
  const latest = useRef({ onSelect, onPreview, onError, statusFor, onAddReference }); latest.current = { onSelect, onPreview, onError, statusFor, onAddReference };
  const viewport = useRef<{ x: number; y: number; zoom: number } | undefined>(undefined);
  const initialized = useRef(false);
  const [zoom, setZoom] = useState(1);
  const arranged = useRef<Record<string, { x: number; y: number }>>({});
  const saved = useRef<Record<string, { x: number; y: number }>>({});
  const storageKey = `image-canvas-layout/v1/${canvasId || "new"}`;
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey); const value = raw ? positionSchema.parse(JSON.parse(raw)) : { positions: {}, hiddenIds: [] }; saved.current = value.positions; viewport.current = "viewport" in value ? value.viewport : undefined; setHiddenIds(value.hiddenIds); }
    catch { saved.current = {}; latest.current.onError(new Error("画布位置记录无法读取，已使用自动排列；原图与生成记录不受影响。")); }
  }, [storageKey]);
  const persist = useCallback((hidden = hiddenIds) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, positions: saved.current, hiddenIds: hidden, viewport: viewport.current })); }
    catch { latest.current.onError(new Error("画布布局保存失败，请检查浏览器存储空间；原图与生成记录不受影响。")); }
  }, [hiddenIds, storageKey]);
  useEffect(() => {
    if (loading) return;
    const ordered = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const next: CardNode[] = visibleReferences.map((image, index) => ({ id: `ref-${image.id}`, type: "imageCard", position: { x: 0, y: index * 390 }, data: { onReference: (image) => { latest.current.onAddReference(image); }, referenceIds: references.map((image) => image.id), disabled, onRemove: () => {}, title: `@${image.name}`, subtitle: references.some((item) => item.id === image.id) ? "本次参考图" : "历史参考图", images: [image], reference: true, selected: focusReference === image.id, onSelect: () => latest.current.onPreview(image), onPreview: (image) => latest.current.onPreview(image) } }));
    ordered.forEach((item, index) => next.push({ id: item.id, type: "imageCard", position: { x: (visibleReferences.length ? 400 : 0) + index % 2 * 400, y: Math.floor(index / 2) * 390 }, data: { onReference: (image) => { latest.current.onAddReference(image); }, referenceIds: references.map((image) => image.id), disabled, onRemove: () => {}, title: item.title, subtitle: latest.current.statusFor(item), images: record?.id === item.id ? record.images : item.thumbnail ? [item.thumbnail] : [], reference: false, selected: selectedId === item.id, onSelect: () => latest.current.onSelect(item.id), onPreview: (image) => latest.current.onPreview(image) } }));
    const visible = next.filter((node) => !hiddenIds.includes(node.id));
    arranged.current = Object.fromEntries(visible.map((node, index) => [node.id, { x: index % 3 * 350, y: Math.floor(index / 3) * 390 }]));
    // Preserve existing slots across asynchronous refreshes; only place new cards.
    let changed = false;
    for (const node of visible) {
      if (saved.current[node.id]) continue;
      let slot = 0;
      while (Object.values(saved.current).some((position) => Math.abs(position.x - slot % 3 * 350) < 320 && Math.abs(position.y - Math.floor(slot / 3) * 390) < 370)) slot++;
      saved.current[node.id] = { x: slot % 3 * 350, y: Math.floor(slot / 3) * 390 };
      changed = true;
    }
    if (changed) persist();
    setNodes((current) => visible.map((node) => ({ ...node, deletable: !disabled, dragHandle: ".image-node-heading", data: { ...node.data, onRemove: () => { void flow?.deleteElements({ nodes: [{ id: node.id }] }); } }, position: saved.current[node.id] || current.find((entry) => entry.id === node.id)?.position || node.position })));
  }, [loading, records, record, references, visibleReferences, selectedId, focusReference, setNodes, disabled, hiddenIds, flow, persist]);
  const arrangeNodes = useCallback(() => {
    saved.current = { ...saved.current, ...arranged.current };
    setNodes((current) => current.map((node) => ({ ...node, position: arranged.current[node.id] || node.position })));
    persist();
    pendingFit.current = true;
    cancelAnimationFrame(fitFrame.current);
    let previous = "";
    let stableFrames = 0;
    let frames = 0;
    // Loading closes the inspector and can change both card sizes and canvas size.
    // Fit only after those measurements settle, using the same path as the button.
    const fitWhenReady = () => {
      const bounds = container.current?.getBoundingClientRect();
      const current = flow?.getNodes() || [];
      const signature = JSON.stringify([bounds?.width, bounds?.height, current.map((node) => [node.id, node.position, node.measured])]);
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
      const measured = current.length > 0 && current.some((node) => node.measured?.width && node.measured?.height);
      if (measured && stableFrames >= 3) {
        void flow?.fitView({ padding: 0.08, minZoom: 0.85, maxZoom: 1 });
        pendingFit.current = false;
      } else if (++frames < 120) {
        fitFrame.current = requestAnimationFrame(fitWhenReady);
      } else {
        pendingFit.current = false;
        latest.current.onError(new Error("画布尚未完成布局，请点击自动排列重试。"));
      }
    };
    fitFrame.current = requestAnimationFrame(fitWhenReady);
  }, [flow, persist, setNodes]);
  useEffect(() => {
    if (!flow || loading || !nodes.length || initialized.current) return;
    initialized.current = true;
    if (viewport.current) { void flow.setViewport(viewport.current); setZoom(viewport.current.zoom); }
    else arrangeNodes();
  }, [flow, loading, nodes.length, arrangeNodes]);
  // A record load can remount the canvas; its arrange request must still run.
  const appliedArrange = useRef(0);
  useEffect(() => {
    if (!flow || loading || !nodes.length || appliedArrange.current === arrangeVersion) return;
    appliedArrange.current = arrangeVersion;
    arrangeNodes();
  }, [arrangeVersion, flow, loading, nodes.length, arrangeNodes]);
  useEffect(() => {
    if (pendingFit.current || !focusReference || focused.current === focusVersion) return;
    const nodeId = `ref-${focusReference}`;
    if (hiddenIds.includes(nodeId)) { const next = hiddenIds.filter((id) => id !== nodeId); setHiddenIds(next); persist(next); return; }
    const node = nodes.find((entry) => entry.id === nodeId);
    if (!flow || !node) return;
    focused.current = focusVersion;
    void flow.setCenter(node.position.x + 150, node.position.y + 140, { zoom: 1, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180 });
  }, [flow, nodes, focusReference, focusVersion, hiddenIds, persist]);
  return <div ref={container} className={`image-flow ${dragging ? "is-dragging-file" : ""}`} aria-label="图片创作画布，可拖入图片、拖动卡片、缩放和平移" onDragOver={(event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; setDragging(!disabled);
  }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDragging(false); }} onDrop={async (event) => {
    event.preventDefault(); setDragging(false);
    if (disabled) return;
    await onUpload(Array.from(event.dataTransfer.files));
  }}>
    <ReactFlow proOptions={{ hideAttribution: true }} onMoveEnd={(_event, next) => { if (initialized.current) { viewport.current = next; setZoom(next.zoom); persist(); } }} nodes={nodes} edges={[]} nodeTypes={nodeTypes} onInit={setFlow} onNodesChange={onNodesChange} panOnScroll zoomOnScroll={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={["Backspace", "Delete"]} onBeforeDelete={async ({ nodes: requested }) => ({ nodes: disabled ? [] : requested.filter((node) => node.data.images.every((image) => !references.some((ref) => ref.id === image.id) || onRemoveReference(image.id))), edges: [] })} onNodesDelete={(removed) => {
      const next = [...new Set([...hiddenIds, ...removed.map((node) => node.id)])]; setHiddenIds(next); persist(next);
    }} minZoom={0.25} maxZoom={2} defaultViewport={{ x: 28, y: 32, zoom: 1 }} onlyRenderVisibleElements onNodeDragStop={(_event, moved) => {
      saved.current[moved.id] = moved.position;
      persist();
    }} ariaLabelConfig={{ "controls.zoomIn.ariaLabel": "放大画布", "controls.zoomOut.ariaLabel": "缩小画布", "controls.fitView.ariaLabel": "适应全部图片", "controls.interactive.ariaLabel": "切换画布交互", "minimap.ariaLabel": "画布缩略图" }}>
      <Panel position="bottom-right"><div className="image-canvas-tools" role="group" aria-label="画布视图工具"><button className="btn icon small" type="button" aria-label="缩小画布" onClick={() => void flow?.zoomOut()}><Minus size={16} /></button><button className="btn small" type="button" aria-label="恢复到100%" title="恢复到100%" onClick={() => void flow?.zoomTo(1)}>{Math.round(zoom * 100)}%</button><button className="btn icon small" type="button" aria-label="放大画布" onClick={() => void flow?.zoomIn()}><Plus size={16} /></button><span className="image-tool-divider" /><button className="btn icon small" type="button" aria-label="适应全部图片" title="适应全部图片" onClick={() => void flow?.fitView({ padding: 0.08, maxZoom: 1 })}><Scan size={16} /></button><button className="btn small" type="button" disabled={!nodes.length} onClick={arrangeNodes}><LayoutGrid size={15} />自动排列</button>{hiddenIds.length ? <button className="btn small" type="button" onClick={() => { setHiddenIds([]); persist([]); }}>恢复卡片 ({hiddenIds.length})</button> : null}</div></Panel>
      {dragging ? <Panel position="top-center"><div className="image-canvas-drop-hint">松开图片，加入本次参考图</div></Panel> : null}
      <Background gap={24} size={0.7} />

      {!nodes.length ? <Panel position="top-center"><div className="image-canvas-empty"><ImagePlus size={32} /><h2>从一张图开始</h2><p>添加参考图，在下方输入提示词。每轮结果会留在这张画布上。</p></div></Panel> : null}
    </ReactFlow>
  </div>;
}
