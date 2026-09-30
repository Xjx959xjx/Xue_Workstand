"use client";

import { Save } from "lucide-react";
import { AI_EFFORTS, AI_GROUPS, AI_POLICIES, type AiEffort } from "@/lib/ai-policy-catalog";
import { useAiSettings } from "./useAiSettings";
import "./settings.css";

const chatModels = ["gpt-6-astra", "gpt-6.1-sol"];
const effortOptions = AI_EFFORTS.filter((effort) => effort !== "none");
const effortLabels = { low: "轻量", medium: "均衡", high: "深入", xhigh: "最高" };
type SettingsController = ReturnType<typeof useAiSettings>;
type Policy = typeof AI_POLICIES[number];

function PolicyRow({ policy, w }: { policy: Policy; w: SettingsController }) {
  const saved = w.saved!;
  const value = w.overrides[policy.id] || saved.defaults[policy.id];
  const isImage = "kind" in policy;
  const models = isImage ? saved.models.filter((model) => model.startsWith("gpt-image")) : chatModels;
  const model = value.model || saved.inheritedModels[policy.id];
  const effort = value.effort === "default" ? saved.inheritedEfforts[policy.id] : value.effort;

  return <fieldset className="ai-setting-row" disabled={w.saving}>
    <legend className="sr-only">{policy.title}</legend>
    <div className="ai-setting-name">
      <h3>{policy.title}{w.dirtyIds.includes(policy.id) ? <small>待保存</small> : null}</h3>
      <p>{policy.description}</p>
    </div>
    <div className="ai-model-field">
      <label className="ai-field">
        <span className="ai-column-label">模型</span>
        <select aria-label={`${policy.title}模型`} value={model} onChange={(event) => w.change([policy.id], { model: event.target.value })}>
          {models.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      </label>
    </div>
    <label className="ai-field">
      <span className="ai-column-label">推理强度</span>
      <select aria-label={`${policy.title}推理强度`} disabled={isImage} value={isImage ? "none" : effort} onChange={(event) => w.change([policy.id], { effort: event.target.value as AiEffort })}>
        {isImage ? <option value="none">图片模型不适用</option> : effortOptions.map((effort) => <option value={effort} key={effort}>{effortLabels[effort]}</option>)}
      </select>
    </label>
    <button type="button" className="btn compact ai-reset" aria-label={`恢复${policy.title}默认`} disabled={!w.overrides[policy.id]} onClick={() => w.change([policy.id], null)}>恢复默认</button>
  </fieldset>;
}

export default function AiSettingsPage() {
  const w = useAiSettings();

  return <div className="ai-settings-page" data-unsaved-changes={w.dirty ? "true" : undefined}>
    <header className="page-header ai-settings-header">
      <div><h1>AI 模型配置</h1><p>直接选择各环节的模型和推理强度，保存后生效。</p></div>
      <div className="ai-header-actions">
        <span className="ai-save-state" role="status">{w.loading ? "读取中…" : w.error ? "需要处理" : w.dirty ? `${w.dirtyIds.length} 项待保存` : "已保存"}</span>
        <button className="btn" disabled={!w.dirty || w.saving} onClick={w.discard}>撤销修改</button>
        <button className="btn primary" disabled={!w.dirty || w.saving || w.loading} aria-busy={w.saving} onClick={() => void w.save()}><Save size={15}/>{w.saving ? "保存中…" : "保存更改"}</button>
      </div>
    </header>
    {w.error ? <div className="ai-message error" role="alert"><span>{w.error}</span><button className="btn compact" disabled={w.saving} onClick={() => { if (!w.dirty || window.confirm("重新载入将丢弃当前未保存修改，确定继续吗？")) void w.load(); }}>重新载入</button></div> : null}
    {w.message ? <div className="ai-message success" role="status">{w.message}</div> : null}
    {w.loading ? <div className="panel ai-loading" role="status">正在读取模型配置…</div> : w.saved ? <div className="panel ai-settings-list" aria-busy={w.saving}>
      {AI_GROUPS.slice(1).map((group) => <section className="ai-settings-group" key={group} aria-label={group}>
        <div className="ai-group-heading"><h2>{group}</h2><span>模型</span><span>推理强度</span><span className="sr-only">操作</span></div>
        {AI_POLICIES.filter((policy) => policy.group === group).map((policy) => <PolicyRow key={policy.id} policy={policy} w={w}/>)}
      </section>)}
      <p className="ai-service-note">语音转写：{w.saved.services.asr}，无需设置推理强度。转写稿模型清洗{w.saved.services.transcriptCleaning ? "已开启" : "默认关闭"}。</p>
    </div> : null}
  </div>;
}
