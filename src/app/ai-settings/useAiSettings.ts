"use client";
import { useCallback, useEffect, useState } from "react";
import { getAiModelSettings, saveAiModelSettings } from "@/lib/client";
import { AI_POLICIES, type AiPolicyId, type AiPolicyOverrides, type AiPolicyValue, type AiSettingsView } from "@/lib/ai-policy-catalog";

export function useAiSettings() {
  const [saved, setSaved] = useState<AiSettingsView | null>(null);
  const [overrides, setOverrides] = useState<AiPolicyOverrides>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirtyIds = AI_POLICIES.filter((p) => JSON.stringify(overrides[p.id]) !== JSON.stringify(saved?.overrides[p.id])).map((p) => p.id);
  const dirty = dirtyIds.length > 0;
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await getAiModelSettings(); setSaved(data); setOverrides(data.overrides); setMessage(""); }
    catch (e) { setError(e instanceof Error ? e.message : "读取配置失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.("a[href]");
      if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!window.confirm("AI 配置尚未保存，离开会丢失修改。确定离开吗？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  function change(ids: AiPolicyId[], patch: Partial<AiPolicyValue> | null) {
    if (!saved) return;
    setMessage("");
    setOverrides((current) => {
      const next = { ...current };
      for (const id of ids) {
        if (!patch) { delete next[id]; continue; }
        const value = { ...(next[id] || saved.defaults[id]), ...patch };
        if (JSON.stringify(value) === JSON.stringify(saved.defaults[id])) delete next[id];
        else next[id] = value;
      }
      return next;
    });
  }
  async function save() {
    if (!saved || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const data = await saveAiModelSettings({ schemaVersion: 1, revision: saved.revision, updatedAt: saved.updatedAt, overrides });
      setSaved(data); setOverrides(data.overrides); setMessage("配置已保存，新的 AI 请求将使用最新设置。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存配置失败"); }
    finally { setSaving(false); }
  }
  return { saved, overrides, loading, saving, error, message, dirty, dirtyIds, load, change, save,
    discard: () => { if (saved) setOverrides(saved.overrides); setMessage(""); } };
}
