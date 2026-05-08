"use client";

import { useMemo, useState } from "react";
import { Copy, ExternalLink, Eye, FileUp, Globe2, RotateCcw, Save, Send } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { publishFeishuDocument, writeCopy } from "@/lib/client";
import { Draft } from "@/lib/types";

export default function WriterPage() {
  const { library, loading, refresh } = useLibrary();
  const [targetType, setTargetType] = useState<"account" | "project">("account");
  const [accountId, setAccountId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<Draft["mode"]>("topic");
  const [prompt, setPrompt] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [useWebResearch, setUseWebResearch] = useState(false);
  const [lastContent, setLastContent] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [feishuResult, setFeishuResult] = useState<{ title: string; url: string } | null>(null);

  const selectedAccount = useMemo(() => {
    const first = library?.accounts[0];
    return library?.accounts.find((account) => account.id === accountId) || first || null;
  }, [library?.accounts, accountId]);

  const selectedProject = useMemo(() => {
    const first = library?.projects[0];
    return library?.projects.find((project) => project.id === projectId) || first || null;
  }, [library?.projects, projectId]);

  const activeStyle = targetType === "project" ? selectedProject?.style : selectedAccount?.style;
  const activeTitle = targetType === "project" ? selectedProject?.name : selectedAccount?.name;
  const activeSubtitle =
    targetType === "project"
      ? `${selectedProject?.sourceAccounts.length || 0} 个参考账号`
      : selectedAccount
        ? `${formatPlatform(selectedAccount.platform)} / ${selectedAccount.videoCount} 条视频 / ${selectedAccount.transcriptCount} 份转写`
        : "";
  const canGenerate = Boolean(prompt.trim() && !busy && (targetType === "project" ? selectedProject : selectedAccount));

  async function handleGenerate(save = false) {
    if (!canGenerate) return;
    setBusy(save ? "save" : "generate");
    setNotice("");

    try {
      const result = await writeCopy({
        targetType,
        platform: targetType === "account" ? selectedAccount?.platform : undefined,
        accountId: targetType === "account" ? selectedAccount?.id : undefined,
        projectId: targetType === "project" ? selectedProject?.id : undefined,
        mode,
        prompt,
        sourceText,
        save,
        useWebResearch
      });
      setLastContent(result.content);
      setNotice(result.fallback ? "已使用本地模板生成。" : `已调用 ${result.usedModel}${useWebResearch ? "，已启用联网检索" : ""}。`);
      if (save) await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy("");
    }
  }

  async function copyLast() {
    if (!lastContent) return;
    await navigator.clipboard.writeText(lastContent);
    setNotice("已复制。");
  }

  async function handlePublishFeishu() {
    if (!lastContent) return;
    setBusy("feishu");
    setNotice("");
    try {
      const result = await publishFeishuDocument({
        title: `${activeTitle || "写作台"}｜${new Date().toLocaleDateString("zh-CN")}`,
        content: lastContent
      });
      setFeishuResult({ title: result.title, url: result.url });
      setNotice("已发布到飞书文档。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "发布飞书文档失败");
    } finally {
      setBusy("");
    }
  }

  if (!loading && !library?.accounts.length && !library?.projects.length) {
    return (
      <div className="page">
        <header className="page-header workbench-header">
          <div>
            <p className="eyebrow">Writer</p>
            <h1>对话写作</h1>
            <p className="subtle">需要至少一个账号或项目风格作为引用。</p>
          </div>
        </header>
        <EmptyState title="还没有可参考的风格" body="先采集一个账号，或在账号库里创建项目风格卡，再来这里生成文案。" action={{ href: "/", label: "去采集账号" }} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Writer</p>
          <h1>对话写作</h1>
          <p className="subtle">选风格，填需求，生成成稿。</p>
        </div>
        <div className="stat-row">
          <span className="stat-pill">{library?.accounts.length || 0} 个账号</span>
          <span className="stat-pill">{library?.projects.length || 0} 个项目</span>
        </div>
      </header>

      {notice ? <div className={notice.includes("失败") || notice.includes("未配置") ? "error" : "notice"}>{notice}</div> : null}

      <section className="writer-workbench">
        <section className="panel writer-main">
          <div className="writer-refbar">
            <div className="segmented">
              <button className={targetType === "account" ? "active" : ""} onClick={() => setTargetType("account")} type="button">
                账号
              </button>
              <button
                className={targetType === "project" ? "active" : ""}
                disabled={!library?.projects.length}
                onClick={() => setTargetType("project")}
                type="button"
              >
                项目
              </button>
            </div>

            {loading ? (
              <span className="stat-pill">读取中</span>
            ) : targetType === "project" ? (
              <select className="writer-ref-select" value={selectedProject?.id || ""} onChange={(event) => setProjectId(event.target.value)}>
                {library?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : (
              <select className="writer-ref-select" value={selectedAccount?.id || ""} onChange={(event) => setAccountId(event.target.value)}>
                {library?.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {formatPlatform(account.platform)} / {account.name}
                  </option>
                ))}
              </select>
            )}

            <div className="writer-ref-summary">
              <strong>{activeTitle || "未选择"}</strong>
              <span>{activeSubtitle || "暂无引用信息"}</span>
            </div>
          </div>

          <div className="writer-content-grid">
            <div className="writer-task">
              <div className="section-title-row">
                <h2>写作需求</h2>
                <div className="segmented">
                  <button className={mode === "topic" ? "active" : ""} onClick={() => setMode("topic")} type="button">
                    主题
                  </button>
                  <button className={mode === "rewrite" ? "active" : ""} onClick={() => setMode("rewrite")} type="button">
                    改写
                  </button>
                </div>
              </div>

              <textarea
                className="writer-textarea main"
                placeholder={mode === "topic" ? "主题、目标人群、核心观点..." : "改写要求、语气、长度、平台..."}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              {mode === "rewrite" ? (
                <textarea
                  className="writer-textarea source"
                  placeholder="粘贴原文"
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                />
              ) : null}

              <div className="writer-actionbar">
                <button
                  className={`btn icon-toggle ${useWebResearch ? "active" : ""}`}
                  onClick={() => setUseWebResearch((enabled) => !enabled)}
                  type="button"
                  aria-pressed={useWebResearch}
                  title="联网检索"
                >
                  <Globe2 size={16} />
                  {useWebResearch ? "联网开" : "联网关"}
                </button>
                <button className="btn primary" disabled={!canGenerate} onClick={() => handleGenerate(false)} type="button">
                  <Send size={16} />
                  {busy === "generate" ? "生成中..." : "生成"}
                </button>
                {targetType === "account" ? (
                  <button className="btn" disabled={!canGenerate} onClick={() => handleGenerate(true)} type="button">
                    <Save size={16} />
                    保存草稿
                  </button>
                ) : null}
              </div>
            </div>

            <div className="writer-result">
              <div className="section-title-row">
                <h2>生成结果</h2>
                <div className="button-row">
                  <button className="btn" disabled={!lastContent} onClick={copyLast} type="button">
                    <Copy size={16} />
                    复制
                  </button>
                  <button className="btn" disabled={!lastContent || busy === "feishu"} onClick={handlePublishFeishu} type="button">
                    <FileUp size={16} />
                    {busy === "feishu" ? "发布中..." : "飞书文档"}
                  </button>
                  <button className="btn" disabled={!lastContent || !canGenerate} onClick={() => handleGenerate(false)} type="button">
                    <RotateCcw size={16} />
                    重写
                  </button>
                </div>
              </div>
              <div className={`result-box ${lastContent ? "" : "empty"}`}>
                {busy === "generate" || busy === "save" ? "生成中..." : lastContent || "暂无结果"}
              </div>
            </div>
          </div>
        </section>

        <aside className="panel writer-style-panel">
          <div className="panel-inner detail-stack">
            <details className="style-reference" open>
              <summary>
                <span>
                  <h2>引用风格</h2>
                  <small>{activeTitle || "未选择风格"}</small>
                </span>
              </summary>
              <div className="stat-row">
                {targetType === "project" && selectedProject ? (
                  <>
                    <span className="stat-pill">项目</span>
                    <span className="stat-pill">{selectedProject.sourceAccounts.length} 个账号</span>
                  </>
                ) : selectedAccount ? (
                  <>
                    <span className="stat-pill">{formatPlatform(selectedAccount.platform)}</span>
                    <span className="stat-pill">{selectedAccount.transcriptCount} 份转写</span>
                  </>
                ) : null}
              </div>
            </details>

            <div className="style-summary-card">
              <h3>{activeTitle || "未选择风格"}</h3>
              <p>{makeStylePreview(activeStyle)}</p>
              <button className="btn" disabled={!activeStyle} onClick={() => setStyleOpen(true)} type="button">
                <Eye size={16} />
                查看风格卡
              </button>
            </div>

            {targetType === "project" && selectedProject ? (
              <div>
                <h3>参考账号</h3>
                <div className="stat-row">
                  {selectedProject.sourceAccounts.map((account) => (
                    <span className="stat-pill" key={account.id}>
                      {formatPlatform(account.platform)} / {account.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </section>

      {styleOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <div className="modal-header">
              <h2>{activeTitle || "风格卡"}</h2>
              <button className="btn" onClick={() => setStyleOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="markdown-box modal-content">{activeStyle || "暂无风格卡"}</div>
          </div>
        </div>
      ) : null}

      {feishuResult ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel feishu-modal">
            <div className="modal-header">
              <h2>飞书文档已创建</h2>
              <button className="btn" onClick={() => setFeishuResult(null)} type="button">
                关闭
              </button>
            </div>
            <div className="feishu-success-card">
              <p>{feishuResult.title}</p>
              <a className="btn primary" href={feishuResult.url} rel="noreferrer" target="_blank">
                <ExternalLink size={16} />
                打开飞书文档
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function makeStylePreview(style?: string) {
  const text = (style || "").replace(/[#*_>`-]/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 180) : "暂无风格卡";
}
