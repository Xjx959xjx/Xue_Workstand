"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ImageControlPopover } from "./ImageControlPopover";
import { Sparkles, ScanLine } from "lucide-react";
import { useTasks } from "@/components/TaskProvider";
import { getJob } from "@/lib/client";
import { imagePromptAssistResultSchema } from "@/lib/image-prompt-assist-types";
import { imageMentionPattern, imagePromptLabel } from "@/lib/image-mentions";

export function ImagePromptAssist({ prompt, referenceIds, disabled, onApply }: { prompt: string; referenceIds: string[]; disabled: boolean; onApply: (text: string) => void }) {
  const search = useSearchParams();
  const { jobs, startTask, cancelTask } = useTasks();
  const [id, setId] = useState(search.get("assistId") || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ text: string; fallback: boolean; fallbackReason?: string } | null>(null);
  const original = useRef("");
  const lock = useRef(false);
  const job = jobs.find((item) => item.id === id);
  const active = pending || job?.status === "queued" || job?.status === "running";
  const status = job?.status;
  useEffect(() => {
    if (!id || (status && status !== "completed")) return;
    let cancelled = false;
    void getJob(id).then(({ job: full }) => {
      if (cancelled || full.status !== "completed") return;
      if (full.kind !== "image-prompt-assist") throw new Error("这不是提示词建议任务。");
      setResult(imagePromptAssistResultSchema.parse(full.result));
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "读取建议失败，请重试。"); });
    return () => { cancelled = true; };
  }, [id, status]);
  async function start(mode: "polish" | "suggest") {
    if (lock.current || active) return;
    lock.current = true; setPending(true); setError(""); setResult(null); original.current = prompt;
    try { setId((await startTask({ kind: "image-prompt-assist", input: { prompt, mode } })).id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "提交失败，请重试。"); }
    finally { lock.current = false; setPending(false); }
  }
  return <div className="image-prompt-assist" aria-busy={active}>
    <div className="image-assist-actions" title="使用 GPT-5.5，推理强度 low（轻量），与生图输出质量无关。"><ImageControlPopover label="AI 助手" trigger={<><Sparkles size={16} />AI 助手</>} width={result ? "composer" : 330} autoOpen={Boolean(result)} disabled={disabled || active}>{(close) => result ? <div className="image-assist-preview"><p>{imagePromptLabel(result.text)}</p>{result.fallback ? <small>{result.fallbackReason || "本次使用备用模型生成。"}</small> : null}{original.current && original.current !== prompt ? <small>原文已有修改，采用会替换当前提示词。</small> : null}<div className="image-assist-actions"><button className="btn small" type="button" disabled={disabled} onClick={() => {
      if (Array.from(result.text.matchAll(imageMentionPattern())).some((match) => !referenceIds.includes(match[2]))) { setError("建议中的参考图已移除，请重新润色。"); return; }
      onApply(result.text); setResult(null); close();
    }}>采用</button><button className="btn small" type="button" onClick={() => { setResult(null); close(); }}>保留原文</button></div></div> : <div className="image-control-menu"><p className="image-control-caption">优化创作指令</p><button type="button" disabled={!prompt.trim()} onClick={() => { close(); void start("polish"); }}><Sparkles size={21} /><span><strong>AI 润色</strong><small>保留原意，补充画面细节与表达</small></span></button><button type="button" disabled={!prompt.trim()} onClick={() => { close(); void start("suggest"); }}><ScanLine size={21} /><span><strong>构图建议</strong><small>提供主体位置、视角与画面层次建议</small></span></button>{!prompt.trim() ? <small>先写下你的画面想法</small> : null}</div>}</ImageControlPopover>{active ? <><span role="status">正在思考…</span><button className="btn small" type="button" disabled={pending} onClick={() => void cancelTask(id).catch((reason) => setError(reason instanceof Error ? reason.message : "取消失败"))}>取消</button></> : null}</div>
    {error || job?.status === "failed" || job?.status === "interrupted" ? <p className="error" role="alert">{error || job?.error || "任务已中断，请重新尝试。"}</p> : null}

  </div>;
}
