"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { AI_EFFORTS, AI_GROUPS, AI_POLICIES, type AiEffort } from "@/lib/ai-policy-catalog";
import { useAiSettings } from "./useAiSettings";
import "./settings.css";

const effortLabels = { default: "服务默认", none: "不指定", low: "轻量", medium: "均衡", high: "深入", xhigh: "最高" };
type SettingsController = ReturnType<typeof useAiSettings>;
type Policy = typeof AI_POLICIES[number];

function PolicyRow({ policy, w }: { policy: Policy; w: SettingsController }) {
  const saved = w.saved!;
  const value = w.overrides[policy.id] || saved.defaults[policy.id];
  const isImage = "kind" in policy;
  const models = saved.models.filter((model) => isImage === model.startsWith("gpt-image"));
  const [customInput, setCustomInput] = useState(false);
  const custom = customInput || (!!value.model && !models.includes(value.model));

  return <fieldset className="ai-setting-row" disabled={w.saving}>
    <legend className="sr-only">{policy.title}</legend>
    <div className="ai-setting-name">
      <h3>{policy.title}{w.dirtyIds.includes(policy.id) ? <small>待保存</small> : null}</h3>
      <p>{policy.description}</p>
    </div>
    <div className="ai-model-field">
      <label className="ai-field">
        <span className="ai-column-label">模型</span>
        <select aria-label={`${policy.title}模型`} value={custom ? "__custom__" : value.model} onChange={(event) => {
          setCustomInput(event.target.value === "__custom__");
          if (event.target.value !== "__custom__") w.change([policy.id], { model: event.target.value });
        }}>
          <option value="">默认 · {saved.inheritedModels[policy.id]}</option>
          {models.map((model) => <option key={model} value={model}>{model}</option>)}
          <option value="__custom__">其他模型…</option>
        </select>
      </label>
      {custom ? <label className="ai-field"><span>自定义模型 ID</span><input aria-label={`${policy.title}自定义模型 ID`} value={value.model} placeholder="输入模型 ID，留空沿用默认" onChange={(event) => w.change([policy.id], { model: event.target.value })}/></label> : null}
    </div>
    <label className="ai-field">
      <span className="ai-column-label">推理强度</span>
      <select aria-label={`${policy.title}推理强度`} disabled={isImage} value={isImage ? "none" : value.effort} onChange={(event) => w.change([policy.id], { effort: event.target.value as AiEffort | "default" })}>
        {isImage ? <option value="none">图片模型不适用</option> : ["default", ...AI_EFFORTS].map((effort) => <option value={effort} key={effort}>{effortLabels[effort as keyof typeof effortLabels]}</option>)}
      </select>
    </label>
    <button type="button" className="btn compact ai-reset" aria-label={`恢复${policy.title}默认`} disabled={!w.overrides[policy.id]} onClick={() => { setCustomInput(false); w.change([policy.id], null); }}>恢复默认</button>
  </fieldset>;
}

export default function AiSettingsPage() {
  const w = useAiSettings();

  return <div className="ai-settings-page" data-unsaved-changes={w.dirty ? "true" : undefined}>
    <header className="page-header ai-settings-header">
      <div><span className="page-title-eyebrow">PREFERENCES / 01</span><h1>让工具，适合你的工作方式</h1><p>按创作环节组织模型与服务配置。</p></div>
      <div className="ai-header-actions">
        <span className="ai-save-state" role="status">{w.loading ? "读取中…" : w.error ? "需要处理" : w.dirty ? `${w.dirtyIds.length} 项待保存` : "已保存"}</span>
        <button className="btn" disabled={!w.dirty || w.saving} onClick={w.discard}>撤销修改</button>
        <button className="btn primary" disabled={!w.dirty || w.saving || w.loading} aria-busy={w.saving} onClick={() => void w.save()}><Save size={15}/>{w.saving ? "保存中…" : "保存更改"}</button>
      </div>
    </header>
    {w.error ? <div className="ai-message error" role="alert"><span>{w.error}</span><button className="btn compact" disabled={w.saving} onClick={() => { if (!w.dirty || window.confirm("重新载入将丢弃当前未保存修改，确定继续吗？")) void w.load(); }}>重新载入</button></div> : null}
    {w.message ? <div className="ai-message success" role="status">{w.message}</div> : null}
    <div className="ai-view-label">工作区</div>
    <div className="ai-workspace">
    {w.loading ? <div className="panel ai-loading" role="status">正在读取模型配置…</div> : w.saved ? <div className="panel ai-settings-list" aria-busy={w.saving}>
      <span className="page-title-eyebrow">MODEL PREFERENCES</span><h2 className="ai-section-title">按工作环节配置</h2>
      {AI_GROUPS.slice(1).map((group) => <section className="ai-settings-group" id={`ai-group-${AI_GROUPS.indexOf(group)}`} key={group} aria-label={group}>
        <div className="ai-group-heading"><h2>{group}</h2><span>模型</span><span>推理强度</span><span className="sr-only">操作</span></div>
        {AI_POLICIES.filter((policy) => policy.group === group).map((policy) => <PolicyRow key={policy.id} policy={policy} w={w}/>)}
      </section>)}
      <p className="ai-service-note">语音转写：{w.saved.services.asr}，无需设置推理强度。转写稿模型清洗{w.saved.services.transcriptCleaning ? "已开启" : "默认关闭"}。</p>
    </div> : null}
      <aside className="ai-inspector" aria-label="配置说明">
        <span className="page-title-eyebrow">CONTEXT / 当前工作</span>
        <h2>配置说明</h2>
        <p>按工作环节选择模型。留空沿用服务默认配置，修改后点击保存生效。</p>
        <nav aria-label="配置分组">{AI_GROUPS.slice(1).map((group, index) => <a href={`#ai-group-${index + 1}`} key={group}><span>{group}</span><span aria-hidden="true">↗</span></a>)}</nav>
        <h3>当前修改</h3>
        <p role="status">{w.dirty ? `${w.dirtyIds.length} 项配置尚未保存` : "没有待保存的修改"}</p>
        <p>恢复默认只影响对应环节，仍需保存。图片模型不使用推理强度。</p>
      </aside>
    </div>
  </div>;
}
