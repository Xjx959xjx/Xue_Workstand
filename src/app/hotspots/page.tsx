"use client";
import { Suspense, useEffect, useState } from "react";
import { Clock3, Columns3, LayoutGrid, ListFilter, Loader2, Newspaper, Radar, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useRadarController } from "./useRadarController";
import { RadarResults } from "./RadarResults";
import { RadarDetail } from "./RadarDetail";
import { radarCategories, radarDate as date } from "./radar-presentation";
import { radarGrades } from "@/lib/hotspot-radar/types";

export default function HotspotsPage() {
  return <Suspense fallback={<div className="page" role="status">正在打开热点雷达…</div>}><RadarWorkspace /></Suspense>;
}
function RadarWorkspace() {
  const c = useRadarController();
  const [diagnostics, setDiagnostics] = useState(false);
  const [query, setQuery] = useState(c.search);
  useEffect(() => setQuery(c.search), [c.search]);
  const collection = c.snapshot?.collection;
  const scouts = c.snapshot?.scouts || [];
  const successful = scouts.filter(item => item.lastCheckedAt && !item.error).length;
  const latestFailed = !c.active && c.latest?.status === "failed";
  const state = c.loading && !c.snapshot ? "正在读取" : c.active ? "正在更新" : collection?.status === "failed" ? "分析未完成" : collection?.status === "cancelled" ? "分析已停止" : collection?.status === "completed" ? "已更新" : collection ? "资讯已就绪" : "等待首次采集";
  const failure = collection?.error || (latestFailed ? c.latest?.error || c.latest?.message : "");
  const report = c.snapshot?.dailyReport;
  function filter(key: string, value: string) { c.setFilter({ [key]: value, page: "", item: "" }); }
  return <div className="page radar-page">
    <header className="page-header">
      <div className="page-title-group"><span className="page-title-eyebrow">内容发现</span><div className="page-title-row"><span className="page-title-mark"><Radar size={21} /></span><div className="page-title-copy"><h1>热点雷达</h1><p className="subtle">先读资讯，再挑选题。游戏圈值得关注的事，集中看。</p></div></div></div>
      <div className="radar-header-actions"><button className="btn" aria-expanded={diagnostics} onClick={() => setDiagnostics(value => !value)}><ListFilter size={16} />来源状态</button><button className="btn primary" disabled={Boolean(c.active) || c.starting} aria-busy={Boolean(c.active) || c.starting} onClick={() => void c.refresh()}>{c.active || c.starting ? <Loader2 size={16} /> : <RefreshCw size={16} />}采集并筛选</button></div>
    </header>
    {c.error ? <p className="error" role="alert">{c.error}</p> : null}

    <div className="radar-view-toolbar">
      <div className="radar-content-tabs" role="group" aria-label="内容类型">
        <button aria-pressed={c.view === "topics"} onClick={() => c.setFilter({ view: "topics", page: "", item: "" })}><Sparkles size={16} />AI 选题<span>{c.topicCount}</span></button>
        <button aria-pressed={c.view === "news"} onClick={() => c.setFilter({ view: "news", page: "", item: "" })}><Newspaper size={16} />全部资讯<span>{collection?.signalCount || 0}</span></button>
      </div>
      <div className="radar-view-switch" role="group" aria-label="查看方式">
        <button className="btn compact" aria-pressed={c.layout === "cards"} onClick={() => c.setLayout("cards")}><LayoutGrid size={15} />卡片视图</button>
        <button className="btn compact" aria-pressed={c.layout === "overview"} onClick={() => c.setLayout("overview")}><Columns3 size={15} />分类总览</button>
      </div>
    </div>
    <div className="radar-filters">
      <form onSubmit={event => { event.preventDefault(); filter("q", query.trim()); }} className="radar-search field"><label htmlFor="radar-search">搜索内容</label><div><input id="radar-search" placeholder="标题、游戏、人物或来源" value={query} onChange={event => setQuery(event.target.value)} /><button className="btn icon-btn" aria-label="搜索"><Search size={16} /></button></div></form>
      {c.view === "topics" ? <><div className="field"><label htmlFor="radar-category">分类</label><select id="radar-category" value={c.category} onChange={e => filter("category", e.target.value)}><option value="">全部分类</option>{radarCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div className="field"><label htmlFor="radar-grade">优先级</label><select id="radar-grade" value={c.grade} onChange={e => filter("grade", e.target.value)}><option value="">全部优先级</option>{radarGrades.map(grade => <option key={grade}>{grade}</option>)}</select></div></> : null}
      <div className="field"><label htmlFor="radar-source">来源</label><select id="radar-source" value={c.source} onChange={e => filter("source", e.target.value)}><option value="">全部来源</option>{scouts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <button className="btn compact radar-reset" onClick={() => c.setFilter({ q: "", source: "", category: "", grade: "", sort: "", page: "", item: "" })}>重置筛选</button>
      {c.view === "topics" ? <div className="field radar-sort"><label htmlFor="radar-sort">排序</label><select id="radar-sort" value={c.sort} onChange={e => filter("sort", e.target.value)}><option value="latest">最新优先</option><option value="priority">优先级最高</option></select></div> : null}
    </div>
    {report ? <details className="radar-report"><summary><strong>选题日报</strong><span>{report.headline}</span><time>{date(c.snapshot?.generatedAt)}</time></summary><div><p>{report.overview}</p><ul>{report.signals.map((item, i) => <li key={i}>{item}</li>)}</ul><p>{report.communityMood}</p><h3>后续关注</h3><ul>{report.tomorrowWatch.map((item, i) => <li key={i}>{item}</li>)}</ul></div></details> : null}
    <section className="radar-health" aria-label="采集与分析状态">
      <div><span className={`status-pill ${failure ? "failed" : c.active ? "pending" : ""}`}>{state}</span><span>{collection ? `${collection.signalCount} 条资讯已保存` : "资讯会在采集完成后先展示"}</span><span>{successful}/{scouts.length || 36} 个来源可用</span><span><Clock3 size={13} />{date(collection?.generatedAt || c.snapshot?.generatedAt)}</span></div>
      {c.active ? <div className="radar-progress" role="status" aria-live="polite"><progress max={100} value={c.active.progress} /><span>{c.active.message}</span><button className="btn compact" onClick={() => void c.cancel()}>停止</button></div> : null}
      {failure && collection && collection.candidateCount > 0 && collection.analyzedCount === collection.candidateCount && !c.active ? <button className="btn compact" disabled={c.starting} onClick={() => void c.refresh(true)}>保留选题，仅重试日报</button> : null}
      {failure ? <p role="alert">{failure} 已采集资讯仍可阅读；可重新采集，或到 AI 模型配置检查节点。</p> : null}
      {c.provisional.length ? <p role="status">本轮已有 {c.provisional.length} 个选题，分析覆盖 {collection?.analyzedCount}/{collection?.candidateCount} 条候选；其余批次尚未完成。</p> : null}
    </section>
    {diagnostics ? <section className="panel radar-diagnostics"><div><h2>来源诊断</h2><button className="btn icon-btn" aria-label="收起来源诊断" onClick={() => setDiagnostics(false)}><X size={16} /></button></div><ul>{scouts.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.itemCount} 条</span><span className={item.error ? "radar-error-text" : "subtle"}>{item.error || (item.lastCheckedAt ? "采集完成" : "尚未采集")}</span></li>)}</ul></section> : null}

    <RadarResults c={c} />
    {c.selectedId ? <RadarDetail c={c} /> : null}
  </div>;
}
