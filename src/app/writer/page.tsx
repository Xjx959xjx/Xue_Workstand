"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, ExternalLink, Eye, FileUp, Globe2, RotateCcw, Save, Send } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { publishFeishuDocument, saveDraft, streamWriteCopy, writeCopy } from "@/lib/client";
import { AccountDraftInput, Draft, DraftInput, ProjectDraftInput, WriteResult } from "@/lib/types";

type DraftSaveBase = Omit<AccountDraftInput, "content"> | Omit<ProjectDraftInput, "content">;

export default function WriterPage() {
  return (
    <Suspense fallback={<WriterFallback />}>
      <WriterPageContent />
    </Suspense>
  );
}

function WriterPageContent() {
  const searchParams = useSearchParams();
  const { library, loading, refresh } = useLibrary();
  const [targetType, setTargetType] = useState<"account" | "project">("account");
  const [accountId, setAccountId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<Draft["mode"]>("topic");
  const [prompt, setPrompt] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [useWebResearch, setUseWebResearch] = useState(false);
  const [lastContent, setLastContent] = useState("");
  const [lastResearch, setLastResearch] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [lastDraftBase, setLastDraftBase] = useState<DraftSaveBase | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [generateStage, setGenerateStage] = useState("");
  const [generateProgress, setGenerateProgress] = useState(0);
  const [styleOpen, setStyleOpen] = useState(false);
  const [feishuResult, setFeishuResult] = useState<{ title: string; url: string } | null>(null);
  const styleDialogRef = useRef<HTMLDivElement>(null);
  const feishuDialogRef = useRef<HTMLDivElement>(null);

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
  const isCurrentSaved = Boolean(lastContent && lastDraftBase) && lastSavedContent === lastContent;
  const noticeIsError = notice.includes("失败") || notice.includes("未配置");

  useEffect(() => {
    if (!styleOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    styleDialogRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [styleOpen]);

  useEffect(() => {
    if (!feishuResult) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    feishuDialogRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [feishuResult]);

  useEffect(() => {
    const target = searchParams.get("targetType");
    const nextMode = searchParams.get("mode");
    const nextPrompt = searchParams.get("prompt");
    const nextSourceText = searchParams.get("sourceText");
    const nextAccountId = searchParams.get("accountId");
    const nextProjectId = searchParams.get("projectId");
    const draftId = searchParams.get("draftId");
    const sourceDraft = draftId ? library?.drafts.find((draft) => draft.id === draftId) : null;

    if (target === "project") setTargetType("project");
    if (target === "account") setTargetType("account");
    if (nextMode === "topic" || nextMode === "rewrite") setMode(nextMode);
    if (sourceDraft) {
      setPrompt(sourceDraft.prompt);
      setSourceText(sourceDraft.content);
    } else {
      if (nextPrompt !== null) setPrompt(nextPrompt);
      if (nextSourceText !== null) setSourceText(nextSourceText);
    }
    if (nextAccountId) setAccountId(nextAccountId);
    if (nextProjectId) setProjectId(nextProjectId);
  }, [library?.drafts, searchParams]);

  async function handleGenerate() {
    if (!canGenerate) return;
    setBusy("generate");
    setNotice("");
    setGenerateStage("准备写作任务");
    setGenerateProgress(6);
    setLastContent("");
    setLastResearch("");

    try {
      const payload = {
        targetType,
        platform: targetType === "account" ? selectedAccount?.platform : undefined,
        accountId: targetType === "account" ? selectedAccount?.id : undefined,
        projectId: targetType === "project" ? selectedProject?.id : undefined,
        mode,
        prompt,
        sourceText,
        useWebResearch
      };

      const result = await new Promise<WriteResult>(async (resolve, reject) => {
        try {
          await streamWriteCopy(payload, {
            onStage(stage) {
              setGenerateStage(stage.message);
              setGenerateProgress(stage.progress || 0);
            },
            onDelta(delta) {
              setGenerateStage("正在生成文案");
              setGenerateProgress((current) => Math.max(current, 60));
              setLastContent((current) => current + delta);
            },
            onResearch(research) {
              setLastResearch(research);
            },
            onResult(result) {
              setLastContent(result.content);
              setLastResearch(result.research || "");
              setGenerateStage("生成完成");
              setGenerateProgress(100);
              resolve(result);
            }
          });
        } catch {
          try {
            const fallback = await writeCopy(payload);
            setLastContent(fallback.content);
            setLastResearch(fallback.research || "");
            setGenerateStage("已切换到兼容模式完成生成");
            setGenerateProgress(100);
            resolve(fallback);
          } catch (error) {
            reject(error);
          }
        }
      });

      setLastSavedContent("");
      setLastDraftBase(
        targetType === "project" && selectedProject
          ? {
              targetType: "project",
              projectId: selectedProject.id,
              projectName: selectedProject.name,
              title: makeDraftTitle(prompt),
              mode,
              prompt,
              input: sourceText,
              styleRef: {
                projectId: selectedProject.id,
                projectName: selectedProject.name,
                sourceAccountIds: selectedProject.sourceAccounts.map((account) => account.id)
              }
            }
          : targetType === "account" && selectedAccount
            ? {
                platform: selectedAccount.platform,
                accountId: selectedAccount.id,
                accountName: selectedAccount.name,
                title: makeDraftTitle(prompt),
                mode,
                prompt,
                input: sourceText,
                styleRef: {
                  platform: selectedAccount.platform,
                  accountId: selectedAccount.id,
                  accountName: selectedAccount.name
                }
              }
            : null
      );
      setNotice(
        result.fallback
          ? result.fallbackReason || "已使用本地模板生成。"
          : `已调用 ${result.usedModel}${useWebResearch ? "，已启用联网检索" : ""}。`
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成失败");
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setGenerateStage("");
        setGenerateProgress(0);
      }, 500);
    }
  }

  async function handleSaveDraft() {
    if (!lastContent || !lastDraftBase) return;
    setBusy("draft-save");
    setNotice("");
    try {
      const payload: DraftInput =
        lastDraftBase.targetType === "project"
          ? {
              ...lastDraftBase,
              content: lastContent
            }
          : {
              ...lastDraftBase,
              content: lastContent
            };
      await saveDraft(payload);
      setLastSavedContent(lastContent);
      setNotice("草稿已保存。");
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "保存草稿失败");
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

      {notice ? (
        <div aria-live={noticeIsError ? "assertive" : "polite"} className={noticeIsError ? "error" : "notice"} role={noticeIsError ? "alert" : "status"}>
          {notice}
        </div>
      ) : null}

      <section className="writer-workbench">
        <section className="panel writer-main">
          <div className="writer-refbar">
            <div aria-label="选择引用类型" className="segmented" role="group">
              <button aria-pressed={targetType === "account"} className={targetType === "account" ? "active" : ""} onClick={() => setTargetType("account")} type="button">
                账号
              </button>
              <button
                aria-pressed={targetType === "project"}
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
              <select aria-label="选择参考项目" className="writer-ref-select" value={selectedProject?.id || ""} onChange={(event) => setProjectId(event.target.value)}>
                {library?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : (
              <select aria-label="选择参考账号" className="writer-ref-select" value={selectedAccount?.id || ""} onChange={(event) => setAccountId(event.target.value)}>
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
                <div aria-label="选择写作模式" className="segmented" role="group">
                  <button aria-pressed={mode === "topic"} className={mode === "topic" ? "active" : ""} onClick={() => setMode("topic")} type="button">
                    主题
                  </button>
                  <button aria-pressed={mode === "rewrite"} className={mode === "rewrite" ? "active" : ""} onClick={() => setMode("rewrite")} type="button">
                    改写
                  </button>
                </div>
              </div>

              <textarea
                aria-label={mode === "topic" ? "写作主题和要求" : "改写要求"}
                className="writer-textarea main"
                placeholder={mode === "topic" ? "主题、目标人群、核心观点…" : "改写要求、语气、长度、平台…"}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              {mode === "rewrite" ? (
                <textarea
                  aria-label="需要改写的原文"
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
                <button
                  className="btn primary"
                  disabled={!canGenerate}
                  onClick={handleGenerate}
                  title={prompt.trim() ? "按当前引用风格生成文案" : "填写写作需求后可生成"}
                  type="button"
                >
                  <Send size={16} />
                  {busy === "generate" ? "生成中..." : "生成"}
                </button>
              </div>
            </div>

            <div className="writer-result">
              <div className="section-title-row">
                <h2>生成结果</h2>
                {lastContent ? (
                  <div className="button-row">
                    <button className="btn" onClick={copyLast} type="button">
                      <Copy size={16} />
                      复制
                    </button>
                    {lastDraftBase ? (
                      <button
                        className="btn"
                        disabled={isCurrentSaved || busy === "draft-save"}
                        onClick={handleSaveDraft}
                        type="button"
                        title={targetType === "project" ? "保存当前结果到生成时的参考项目" : "保存当前结果到生成时的参考账号"}
                      >
                        <Save size={16} />
                        {busy === "draft-save" ? "保存中..." : isCurrentSaved ? "已保存" : "保存草稿"}
                      </button>
                    ) : null}
                    <button className="btn" disabled={busy === "feishu"} onClick={handlePublishFeishu} type="button">
                      <FileUp size={16} />
                      {busy === "feishu" ? "发布中..." : "飞书文档"}
                    </button>
                    <button className="btn" disabled={!canGenerate} onClick={handleGenerate} type="button">
                      <RotateCcw size={16} />
                      重写
                    </button>
                  </div>
                ) : (
                  <span className="status-pill pending">{busy === "generate" ? "生成中" : "等待生成"}</span>
                )}
              </div>
              {busy === "generate" ? (
                <div className="project-progress" role="status" aria-live="polite" style={{ marginBottom: 16 }}>
                  <div className="project-progress-copy">
                    <span>{generateStage || "正在生成文案"}</span>
                    <strong>{generateProgress}%</strong>
                  </div>
                  <div className="progress-track" aria-hidden="true">
                    <div className="progress-fill" style={{ width: `${generateProgress}%` }} />
                  </div>
                </div>
              ) : null}
              <div className={`result-box ${lastContent ? "" : "empty"}`}>
                {busy === "generate" && !lastContent ? "正在等待首段内容..." : lastContent || "暂无结果"}
              </div>
              {lastResearch ? (
                <details className="style-reference" style={{ marginTop: 16 }}>
                  <summary>
                    <span className="style-reference-heading">
                      <span className="style-reference-title">联网资料</span>
                      <small>本次生成使用的研究摘要</small>
                    </span>
                  </summary>
                  <div className="style-reference-body">
                    <pre className="result-box" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                      {lastResearch}
                    </pre>
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="panel writer-style-panel">
          <div className="panel-inner detail-stack">
            <details className="style-reference" open>
              <summary>
                <span className="style-reference-heading">
                  <span className="style-reference-title">引用风格</span>
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
        <div className="modal-backdrop">
          <div
            aria-labelledby="writer-style-dialog-title"
            aria-modal="true"
            className="modal-panel"
            onKeyDown={(event) => handleDialogKeyDown(event, () => setStyleOpen(false))}
            ref={styleDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="modal-header">
              <h2 id="writer-style-dialog-title">{activeTitle || "风格卡"}</h2>
              <button className="btn" onClick={() => setStyleOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="markdown-box modal-content">{activeStyle || "暂无风格卡"}</div>
          </div>
        </div>
      ) : null}

      {feishuResult ? (
        <div className="modal-backdrop">
          <div
            aria-labelledby="writer-feishu-dialog-title"
            aria-modal="true"
            className="modal-panel feishu-modal"
            onKeyDown={(event) => handleDialogKeyDown(event, () => setFeishuResult(null))}
            ref={feishuDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="modal-header">
              <h2 id="writer-feishu-dialog-title">飞书文档已创建</h2>
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

function WriterFallback() {
  return (
    <div className="page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Writer</p>
          <h1>对话写作</h1>
          <p className="subtle">正在读取写作台。</p>
        </div>
      </header>
      <section className="panel">
        <div className="panel-inner">
          <p className="subtle">加载中...</p>
        </div>
      </section>
    </div>
  );
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );

  if (!focusable.length) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (document.activeElement === event.currentTarget) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function makeStylePreview(style?: string) {
  const text = (style || "").replace(/[#*_>`-]/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 180) : "暂无风格卡";
}

function makeDraftTitle(prompt: string) {
  const title = prompt.replace(/\s+/g, " ").trim().slice(0, 32);
  return title || "未命名草稿";
}
