"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Save } from "lucide-react";
import { WorkbenchSelect } from "@/components/WorkbenchSelect";
import { AI_EFFORTS, AI_GROUPS, AI_POLICIES, type AiEffort, type AiPolicyValue } from "@/lib/ai-policy-catalog";
import { useAiSettings } from "./useAiSettings";
import "./settings.css";

type Settings = {
  provider: string;
  model: string;
  thinking: string;
  subscriptions: { provider: string; connected: boolean; models: { id: string; name: string }[] }[];
};

const effortLabels = { low: "轻量", medium: "均衡", high: "深入", xhigh: "最高" };
const relayModels = ["gpt-6-astra", "gpt-6.1-sol", "gpt-5.6-sol"];

function PolicySettings({ subscriptionModel }: { subscriptionModel: string }) {
  const w = useAiSettings();
  return <section className="ai-settings-section" aria-labelledby="policy-heading" data-unsaved-changes={w.dirty ? "true" : undefined}>
    <div className="ai-settings-section-head"><div><h2 id="policy-heading">各环节模型</h2><p>逐项指定调用来源；自动优先会在订阅不可用时转用中转。</p></div>
      <span role="status" className="ai-save-state">{w.loading ? "读取中…" : w.dirty ? `${w.dirtyIds.length} 项待保存` : "已保存"}</span></div>
    {w.error && <p role="alert" className="ai-settings-notice error">{w.error}</p>}
    {w.message && <p role="status" className="ai-settings-notice">{w.message}</p>}
    {w.saved && <div className="ai-policy-list" aria-busy={w.saving}>
      {AI_GROUPS.slice(1).map(group => <div key={group} className="ai-policy-group"><h3>{group}</h3>
        {AI_POLICIES.filter(p => p.group === group && !("retired" in p && p.retired)).map(policy => {
          const fixed = policy.id === "web_research";
          const value = w.overrides[policy.id] || w.saved!.defaults[policy.id];
          const source = fixed ? "relay" : value.source || (policy.id === "image_generate" ? "relay" : "auto");
          const isImage = "kind" in policy;
          const models = isImage ? w.saved!.models.filter(model => model.startsWith("gpt-image")) : [...new Set([value.model, w.saved!.inheritedModels[policy.id], ...relayModels].filter(Boolean))];
          const model = value.model || w.saved!.inheritedModels[policy.id];
          const effort = value.effort === "default" ? w.saved!.inheritedEfforts[policy.id] : value.effort;
          return <div className="ai-policy-row" key={policy.id}>
            <div className="ai-policy-name"><strong>{policy.title}{w.dirtyIds.includes(policy.id) && <small> 待保存</small>}</strong><span>{policy.description}</span></div>
            <label><span>调用来源</span><WorkbenchSelect aria-label={`${policy.title}调用来源`} disabled={fixed || w.saving} value={source} onValueChange={next => w.change([policy.id], { source: next as AiPolicyValue["source"] })}>
              {policy.id !== "image_generate" && <option value="auto">订阅优先，中转兜底</option>}<option value="subscription">仅订阅</option><option value="relay">仅中转</option>
            </WorkbenchSelect></label>
            <label><span>中转模型</span><WorkbenchSelect aria-label={`${policy.title}中转模型`} disabled={w.saving} value={model} onValueChange={next => w.change([policy.id], { model: next })}>
              {models.map(item => <option key={item} value={item}>{item}</option>)}
            </WorkbenchSelect></label>
            <label><span>中转推理</span><WorkbenchSelect aria-label={`${policy.title}中转推理强度`} disabled={isImage || w.saving} value={isImage ? "none" : effort} onValueChange={next => w.change([policy.id], { effort: next as AiEffort })}>
              {isImage ? <option value="none">不适用</option> : AI_EFFORTS.filter(item => item !== "none").map(item => <option key={item} value={item}>{effortLabels[item]}</option>)}
            </WorkbenchSelect></label>
            <button className="btn compact" type="button" disabled={!w.overrides[policy.id] || w.saving} onClick={() => w.change([policy.id], null)}>重置</button>
            {source !== "relay" && <span className="ai-policy-source-note">{isImage ? "使用 ChatGPT 订阅（Codex）生图；失败不会自动使用中转。本机工作台可用。" : `订阅使用默认模型：${subscriptionModel || "尚未配置"}`}</span>}
          </div>;
        })}</div>)}
      <p className="ai-settings-footnote">联网检索使用中转；图片生成可选择 ChatGPT 订阅或中转，保存后重新打开生图页面。语音转写使用 {w.saved.services.asr}。</p>
    </div>}
    <div className="ai-settings-actions"><button className="btn" type="button" disabled={!w.dirty || w.saving} onClick={w.discard}>撤销修改</button><button className="btn primary" type="button" disabled={!w.dirty || w.saving || w.loading} aria-busy={w.saving} onClick={() => void w.save()}><Save size={16} aria-hidden="true" />保存各环节配置</button></div>
  </section>;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(typeof data === "object" && data !== null && "error" in data ? String(data.error) : "请求失败");
  return data as T;
}

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [provider, setProvider] = useState("openai-codex");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("medium");
  const [verifyUrl, setVerifyUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loginController = useRef<AbortController | null>(null);

  async function load(preferredProvider?: string) {
    try {
      const data = await readResponse<Settings>(await fetch("/api/pi-settings", { cache: "no-store" }));
      setSettings(data);
      const nextProvider = preferredProvider || data.provider || "openai-codex";
      setProvider(nextProvider);
      setModel(preferredProvider ? data.subscriptions.find(item => item.provider === nextProvider)?.models[0]?.id || "" : data.model || data.subscriptions.find(item => item.provider === nextProvider)?.models[0]?.id || "");
      setThinking(data.thinking);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取模型配置失败"); }
  }

  useEffect(() => { void load(); return () => loginController.current?.abort(); }, []);

  async function login(loginProvider: "openai" | "openai-codex") {
    const controller = new AbortController();
    loginController.current = controller;
    setBusy(true);
    setVerifyUrl("");
    setError("");
    setMessage("正在准备浏览器授权…");
    try {
      const response = await fetch("/api/pi-settings/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: loginProvider }), signal: controller.signal });
      if (!response.ok) await readResponse(response);
      if (!response.body) throw new Error("登录响应不可用");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let connected = false;
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "stage") setMessage(event.message || "正在确认订阅凭证…");
          if (event.type === "result" && event.data?.verificationUri) {
            setVerifyUrl(event.data.verificationUri);
            setMessage("请打开授权页面并完成 ChatGPT 登录");
          }
          if (event.type === "result" && event.data?.connected) connected = true;
        }
        if (done) break;
      }
      if (!connected) throw new Error("登录连接已中断，请重新发起订阅登录");
      setMessage(`${loginProvider === "openai" ? "OpenAI 直连" : "ChatGPT Codex"} 已连接，请选择模型并保存`);
      setVerifyUrl("");
      await load(loginProvider);
    } catch (cause) {
      if (!controller.signal.aborted) {
        await load();
        setMessage("");
        setVerifyUrl("");
        setError(cause instanceof Error ? cause.message : "订阅登录失败");
      }
    }
    finally { loginController.current = null; setBusy(false); }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await readResponse<{ saved: boolean; verified: boolean; warning?: string }>(await fetch("/api/pi-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, thinking })
      }));
      setMessage(result.warning ? `默认模型已保存，但连通性验证遇到临时问题：${result.warning}；新请求仍会使用该模型。` : "默认模型已保存，新请求立即生效");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存模型配置失败"); }
    finally { setBusy(false); }
  }

  const selected = settings?.subscriptions.find(item => item.provider === provider);
  const connected = settings?.subscriptions.some(item => item.connected);
  const codexConnected = settings?.subscriptions.find(item => item.provider === "openai-codex")?.connected;
  const directConnected = settings?.subscriptions.find(item => item.provider === "openai")?.connected;
  return <div className="page ai-settings-page">
    <header className="page-header"><h1>AI 模型配置</h1></header>
    {error && <p role="alert" className="ai-settings-notice error">{error}</p>}
    {message && <p role="status" className="ai-settings-notice">{message}</p>}
    <section className="ai-settings-section" aria-labelledby="subscription-heading">
      <div className="ai-settings-section-head">
        <div><h2 id="subscription-heading">模型订阅</h2><p>连接 ChatGPT 账号后，选择模型并保存为默认模型。</p></div>
        <span className={`ai-settings-status ${connected ? "connected" : ""}`}>{connected ? "已连接" : "未连接"}</span>
      </div>
      <div className="ai-settings-actions"><button className="btn primary" type="button" disabled={busy} aria-busy={busy} onClick={() => void login("openai-codex")}>{codexConnected ? "重新连接 ChatGPT 订阅" : "连接 ChatGPT 订阅"}</button><button className="btn" type="button" disabled={busy} onClick={() => void login("openai")}>{directConnected ? "重新连接 OpenAI 直连" : "连接 OpenAI 直连"}</button>
      {busy && loginController.current && <button className="btn" type="button" onClick={() => { loginController.current?.abort(); setVerifyUrl(""); setMessage("已取消订阅登录"); }}>取消登录</button>}
      {verifyUrl && <a className="ai-settings-auth-link" href={verifyUrl} target="_blank" rel="noopener noreferrer">打开授权页面 <ExternalLink size={15} aria-hidden="true" /></a>}</div>
      <p className="ai-settings-footnote">OpenAI 直连需要账号额外授予 chatgpt.tokens.use.direct 权限；普通 ChatGPT 订阅请选择左侧入口。</p>
    </section>
    <section className="ai-settings-section" aria-labelledby="model-heading">
      <div className="ai-settings-section-head"><div><h2 id="model-heading">默认模型</h2><p>{settings?.model ? `当前生效：${settings.provider}/${settings.model}` : "尚未选择默认模型"}</p></div></div>
      <div className="ai-settings-fields"><label><span>订阅来源</span><WorkbenchSelect aria-label="订阅来源" value={provider} onValueChange={value => { setProvider(value); setModel(settings?.subscriptions.find(item => item.provider === value)?.models[0]?.id || ""); }}>
        <option value="openai-codex">ChatGPT 订阅（Codex）</option>
        <option value="openai">OpenAI 直连</option>
      </WorkbenchSelect></label>
      <label><span>模型</span>{selected?.connected ? <WorkbenchSelect aria-label="模型" value={model} onValueChange={setModel}>
        {selected?.models.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
      </WorkbenchSelect> : <span className="ai-settings-placeholder">连接订阅后选择模型</span>}</label>
      <label><span>推理强度</span><WorkbenchSelect aria-label="推理强度" disabled={!selected?.connected} value={thinking} onValueChange={setThinking}>
        {["off", "minimal", "low", "medium", "high", "xhigh"].map(value => <option key={value} value={value}>{value}</option>)}
      </WorkbenchSelect></label></div>
      <div className="ai-settings-actions">
        <button className="btn primary" type="button" disabled={busy || !model || !selected?.connected} onClick={() => void save()}><Save size={16} aria-hidden="true" />保存默认模型</button>
        <button className="btn icon-only" type="button" aria-label="刷新模型状态" disabled={busy} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" /></button>
      </div>
      <p className="ai-settings-footnote">订阅环节使用此默认模型；是否允许中转兜底由下方各环节设置决定。</p>
    </section>
    <PolicySettings subscriptionModel={settings?.model ? `${settings.provider}/${settings.model}` : ""} />
  </div>;
}
