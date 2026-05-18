"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, ExternalLink, Eye, FileUp, Globe2, MessageSquarePlus, RotateCcw, Send } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { useTasks } from "@/components/TaskProvider";
import { publishFeishuDocument, saveDraft } from "@/lib/client";
import { DEFAULT_REWRITE_PROMPT, extractRewriteSourceMaterial, normalizeRewritePrompt } from "@/lib/source-extraction";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { library, loading, refresh } = useLibrary();
  const { activeJobs, recentJobs, startTask } = useTasks();
  const { notify } = useFeedback();
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
  const [lastDraftId, setLastDraftId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [generateStage, setGenerateStage] = useState("");
  const [generateProgress, setGenerateProgress] = useState(0);
  const [activeWriteJobId, setActiveWriteJobId] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [feishuResult, setFeishuResult] = useState<{ title: string; url: string } | null>(null);
  const styleDialogRef = useRef<HTMLDivElement>(null);
  const feishuDialogRef = useRef<HTMLDivElement>(null);
  const handledWriteJobsRef = useRef<Set<string>>(new Set());

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
  const sourceExtraction = useMemo(() => extractRewriteSourceMaterial(sourceText), [sourceText]);
  const normalizedPrompt = useMemo(() => normalizeRewritePrompt(mode, prompt, sourceText), [mode, prompt, sourceText]);
  const normalizedSourceText = sourceText;
  const hasRewriteSource = Boolean(normalizedSourceText.trim());
  const hasTaskInput = mode === "topic" ? Boolean(normalizedPrompt.trim()) : Boolean(normalizedPrompt.trim() || hasRewriteSource);
  const activeWriteJob = useMemo(() => {
    const candidates = [...activeJobs, ...recentJobs].filter((job) => job.kind === "write-copy");
    return candidates.find((job) => job.id === activeWriteJobId) || activeJobs.find((job) => job.kind === "write-copy") || null;
  }, [activeJobs, activeWriteJobId, recentJobs]);
  const isGenerating = Boolean(activeWriteJob && (activeWriteJob.status === "queued" || activeWriteJob.status === "running"));
  const canGenerate = Boolean(hasTaskInput && !busy && !isGenerating && (targetType === "project" ? selectedProject : selectedAccount));
  const noticeIsError = notice.includes("失败") || notice.includes("未配置");

  useEffect(() => {
    if (!notice || isBackgroundStartMessage(notice)) return;
    notify({ tone: noticeIsError ? "error" : "success", message: notice });
  }, [notice, noticeIsError, notify]);

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

  useEffect(() => {
    if (!activeWriteJob) return;
    setActiveWriteJobId(activeWriteJob.id);
    setGenerateStage(activeWriteJob.message || "正在生成文案");
    setGenerateProgress(activeWriteJob.progress || 0);
    if (activeWriteJob.partialText) setLastContent(activeWriteJob.partialText);

    if (activeWriteJob.status === "running" || activeWriteJob.status === "queued") {
      setBusy("generate");
      return;
    }

    if (handledWriteJobsRef.current.has(activeWriteJob.id)) return;
    handledWriteJobsRef.current.add(activeWriteJob.id);
    setBusy("");

    if (activeWriteJob.status === "completed") {
      const result = activeWriteJob.result as WriteResult | undefined;
      if (result) {
        setLastContent(result.content);
        setLastResearch(result.research || "");
        setLastSavedContent(result.draft ? result.content : "");
        setLastDraftId(result.draft?.id || "");
        setLastDraftBase(result.draft ? draftToSaveBase(result.draft) : null);
        setNotice(
          `${result.fallback ? result.fallbackReason || "模型暂不可用，已用本地模板生成，可继续编辑。" : `已调用 ${result.usedModel}${useWebResearch ? "，已启用联网检索" : ""}。`}已自动保存到草稿箱。`
        );
      } else {
        setNotice("文案生成完成。");
      }
      setGenerateStage("生成完成");
      setGenerateProgress(100);
      return;
    }

    if (activeWriteJob.status === "failed") {
      setNotice(activeWriteJob.error || "生成失败，请检查模型配置、代理或输入内容后重试。");
      setGenerateStage("生成失败");
      setGenerateProgress(100);
    }
  }, [activeWriteJob, useWebResearch]);

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
        prompt: normalizedPrompt,
        sourceText: normalizedSourceText,
        save: true,
        useWebResearch
      };

      const job = await startTask({
        kind: "write-copy",
        title: mode === "topic" ? "生成主题文案" : "改写文案",
        inputSummary: activeTitle ? `${activeTitle} · ${mode === "topic" ? "主题写作" : "文案改写"}` : undefined,
        href: "/writer",
        input: payload
      });
      setActiveWriteJobId(job.id);
      setGenerateStage(job.message);
      setGenerateProgress(job.progress);
      setNotice("文案生成已在后台开始，可以切换到其他模块。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成失败，请检查模型配置、代理或输入内容后重试。");
    }
  }

  async function handleOpenAssets() {
    if (!lastContent || !lastDraftBase) return;
    setBusy("assets");
    setNotice("");
    try {
      let draftId = lastDraftId;
      if (!draftId || lastSavedContent !== lastContent) {
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
        const draft = await saveDraft(payload);
        draftId = draft.id;
        setLastDraftId(draft.id);
        setLastSavedContent(lastContent);
        await refresh();
      }
      router.push(`/assets?draftId=${encodeURIComponent(draftId)}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "打开评论生成失败，请先保存当前草稿后重试。");
    } finally {
      setBusy("");
    }
  }

  async function copyLast() {
    if (!lastContent) return;
    await navigator.clipboard.writeText(lastContent);
    setNotice("生成结果已复制到剪贴板。");
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
      setNotice("已发布到飞书文档，可以在弹窗中打开。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "发布飞书文档失败，请检查 lark-cli 登录状态和文件夹配置。");
    } finally {
      setBusy("");
    }
  }

  if (!loading && !library?.accounts.length && !library?.projects.length) {
    return (
      <div className="page writer-page">
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
    <div className="page writer-page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Writer</p>
          <h1>对话写作</h1>
          <p className="subtle">选择引用风格，填写主题或原文，生成后会自动进入草稿箱，也可发布飞书或继续生成评论。</p>
        </div>
        <div className="stat-row">
          <span className="stat-pill">{library?.accounts.length || 0} 个账号</span>
          <span className="stat-pill">{library?.projects.length || 0} 个项目</span>
        </div>
      </header>

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
              <span className="stat-pill">正在读取引用</span>
            ) : targetType === "project" ? (
              <select
                aria-label="选择参考项目"
                className="writer-ref-select"
                name="projectId"
                value={selectedProject?.id || ""}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {library?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                aria-label="选择参考账号"
                className="writer-ref-select"
                name="accountId"
                value={selectedAccount?.id || ""}
                onChange={(event) => setAccountId(event.target.value)}
              >
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
                autoComplete="off"
                className="writer-textarea main"
                name="prompt"
                placeholder={mode === "topic" ? "主题、目标人群、核心观点…" : DEFAULT_REWRITE_PROMPT}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              {mode === "rewrite" ? (
                <>
                  <textarea
                    aria-label="需要改写的原文"
                    autoComplete="off"
                    className="writer-textarea source"
                    name="sourceText"
                    placeholder="粘贴原文、抖音分享链接；多条素材中间空一行…"
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                  />
                  {sourceText.trim() ? (
                    <div className="source-detect-row" aria-live="polite">
                      <span className="status-pill done">{sourceExtraction.materials.length || 1} 条素材</span>
                      {sourceExtraction.linkCount ? <span className="status-pill pending">{sourceExtraction.linkCount} 个链接待转写</span> : null}
                      {!sourceExtraction.linkCount && sourceExtraction.textMaterialCount ? <span className="status-pill">{sourceExtraction.textMaterialCount} 条文案</span> : null}
                      {sourceExtraction.onlyLinkCount ? <span className="status-pill pending">{sourceExtraction.onlyLinkCount} 条仅链接</span> : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="writer-actionbar">
                <button
                  className={`btn icon-toggle ${useWebResearch ? "active" : ""}`}
                  onClick={() => setUseWebResearch((enabled) => !enabled)}
                  type="button"
                  aria-pressed={useWebResearch}
                  title="联网检索"
                >
                  <Globe2 aria-hidden="true" size={16} />
                  {useWebResearch ? "联网检索开" : "联网检索关"}
                </button>
                <button
                  className="btn primary"
                  disabled={!canGenerate}
                  onClick={handleGenerate}
                  title={canGenerate ? "按当前引用风格生成文案" : mode === "rewrite" ? "填写改写要求或粘贴原文素材后可生成" : "填写写作主题后可生成"}
                  type="button"
                >
                  <Send aria-hidden="true" size={16} />
                  {busy === "generate" ? "正在生成" : "生成文案"}
                </button>
              </div>
            </div>

            <div className="writer-result">
              <div className="section-title-row">
                <h2>生成结果</h2>
                {lastContent ? (
                  <div className="button-row">
                    <button className="btn" onClick={copyLast} type="button">
                      <Copy aria-hidden="true" size={16} />
                      复制
                    </button>
                    <button className="btn" disabled={busy === "feishu"} onClick={handlePublishFeishu} type="button">
                      <FileUp aria-hidden="true" size={16} />
                      {busy === "feishu" ? "发布中…" : "飞书文档"}
                    </button>
                    <button className="btn" disabled={!lastDraftBase || busy === "assets"} onClick={handleOpenAssets} type="button">
                      <MessageSquarePlus size={16} />
                      {busy === "assets" ? "正在准备" : "生成评论"}
                    </button>
                    <button className="btn" disabled={!canGenerate} onClick={handleGenerate} type="button">
                      <RotateCcw aria-hidden="true" size={16} />
                      重写
                    </button>
                  </div>
                ) : (
                  <span className="status-pill pending" data-busy={busy === "generate" ? "true" : undefined}>{busy === "generate" ? "正在生成" : "等待输入"}</span>
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
                {busy === "generate" && !lastContent ? "正在等待首段内容，通常几秒内会开始输出。" : lastContent || "生成后会在这里显示成稿。"}
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
                <Eye aria-hidden="true" size={16} />
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
                <ExternalLink aria-hidden="true" size={16} />
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
    <div className="page writer-page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Writer</p>
          <h1>对话写作</h1>
          <p className="subtle">正在读取写作台引用和草稿状态。</p>
        </div>
      </header>
      <section className="panel">
        <div className="panel-inner">
          <p className="subtle">正在准备写作台…</p>
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

function draftToSaveBase(draft: Draft): DraftSaveBase {
  if (draft.targetType === "project") {
    return {
      targetType: "project",
      projectId: draft.projectId,
      projectName: draft.projectName,
      title: draft.title,
      mode: draft.mode,
      prompt: draft.prompt,
      input: draft.input,
      styleRef: draft.styleRef
    };
  }

  return {
    platform: draft.platform,
    accountId: draft.accountId,
    accountName: draft.accountName,
    title: draft.title,
    mode: draft.mode,
    prompt: draft.prompt,
    input: draft.input,
    styleRef: draft.styleRef
  };
}

function isBackgroundStartMessage(message: string) {
  return message.includes("已在后台开始");
}
