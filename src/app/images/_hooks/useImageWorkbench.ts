"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTasks } from "@/components/TaskProvider";
import { confirmDiscardUnsavedChanges, useUnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { getImageGenerationConfig, getImageGenerationRecord, getImageRecords, invalidateImageRecordsCache, uploadImageReferences } from "@/lib/client";
import type { ImageFile, ImageGenerationConfig, ImageGenerationInput, ImageGenerationRecord, ImageGenerationSummary } from "@/lib/image-generation-types";

const initialForm: ImageGenerationInput = { prompt: "", size: "1024x1024", quality: "auto", count: 1, referenceIds: [] };
export function useImageWorkbench() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get("recordId") || "";
  const { jobs, startTask, cancelTask } = useTasks();
  const [config, setConfig] = useState<ImageGenerationConfig | null>(null);
  const [form, setForm] = useState<ImageGenerationInput>(initialForm);
  const [baseline, setBaseline] = useState(JSON.stringify(initialForm));
  const [references, setReferences] = useState<ImageFile[]>([]);
  const [records, setRecords] = useState<ImageGenerationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [record, setRecord] = useState<ImageGenerationRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const uploadLock = useRef(false);
  const submitLock = useRef(false);
  const hydrated = useRef("");
  const listRevision = useRef(0);
  const job = jobs.find((entry) => entry.id === id);
  const active = job?.status === "running" || job?.status === "queued";
  const taskVersion = jobs.filter((entry) => entry.kind === "image-generation").map((entry) => `${entry.id}:${entry.dataRevision || 0}:${entry.status}`).join("|");
  const dirty = JSON.stringify(form) !== baseline;
  useUnsavedChangesGuard(dirty || uploading);
  const fail = useCallback((error: unknown) => setError(error instanceof Error ? error.message : "操作失败，请重试。"), []);

  useEffect(() => {
    let alive = true;
    getImageGenerationConfig().then((value) => { if (alive) setConfig(value); }).catch((error) => { if (alive) fail(error); });
    return () => { alive = false; };
  }, [fail]);

  const refresh = useCallback(async () => {
    const revision = ++listRevision.current;
    invalidateImageRecordsCache();
    try {
      const data = await getImageRecords();
      if (revision !== listRevision.current) return;
      setRecords(data.records); setTotal(data.total);
    } catch (error) { if (revision === listRevision.current) fail(error); }
    finally { if (revision === listRevision.current) setLoading(false); }
  }, [fail]);
  useEffect(() => { void refresh(); }, [taskVersion, refresh]);

  useEffect(() => {
    let alive = true;
    if (!id) { setRecord(null); setDetailLoading(false); return; }
    // A queued job has no record until its first persisted data revision.
    if (active && !job?.dataRevision) { setRecord(null); setDetailLoading(false); return; }
    setDetailLoading(true);
    getImageGenerationRecord(id).then(({ record: next, references: refs }) => {
      if (!alive) return;
      setRecord(next);
      if (hydrated.current !== id) {
        const nextForm = { prompt: next.prompt, size: next.size, quality: next.quality, count: next.count, referenceIds: next.referenceIds };
        setForm(nextForm); setBaseline(JSON.stringify(nextForm)); setReferences(refs); hydrated.current = id;
      }
    }).catch((error) => { if (alive) fail(error); }).finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [id, job?.dataRevision, active, fail]);

  function select(nextId: string) {
    if (uploadLock.current || submitLock.current || nextId === id || !confirmDiscardUnsavedChanges()) return;
    setError(""); setRecord(null);
    router.replace(nextId ? `/images?recordId=${encodeURIComponent(nextId)}` : "/images", { scroll: false });
    if (!nextId) { setForm(initialForm); setBaseline(JSON.stringify(initialForm)); setReferences([]); hydrated.current = ""; }
  }
  function newRecord() {
    if (!id) {
      if (uploadLock.current || submitLock.current || !confirmDiscardUnsavedChanges()) return;
      setForm(initialForm); setBaseline(JSON.stringify(initialForm)); setReferences([]); setError("");
    } else select("");
  }
  async function generate() {
    if (submitLock.current || uploadLock.current) return;
    submitLock.current = true; setBusy(true); setError("");
    try {
      const next = await startTask({ kind: "image-generation", input: form });
      hydrated.current = next.id;
      setBaseline(JSON.stringify(form)); setRecord(null);
      router.replace(`/images?recordId=${encodeURIComponent(next.id)}`, { scroll: false });
      await refresh();
    } catch (error) { fail(error); }
    finally { submitLock.current = false; setBusy(false); }
  }
  async function upload(files: File[]) {
    if (!files.length || uploadLock.current || submitLock.current) return;
    if (references.length + files.length > 6) { setError("最多使用 6 张参考图，请先移除多余图片。"); return; }
    if (files.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024)) { setError("参考图仅支持 PNG、JPEG、WebP，每张不能超过 10MB。"); return; }
    uploadLock.current = true; setUploading(true); setError("");
    try {
      const data = await uploadImageReferences(files);
      setReferences((current) => [...current, ...data.references]);
      setForm((current) => ({ ...current, referenceIds: [...current.referenceIds, ...data.references.map((ref) => ref.id)] }));
    } catch (error) { fail(error); }
    finally { uploadLock.current = false; setUploading(false); }
  }
  function removeReference(id: string) {
    setReferences((current) => current.filter((ref) => ref.id !== id));
    setForm((current) => ({ ...current, referenceIds: current.referenceIds.filter((ref) => ref !== id) }));
  }
  async function cancel() {
    setBusy(true); setError("");
    try { await cancelTask(id); } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function loadMore() {
    setMoreLoading(true);
    const revision = listRevision.current;
    try {
      const data = await getImageRecords(records.length);
      if (revision !== listRevision.current) return;
      setRecords((current) => [...current, ...data.records.filter((item) => !current.some((existing) => existing.id === item.id))]); setTotal(data.total);
    } catch (error) { fail(error); } finally { setMoreLoading(false); }
  }
  return { id, config, form, setForm, references, records, total, record: record?.id === id ? record : null, job, jobs, error, busy, uploading, loading, detailLoading, moreLoading, dirty, active, select, newRecord, generate, upload, removeReference, cancel, refresh, loadMore };
}
