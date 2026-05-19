"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, FileUp, Globe2, MessageSquarePlus, RotateCcw, Send } from "lucide-react";
import { FeishuResultModal } from "./_components/FeishuResultModal";
import { WriterStyleModal } from "./_components/WriterStyleModal";
import { WriterStylePanel } from "./_components/WriterStylePanel";
import { useFeishuPublish } from "./_hooks/useFeishuPublish";
import { useWriterGeneration } from "./_hooks/useWriterGeneration";
import { useWriterReferenceDetails } from "./_hooks/useWriterReferenceDetails";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { useTasks } from "@/components/TaskProvider";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import { getDrafts } from "@/lib/client";
import { DEFAULT_REWRITE_PROMPT, extractRewriteSourceMaterial, normalizeRewritePrompt } from "@/lib/source-extraction";
import type { Draft } from "@/lib/types";

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
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [rewriteSourceDraft, setRewriteSourceDraft] = useState<Draft | null>(null);

  const selectedAccount = useMemo(() => {
    const first = library?.accounts[0];
    return library?.accounts.find((account) => account.id === accountId) || first || null;
  }, [library?.accounts, accountId]);

  const selectedProject = useMemo(() => {
    const first = library?.projects[0];
    return library?.projects.find((project) => project.id === projectId) || first || null;
  }, [library?.projects, projectId]);

  const { activeStyle, activeSubtitle, activeTitle } = useWriterReferenceDetails({
    selectedAccount,
    selectedProject,
    setNotice,
    targetType
  });
  const sourceExtraction = useMemo(() => extractRewriteSourceMaterial(sourceText), [sourceText]);
  const normalizedPrompt = useMemo(() => normalizeRewritePrompt(mode, prompt, sourceText), [mode, prompt, sourceText]);
  const normalizedSourceText = sourceText;
  const hasRewriteSource = Boolean(normalizedSourceText.trim());
  const hasTaskInput = mode === "topic" ? Boolean(normalizedPrompt.trim()) : Boolean(normalizedPrompt.trim() || hasRewriteSource);
  const noticeIsError = notice.includes("失败") || notice.includes("未配置");

  const {
    canGenerate,
    copyLast,
    generateProgress,
    generateStage,
    handleGenerate,
    handleOpenAssets,
    lastContent,
    lastDraftBase,
    lastResearch
  } = useWriterGeneration({
    activeJobs,
    activeTitle,
    busy,
    hasTaskInput,
    mode,
    normalizedPrompt,
    normalizedSourceText,
    recentJobs,
    refresh,
    routerPush: router.push,
    selectedAccount,
    selectedProject,
    setBusy,
    setNotice,
    startTask,
    targetType,
    useWebResearch
  });

  const { feishuResult, handlePublishFeishu, setFeishuResult } = useFeishuPublish({
    activeTitle,
    lastContent,
    setBusy,
    setNotice
  });

  useEffect(() => {
    if (!notice || isTaskProgressMessage(notice)) return;
    notify({ tone: noticeIsError ? "error" : "success", message: notice });
  }, [notice, noticeIsError, notify]);

  useEffect(() => {
    let ignore = false;
    const draftId = searchParams.get("draftId");
    if (!draftId || loading) {
      setRewriteSourceDraft(null);
      return;
    }

    const overviewDraft = library?.drafts.find((draft) => draft.id === draftId);
    if (overviewDraft?.content) {
      setRewriteSourceDraft(overviewDraft);
      return;
    }

    getDrafts()
      .then((result) => {
        if (ignore) return;
        setRewriteSourceDraft(result.drafts.find((draft) => draft.id === draftId) || null);
      })
      .catch((err) => {
        if (!ignore) setNotice(err instanceof Error ? err.message : "读取草稿失败");
      });

    return () => {
      ignore = true;
    };
  }, [library?.drafts, loading, searchParams]);

  useEffect(() => {
    const target = searchParams.get("targetType");
    const nextMode = searchParams.get("mode");
    const nextPrompt = searchParams.get("prompt");
    const nextSourceText = searchParams.get("sourceText");
    const nextAccountId = searchParams.get("accountId");
    const nextProjectId = searchParams.get("projectId");
    const draftId = searchParams.get("draftId");
    const sourceDraft = draftId
      ? rewriteSourceDraft?.id === draftId
        ? rewriteSourceDraft
        : library?.drafts.find((draft) => draft.id === draftId)
      : null;

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
  }, [library?.drafts, rewriteSourceDraft, searchParams]);

  if (!loading && !library?.accounts.length && !library?.projects.length) {
    return (
      <div className="page writer-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Writer</p>
            <h1 className="title-with-emoji">
              <span aria-hidden="true" className="title-emoji">
                ✍️
              </span>
              <span>对话写作</span>
            </h1>
            <p className="subtle">需要至少一个账号或项目风格作为引用。</p>
          </div>
        </header>
        <EmptyState title="还没有可参考的风格" body="先采集一个账号，或在账号库里创建项目风格卡，再来这里生成文案。" action={{ href: "/", label: "去采集账号" }} />
      </div>
    );
  }

  return (
    <div className="page writer-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Writer</p>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              ✍️
            </span>
            <span>对话写作</span>
          </h1>
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
                  <div>
                    <pre className="result-box" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                      {lastResearch}
                    </pre>
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </section>

        <WriterStylePanel
          activeStyle={activeStyle}
          activeTitle={activeTitle}
          selectedAccount={selectedAccount}
          selectedProject={selectedProject}
          targetType={targetType}
          onOpenStyle={() => setStyleOpen(true)}
        />
      </section>

      {styleOpen ? (
        <WriterStyleModal activeStyle={activeStyle} activeTitle={activeTitle} onClose={() => setStyleOpen(false)} />
      ) : null}

      {feishuResult ? (
        <FeishuResultModal result={feishuResult} onClose={() => setFeishuResult(null)} />
      ) : null}
    </div>
  );
}

function WriterFallback() {
  return (
    <div className="page writer-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Writer</p>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              ✍️
            </span>
            <span>对话写作</span>
          </h1>
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
