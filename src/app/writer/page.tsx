"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleStop, Copy, Eye, FileText, FileUp, Globe2, ListChecks, MessageSquarePlus, PenLine, Save, Send } from "lucide-react";
import { FeishuResultModal } from "./_components/FeishuResultModal";
import { WriterHistoryPanel } from "./_components/WriterHistoryPanel";
import { WriterStyleModal } from "./_components/WriterStyleModal";
import { useFeishuPublish } from "./_hooks/useFeishuPublish";
import { useWriterGeneration } from "./_hooks/useWriterGeneration";
import { useWriterReferenceDetails } from "./_hooks/useWriterReferenceDetails";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { useScopedTasks } from "@/components/TaskProvider";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import { deleteDrafts, getCachedDrafts, getDrafts, prepareWriteBrief, renameDraft } from "@/lib/client";
import { buildWriterDraftHref } from "@/lib/draft-links";
import { DEFAULT_REWRITE_PROMPT, extractRewriteSourceMaterial, normalizeRewritePrompt } from "@/lib/source-extraction";
import type { Draft, WriteResult, WriteRevisionScope } from "@/lib/types";

const BRIEF_PROGRESS_INITIAL = 8;
const BRIEF_PROGRESS_CAP = 92;
const BRIEF_PROGRESS_ESTIMATE_MS = 120_000;
const BRIEF_PROGRESS_TICK_MS = 1_000;

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
  const { activeJobs, cancelTask, recentJobs, startTask } = useScopedTasks({
    href: "/writer",
    kinds: ["write-copy"]
  });
  const { notify } = useFeedback();
  const [targetType, setTargetType] = useState<"account" | "project">("account");
  const [accountId, setAccountId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [supportDocLinks, setSupportDocLinks] = useState("");
  const [useWebResearch, setUseWebResearch] = useState(false);
  const [brief, setBrief] = useState("");
  const [briefResearch, setBriefResearch] = useState("");
  const [briefContextFingerprint, setBriefContextFingerprint] = useState("");
  const [briefSignature, setBriefSignature] = useState("");
  const [briefMeta, setBriefMeta] = useState<{
    usedModel: string;
    fallback: boolean;
    fallbackReason?: string;
  } | null>(null);
  const [briefProgress, setBriefProgress] = useState(0);
  const [briefStage, setBriefStage] = useState("");
  const [briefStartedAt, setBriefStartedAt] = useState<number | null>(null);
  const [preparedSourceText, setPreparedSourceText] = useState("");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [revisionScope, setRevisionScope] = useState<WriteRevisionScope>("full");
  const [selectedDraftText, setSelectedDraftText] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [fullDrafts, setFullDrafts] = useState<Draft[] | null>(() => getCachedDrafts()?.drafts ?? null);
  const loadedDraftParamRef = useRef("");
  const appliedSearchParamRef = useRef("");

  const selectedAccount = useMemo(() => {
    const first = library?.accounts[0];
    return library?.accounts.find((account) => account.id === accountId) || first || null;
  }, [library?.accounts, accountId]);

  const selectedProject = useMemo(() => {
    const first = library?.projects[0];
    return library?.projects.find((project) => project.id === projectId) || first || null;
  }, [library?.projects, projectId]);

  const allDrafts = useMemo(() => fullDrafts || [], [fullDrafts]);
  const historyLoading = loading || fullDrafts === null;
  const historyDrafts = useMemo(() => [...allDrafts].sort(compareCreatedAtDesc), [allDrafts]);

  const handleDraftSaved = useCallback(
    (draft: Draft) => {
      setFullDrafts((current) => mergeDraftLists(current || [], [draft]));
    },
    []
  );

  const { activeStyle, activeStyleLoading, activeTitle } = useWriterReferenceDetails({
    selectedAccount,
    selectedProject,
    setNotice,
    targetType
  });
  const sourceExtraction = useMemo(() => extractRewriteSourceMaterial(sourceText), [sourceText]);
  const normalizedSourceText = sourceText;
  const hasRewriteSource = Boolean(normalizedSourceText.trim());
  const effectiveMode: Draft["mode"] = hasRewriteSource ? "rewrite" : "topic";
  const normalizedPrompt = useMemo(() => normalizeRewritePrompt(effectiveMode, prompt, sourceText), [effectiveMode, prompt, sourceText]);
  const hasTaskInput = Boolean(normalizedPrompt.trim() || hasRewriteSource);
  const activeReference = targetType === "project" ? selectedProject : selectedAccount;
  const writerInputSignature = useMemo(
    () =>
      makeWriterInputSignature({
        targetType,
        referenceId: activeReference?.id || "",
        mode: effectiveMode,
        prompt: normalizedPrompt,
        sourceText: normalizedSourceText,
        supportDocLinks,
        useWebResearch
      }),
    [activeReference?.id, effectiveMode, normalizedPrompt, normalizedSourceText, supportDocLinks, targetType, useWebResearch]
  );
  const briefReady = Boolean(brief.trim()) && briefSignature === writerInputSignature;
  const briefStale = Boolean(brief.trim()) && briefSignature !== writerInputSignature;
  const canPrepareBrief = Boolean(hasTaskInput && activeReference && !busy);
  const noticeIsError = notice.includes("失败") || notice.includes("未配置");

  const handleGenerationResult = useCallback(
    (result: WriteResult) => {
      if (result.brief) setBrief(result.brief);
      setBriefResearch(result.research || "");
      setBriefContextFingerprint(result.contextFingerprint || result.draft?.version?.contextFingerprint || "");
      if (result.sourceDigest?.resolvedSourceText) {
        setPreparedSourceText(result.sourceDigest.resolvedSourceText);
      }
      if (result.brief || result.sourceDigest) {
        setBriefSignature(writerInputSignature);
        setBriefMeta({
          usedModel: result.usedModel,
          fallback: result.fallback,
          fallbackReason: result.fallbackReason
        });
      }
    },
    [writerInputSignature]
  );

  const handlePrepareBrief = useCallback(async () => {
    if (!canPrepareBrief) return;
    setBriefStartedAt(Date.now());
    setBriefProgress(BRIEF_PROGRESS_INITIAL);
    setBriefStage("整理上下文");
    setBusy("brief");
    setNotice("");
    try {
      const result = await prepareWriteBrief({
        targetType,
        platform: targetType === "account" ? selectedAccount?.platform : undefined,
        accountId: targetType === "account" ? selectedAccount?.id : undefined,
        projectId: targetType === "project" ? selectedProject?.id : undefined,
        mode: effectiveMode,
        prompt: normalizedPrompt,
        sourceText: normalizedSourceText,
        supportDocLinks: supportDocLinks.trim() || undefined,
        useWebResearch
      });
      setBrief(result.brief);
      setBriefResearch(result.research || "");
      setBriefContextFingerprint(result.contextFingerprint);
      setPreparedSourceText(result.sourceDigest.resolvedSourceText || normalizedSourceText);
      setBriefSignature(writerInputSignature);
      setBriefMeta({
        usedModel: result.usedModel,
        fallback: result.fallback,
        fallbackReason: result.fallbackReason
      });
      setNotice(result.fallback ? result.fallbackReason || "已用本地结构准备 brief。" : "写作 brief 已准备。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "准备写作 brief 失败");
    } finally {
      setBusy("");
      setBriefStartedAt(null);
    }
  }, [
    canPrepareBrief,
    effectiveMode,
    normalizedPrompt,
    normalizedSourceText,
    selectedAccount?.id,
    selectedAccount?.platform,
    selectedProject?.id,
    setNotice,
    supportDocLinks,
    targetType,
    useWebResearch,
    writerInputSignature
  ]);

  useEffect(() => {
    if (busy !== "brief" || !briefStartedAt) {
      if (busy !== "brief") {
        setBriefProgress(0);
        setBriefStage("");
      }
      return;
    }

    const updateBriefProgress = () => {
      const elapsedMs = Date.now() - briefStartedAt;
      const nextProgress = Math.min(
        BRIEF_PROGRESS_CAP,
        BRIEF_PROGRESS_INITIAL + Math.round((elapsedMs / BRIEF_PROGRESS_ESTIMATE_MS) * (BRIEF_PROGRESS_CAP - BRIEF_PROGRESS_INITIAL))
      );
      setBriefProgress(nextProgress);
      setBriefStage(getBriefProgressStage(elapsedMs, useWebResearch));
    };

    updateBriefProgress();
    const timer = window.setInterval(updateBriefProgress, BRIEF_PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [briefStartedAt, busy, useWebResearch]);

  const handleRevisionCompleted = useCallback(() => {
    setRevisionInstruction("");
    setRevisionScope("full");
    setSelectedDraftText("");
  }, []);

  const {
    canGenerate,
    canRevise,
    canStopGenerate,
    clearDraftResult,
    copyLast,
    generateProgress,
    generateStage,
    handleContentChange,
    handleGenerate,
    handleOpenAssets,
    handleRevise,
    handleSaveEdit,
    handleStopGenerate,
    hasUnsavedChanges,
    lastContent,
    lastDraftBase,
    lastDraftId,
    lastDraftVersion,
    lastResearch,
    loadDraftResult
  } = useWriterGeneration({
    activeJobs,
    activeTitle,
    cancelTask,
    busy,
    hasTaskInput,
    brief: briefReady ? brief : "",
    briefContextFingerprint: briefReady ? briefContextFingerprint : "",
    briefResearch: briefReady ? briefResearch : "",
    mode: effectiveMode,
    normalizedPrompt,
    normalizedSourceText,
    preparedSourceText: briefReady ? preparedSourceText : "",
    supportDocLinks,
    recentJobs,
    revisionInstruction,
    revisionScope,
    selectedText: selectedDraftText,
    onGenerationResult: handleGenerationResult,
    onDraftSaved: handleDraftSaved,
    onRevisionCompleted: handleRevisionCompleted,
    refresh,
    routerPush: router.push,
    routerReplace: router.replace,
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
  const displayResearch = lastResearch || briefResearch;
  const materialStatusLabel = sourceExtraction.materials.length
    ? `${sourceExtraction.materials.length} 条素材`
    : normalizedPrompt.trim()
      ? "自由输入"
      : "待素材";
  const briefStatusLabel = busy === "brief" ? "准备中" : briefReady ? "已确认" : briefStale ? "需更新" : "可选";
  const briefMetaLabel = briefMeta
    ? briefMeta.fallback
      ? briefMeta.fallbackReason || "本地结构"
      : briefMeta.usedModel === "历史记录"
        ? "来自历史记录"
        : `已调用 ${briefMeta.usedModel}`
    : "";

  useEffect(() => {
    if (!notice || isTaskProgressMessage(notice)) return;
    notify({ tone: noticeIsError ? "error" : "success", message: notice });
  }, [notice, noticeIsError, notify]);

  useEffect(() => {
    let ignore = false;
    if (loading || fullDrafts !== null) return;

    getDrafts()
      .then((result) => {
        if (ignore) return;
        setFullDrafts((current) => mergeDraftLists(current || [], result.drafts));
      })
      .catch((err) => {
        if (!ignore) setNotice(err instanceof Error ? err.message : "读取历史记录失败");
      });

    return () => {
      ignore = true;
    };
  }, [fullDrafts, loading]);

  useEffect(() => {
    const searchKey = searchParams.toString();
    const target = searchParams.get("targetType");
    const nextMode = searchParams.get("mode");
    const nextPrompt = searchParams.get("prompt");
    const nextSourceText = searchParams.get("sourceText");
    const nextAccountId = searchParams.get("accountId");
    const nextProjectId = searchParams.get("projectId");
    const draftId = searchParams.get("draftId");
    const sourceDraft = draftId ? allDrafts.find((draft) => draft.id === draftId) : null;

    if (sourceDraft) {
      if (loadedDraftParamRef.current === sourceDraft.id) return;
      loadedDraftParamRef.current = sourceDraft.id;
      setTargetType(sourceDraft.targetType === "project" ? "project" : "account");
      if (sourceDraft.targetType === "project") {
        setProjectId(sourceDraft.projectId);
      } else {
        setAccountId(sourceDraft.accountId);
      }
      setPrompt(sourceDraft.prompt);
      setSourceText(sourceDraft.input || "");
      setSupportDocLinks(sourceDraft.supportDocLinks || "");
      setUseWebResearch(Boolean(sourceDraft.sourceDigest?.webResearchEnabled));
      setBrief(sourceDraft.brief || "");
      setBriefResearch(sourceDraft.research || "");
      setBriefContextFingerprint(sourceDraft.version?.contextFingerprint || "");
      setPreparedSourceText(sourceDraft.sourceDigest?.resolvedSourceText || sourceDraft.input || "");
      setBriefSignature(sourceDraft.brief ? makeDraftWriterInputSignature(sourceDraft) : "");
      setBriefMeta(sourceDraft.brief ? { usedModel: "历史记录", fallback: false } : null);
      setRevisionInstruction("");
      setRevisionScope("full");
      setSelectedDraftText("");
      loadDraftResult(sourceDraft);
      return;
    }

    if (draftId && historyLoading) return;
    if (!draftId) loadedDraftParamRef.current = "";
    if (appliedSearchParamRef.current === searchKey) return;

    const hasUrlState =
      Boolean(target || nextMode || nextAccountId || nextProjectId) ||
      nextPrompt !== null ||
      nextSourceText !== null;
    if (!hasUrlState) {
      appliedSearchParamRef.current = searchKey;
      return;
    }

    const nextTargetType = target === "project" ? "project" : target === "account" ? "account" : undefined;

    if (nextTargetType) setTargetType(nextTargetType);
    if (nextAccountId) setAccountId(nextAccountId);
    if (nextProjectId) setProjectId(nextProjectId);
    if (nextPrompt !== null) setPrompt(nextPrompt);
    if (nextSourceText !== null) setSourceText(nextSourceText);
    setUseWebResearch(false);
    setBrief("");
    setBriefResearch("");
    setBriefContextFingerprint("");
    setPreparedSourceText("");
    setBriefSignature("");
    setBriefMeta(null);
    setRevisionInstruction("");
    setRevisionScope("full");
    setSelectedDraftText("");
    appliedSearchParamRef.current = searchKey;
  }, [allDrafts, historyLoading, loadDraftResult, searchParams]);

  const handleSelectHistoryDraft = useCallback(
    (draft: Draft) => {
      loadedDraftParamRef.current = draft.id;
      setTargetType(draft.targetType === "project" ? "project" : "account");
      if (draft.targetType === "project") {
        setProjectId(draft.projectId);
      } else {
        setAccountId(draft.accountId);
      }
      setPrompt(draft.prompt);
      setSourceText(draft.input || "");
      setSupportDocLinks(draft.supportDocLinks || "");
      setUseWebResearch(Boolean(draft.sourceDigest?.webResearchEnabled));
      setBrief(draft.brief || "");
      setBriefResearch(draft.research || "");
      setBriefContextFingerprint(draft.version?.contextFingerprint || "");
      setPreparedSourceText(draft.sourceDigest?.resolvedSourceText || draft.input || "");
      setBriefSignature(draft.brief ? makeDraftWriterInputSignature(draft) : "");
      setBriefMeta(draft.brief ? { usedModel: "历史记录", fallback: false } : null);
      setRevisionInstruction("");
      setRevisionScope("full");
      setSelectedDraftText("");
      loadDraftResult(draft);
      router.replace(buildWriterDraftHref(draft), { scroll: false });
    },
    [loadDraftResult, router]
  );

  const handleDeleteHistoryDraft = useCallback(
    async (draft: Draft) => {
      const replacement = findReplacementDraft(historyDrafts, new Set([draft.id]), draft);

      try {
        await deleteDrafts([draft.id]);
        setFullDrafts((current) => (current || []).filter((item) => item.id !== draft.id));

        if (draft.id === lastDraftId) {
          if (replacement) {
            handleSelectHistoryDraft(replacement);
          } else {
            loadedDraftParamRef.current = "";
            clearDraftResult();
            setPrompt("");
            setSourceText("");
            setSupportDocLinks("");
            setUseWebResearch(false);
            setBrief("");
            setBriefResearch("");
            setBriefContextFingerprint("");
            setPreparedSourceText("");
            setBriefSignature("");
            setBriefMeta(null);
            setRevisionInstruction("");
            setRevisionScope("full");
            setSelectedDraftText("");
            const params = new URLSearchParams({
              targetType,
              mode: effectiveMode
            });
            if (targetType === "project") {
              const nextProjectId = selectedProject?.id || projectId;
              if (nextProjectId) params.set("projectId", nextProjectId);
            } else {
              const nextAccountId = selectedAccount?.id || accountId;
              if (nextAccountId) params.set("accountId", nextAccountId);
            }
            router.replace(`/writer?${params.toString()}`, { scroll: false });
          }
        }

        notify({ tone: "success", message: "草稿已删除。" });
        void refresh().catch(() => undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "删除草稿失败";
        notify({ tone: "error", message });
        throw error;
      }
    },
    [
      accountId,
      clearDraftResult,
      handleSelectHistoryDraft,
      historyDrafts,
      effectiveMode,
      lastDraftId,
      notify,
      projectId,
      refresh,
      router,
      selectedAccount?.id,
      selectedProject?.id,
      targetType
    ]
  );

  const handleDeleteHistoryDrafts = useCallback(
    async (draftsToDelete: Draft[]) => {
      const draftIds = draftsToDelete.map((draft) => draft.id);
      const deletedIds = new Set(draftIds);
      const currentDraft = historyDrafts.find((draft) => draft.id === lastDraftId);
      const replacement = findReplacementDraft(historyDrafts, deletedIds, currentDraft);

      try {
        await deleteDrafts(draftIds);
        setFullDrafts((current) => (current || []).filter((item) => !deletedIds.has(item.id)));

        if (lastDraftId && deletedIds.has(lastDraftId)) {
          if (replacement) {
            handleSelectHistoryDraft(replacement);
          } else {
            loadedDraftParamRef.current = "";
            clearDraftResult();
            setPrompt("");
            setSourceText("");
            setSupportDocLinks("");
            setUseWebResearch(false);
            setBrief("");
            setBriefResearch("");
            setBriefContextFingerprint("");
            setPreparedSourceText("");
            setBriefSignature("");
            setBriefMeta(null);
            setRevisionInstruction("");
            setRevisionScope("full");
            setSelectedDraftText("");
            const params = new URLSearchParams({
              targetType,
              mode: effectiveMode
            });
            if (targetType === "project") {
              const nextProjectId = selectedProject?.id || projectId;
              if (nextProjectId) params.set("projectId", nextProjectId);
            } else {
              const nextAccountId = selectedAccount?.id || accountId;
              if (nextAccountId) params.set("accountId", nextAccountId);
            }
            router.replace(`/writer?${params.toString()}`, { scroll: false });
          }
        }

        notify({ tone: "success", message: `已删除 ${draftIds.length} 条草稿。` });
        void refresh().catch(() => undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "批量删除草稿失败";
        notify({ tone: "error", message });
        throw error;
      }
    },
    [
      accountId,
      clearDraftResult,
      handleSelectHistoryDraft,
      historyDrafts,
      effectiveMode,
      lastDraftId,
      notify,
      projectId,
      refresh,
      router,
      selectedAccount?.id,
      selectedProject?.id,
      targetType
    ]
  );

  const handleRenameHistoryDraft = useCallback(
    async (draft: Draft, title: string) => {
      try {
        const updatedDraft = await renameDraft({ draftId: draft.id, title });
        setFullDrafts((current) => mergeDraftLists(current || [], [updatedDraft]));
        notify({ tone: "success", message: "草稿名称已更新。" });
        void refresh().catch(() => undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "更新草稿名称失败";
        notify({ tone: "error", message });
        throw error;
      }
    },
    [notify, refresh]
  );

  if (!loading && !library?.accounts.length && !library?.projects.length) {
    return (
      <div className="page writer-page">
        <header className="page-header">
          <div className="page-title-group">
            <span className="page-title-eyebrow">创作台</span>
            <div className="page-title-row">
              <span className="page-title-mark" aria-hidden="true">
                <PenLine size={20} strokeWidth={2.1} />
              </span>
              <div className="page-title-copy">
                <h1>对话写作</h1>
                <p className="subtle">需要至少一个账号或项目风格作为引用。</p>
              </div>
            </div>
          </div>
        </header>
        <EmptyState title="还没有可参考的风格" body="先采集一个账号，或在账号库里创建项目风格卡，再来这里生成文案。" action={{ href: "/library", label: "去采集账号" }} />
      </div>
    );
  }

  return (
    <div className="page writer-page">
      <header className="page-header">
        <div className="page-title-group">
          <span className="page-title-eyebrow">写作</span>
          <div className="page-title-row">
            <span className="page-title-mark" aria-hidden="true">
              <PenLine size={20} strokeWidth={2.1} />
            </span>
            <div className="page-title-copy">
              <h1>对话写作</h1>
              <p className="subtle">选风格，写需求，生成。</p>
            </div>
          </div>
        </div>
        <div className="page-header-meta">
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

            <div className="writer-ref-meta" aria-label="当前写作上下文">
              <span>
                <FileText aria-hidden="true" size={14} />
                {activeTitle || "未选择引用"}
              </span>
              <span>{activeStyleLoading ? "读取风格卡" : activeStyle?.trim().length ? `${activeStyle.trim().length} 字风格卡` : "无风格卡"}</span>
              <span>
                {targetType === "project" && selectedProject
                  ? `${selectedProject.sourceMaterialCount} 份案例 · ${selectedProject.sourceAccounts.length} 个账号`
                  : selectedAccount
                    ? `${selectedAccount.transcriptCount} 份转写 · ${selectedAccount.videoCount} 条视频`
                    : "待选择"}
              </span>
            </div>

            <button className="btn ghost writer-style-trigger" disabled={activeStyleLoading || !activeStyle} onClick={() => setStyleOpen(true)} type="button">
              <Eye aria-hidden="true" size={16} />
              风格卡
            </button>
          </div>

          <div className="writer-content-grid">
            <div className="writer-task">
              <div className="section-title-row">
                <h2>需求</h2>
                <span className={`status-pill ${hasTaskInput ? "done" : "pending"}`}>{materialStatusLabel}</span>
              </div>

              <label className="writer-field">
                <span>素材 / 原文</span>
                  <textarea
                    aria-label="素材、原文或链接"
                    autoComplete="off"
                    className="writer-textarea source"
                    name="sourceText"
                    placeholder="粘贴原文、抖音分享链接；多条素材中间空一行。"
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                  />
              </label>
              {sourceText.trim() ? (
                <div className="source-detect-row" aria-live="polite">
                  <span className="status-pill done">{sourceExtraction.materials.length || 1} 条素材</span>
                  {sourceExtraction.linkCount ? <span className="status-pill pending">{sourceExtraction.linkCount} 个链接待转写</span> : null}
                  {!sourceExtraction.linkCount && sourceExtraction.textMaterialCount ? <span className="status-pill">{sourceExtraction.textMaterialCount} 条文案</span> : null}
                  {sourceExtraction.onlyLinkCount ? <span className="status-pill pending">{sourceExtraction.onlyLinkCount} 条仅链接</span> : null}
                </div>
              ) : null}

              <label className="writer-field">
                <span>写作要求</span>
                <textarea
                  aria-label="写作要求"
                  autoComplete="off"
                  className="writer-textarea main"
                  name="prompt"
                  placeholder={DEFAULT_REWRITE_PROMPT}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>

              <label className="writer-field support-doc-field">
                <span>支持文档</span>
                <textarea
                  aria-label="商单支持文档链接"
                  autoComplete="off"
                  className="writer-textarea support-doc"
                  name="supportDocLinks"
                  placeholder="粘贴飞书文档、腾讯文档或品牌资料链接；多条可换行…"
                  value={supportDocLinks}
                  onChange={(event) => setSupportDocLinks(event.target.value)}
                />
              </label>

              <div className={`writer-brief-panel ${briefReady ? "ready" : ""} ${briefStale ? "stale" : ""}`}>
                <div className="writer-brief-head">
                  <span>
                    <ListChecks aria-hidden="true" size={14} />
                    写作 Brief
                  </span>
                  <span className={`status-pill ${briefReady ? "done" : briefStale ? "pending" : ""}`}>
                    {briefStatusLabel}
                  </span>
                </div>
                <textarea
                  aria-label="写作 brief"
                  autoComplete="off"
                  className="writer-textarea brief"
                  name="brief"
                  placeholder="先准备 brief，再生成成稿…"
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                />
                {busy === "brief" ? (
                  <div className="writer-brief-progress" role="status" aria-live="polite">
                    <div className="writer-brief-progress-copy">
                      <span>{briefStage || "等待模型"}</span>
                      <strong>{briefProgress}%</strong>
                    </div>
                    <div className="progress-track" aria-hidden="true">
                      <div className="progress-fill" style={{ transform: `scaleX(${briefProgress / 100})` }} />
                    </div>
                  </div>
                ) : null}
                {briefMetaLabel ? <p className="writer-brief-meta">{briefMetaLabel}</p> : null}
              </div>

              <div className="writer-actionbar">
                <button
                  className={`btn icon-toggle ${useWebResearch ? "active" : ""}`}
                  onClick={() => setUseWebResearch((enabled) => !enabled)}
                  type="button"
                  aria-pressed={useWebResearch}
                  title="联网检索"
                >
                  <Globe2 aria-hidden="true" size={16} />
                  {useWebResearch ? "联网开" : "联网关"}
                </button>
                <button
                  className="btn"
                  aria-busy={busy === "brief"}
                  disabled={!canPrepareBrief || busy === "brief"}
                  onClick={handlePrepareBrief}
                  type="button"
                >
                  <ListChecks aria-hidden="true" size={16} />
                  {busy === "brief" ? "准备中" : briefReady ? "更新 Brief" : "准备 Brief"}
                </button>
                <button
                  className="btn primary"
                  disabled={!canGenerate}
                  onClick={handleGenerate}
                  title={canGenerate ? "生成文案" : "先填写素材或写作要求"}
                  type="button"
                >
                  <Send aria-hidden="true" size={16} />
                  {busy === "generate" ? "生成中" : "生成文案"}
                </button>
                {canStopGenerate ? (
                  <button className="btn ghost" onClick={() => void handleStopGenerate()} type="button">
                    <CircleStop aria-hidden="true" size={16} />
                    停止
                  </button>
                ) : null}
              </div>
            </div>

            <div className="writer-result">
              <div className="section-title-row">
                <div className="writer-result-title">
                  <h2>当前稿件</h2>
                  {lastDraftId ? <span className="status-pill done">V{lastDraftVersion?.revision || 1}</span> : null}
                  {hasUnsavedChanges ? <span className="status-pill pending">有未保存编辑</span> : null}
                </div>
                {lastContent ? (
                  <div className="button-row">
                    <button className="btn" onClick={copyLast} type="button">
                      <Copy aria-hidden="true" size={16} />
                      复制
                    </button>
                    <button
                      aria-busy={busy === "save-draft"}
                      className="btn"
                      disabled={!hasUnsavedChanges || Boolean(busy)}
                      onClick={() => void handleSaveEdit()}
                      type="button"
                    >
                      <Save aria-hidden="true" size={16} />
                      {busy === "save-draft" ? "保存中" : "保存版本"}
                    </button>
                    <button className="btn" disabled={Boolean(busy)} onClick={handlePublishFeishu} type="button">
                      <FileUp aria-hidden="true" size={16} />
                      {busy === "feishu" ? "发布中…" : "飞书"}
                    </button>
                    <button className="btn" disabled={!lastDraftBase || Boolean(busy)} onClick={handleOpenAssets} type="button">
                      <MessageSquarePlus size={16} />
                      {busy === "assets" ? "准备中" : "评论"}
                    </button>
                  </div>
                ) : (
                  <span className="status-pill pending" data-busy={busy === "generate" ? "true" : undefined}>{busy === "generate" ? "生成中" : "待输入"}</span>
                )}
              </div>
              {busy === "generate" ? (
                <div className="project-progress writer-generation-progress" role="status" aria-live="polite">
                  <div className="project-progress-copy">
                    <span>{generateStage || "正在生成"}</span>
                    <span className="button-row">
                      <strong>{generateProgress}%</strong>
                      {canStopGenerate ? (
                        <button className="btn small ghost" onClick={() => void handleStopGenerate()} type="button">
                          <CircleStop aria-hidden="true" size={14} />
                          停止
                        </button>
                      ) : null}
                    </span>
                  </div>
                  <div className="progress-track" aria-hidden="true">
                    <div className="progress-fill" style={{ transform: `scaleX(${generateProgress / 100})` }} />
                  </div>
                </div>
              ) : null}
              <textarea
                aria-label="当前稿件"
                className={`result-box writer-draft-editor ${lastContent ? "" : "empty"}`}
                onChange={(event) => {
                  handleContentChange(event.target.value);
                  setSelectedDraftText("");
                  if (revisionScope === "selection") setRevisionScope("full");
                }}
                onKeyUp={(event) => {
                  const field = event.currentTarget;
                  setSelectedDraftText(field.value.slice(field.selectionStart, field.selectionEnd));
                }}
                onMouseUp={(event) => {
                  const field = event.currentTarget;
                  setSelectedDraftText(field.value.slice(field.selectionStart, field.selectionEnd));
                }}
                placeholder={busy === "generate" ? "等待内容。" : "生成结果会出现在这里。"}
                readOnly={busy === "generate"}
                spellCheck={false}
                value={lastContent}
              />
              {lastContent ? (
                <section className="writer-revision-composer" aria-labelledby="writer-revision-title">
                  <div className="writer-revision-head">
                    <div>
                      <h3 id="writer-revision-title">继续修改</h3>
                      <p>{selectedDraftText ? `已选中 ${selectedDraftText.length} 字` : "基于当前版本生成下一版"}</p>
                    </div>
                    <div aria-label="修改范围" className="segmented writer-revision-scope" role="group">
                      <button
                        aria-pressed={revisionScope === "full"}
                        className={revisionScope === "full" ? "active" : ""}
                        onClick={() => setRevisionScope("full")}
                        type="button"
                      >
                        全文
                      </button>
                      <button
                        aria-pressed={revisionScope === "selection"}
                        className={revisionScope === "selection" ? "active" : ""}
                        disabled={!selectedDraftText}
                        onClick={() => setRevisionScope("selection")}
                        type="button"
                      >
                        选中段落
                      </button>
                    </div>
                  </div>
                  <label className="writer-field">
                    <span>本轮修改要求</span>
                    <textarea
                      aria-label="本轮修改要求"
                      className="writer-textarea revision"
                      disabled={busy === "generate"}
                      onChange={(event) => setRevisionInstruction(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canRevise) {
                          event.preventDefault();
                          void handleRevise();
                        }
                      }}
                      placeholder="例如：开头压到 80 字，产品参数和结尾互动保持不变。"
                      value={revisionInstruction}
                    />
                  </label>
                  <div className="writer-revision-actions">
                    <span>{revisionScope === "selection" ? "只调整选中内容，并返回完整新稿。" : "未点名部分会尽量保持不变。"}</span>
                    <button
                      aria-busy={busy === "generate"}
                      className="btn primary"
                      disabled={!canRevise}
                      onClick={() => void handleRevise()}
                      type="button"
                    >
                      <Send aria-hidden="true" size={16} />
                      {busy === "generate" ? "生成中" : `生成 V${(lastDraftVersion?.revision || 1) + 1}`}
                    </button>
                  </div>
                </section>
              ) : null}
              {displayResearch ? (
                <details className="style-reference">
                  <summary>
                    <span className="style-reference-heading">
                      <span className="style-reference-title">参考资料</span>
                      <small>研究摘要</small>
                    </span>
                  </summary>
                  <pre className="style-reference-body">{displayResearch}</pre>
                </details>
              ) : null}
            </div>
          </div>
        </section>

        <WriterHistoryPanel
          drafts={historyDrafts}
          loading={historyLoading}
          onDeleteDraft={handleDeleteHistoryDraft}
          onDeleteDrafts={handleDeleteHistoryDrafts}
          onRenameDraft={handleRenameHistoryDraft}
          selectedDraftId={lastDraftId}
          onSelectDraft={handleSelectHistoryDraft}
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

function mergeDraftLists(...groups: Draft[][]) {
  const byId = new Map<string, Draft>();

  for (const group of groups) {
    for (const draft of group) {
      const current = byId.get(draft.id);
      if (!current) {
        byId.set(draft.id, draft);
        continue;
      }
      if (current.content && !draft.content) continue;
      if (!current.content && draft.content) {
        byId.set(draft.id, draft);
        continue;
      }
      if (+new Date(draft.updatedAt) > +new Date(current.updatedAt)) {
        byId.set(draft.id, draft);
      }
    }
  }

  return [...byId.values()].sort(compareCreatedAtDesc);
}

function compareCreatedAtDesc(left: { createdAt: string }, right: { createdAt: string }) {
  return +new Date(right.createdAt) - +new Date(left.createdAt);
}

function findReplacementDraft(drafts: Draft[], deletedIds: Set<string>, currentDraft?: Draft) {
  const remaining = drafts.filter((draft) => !deletedIds.has(draft.id));
  if (!currentDraft) return remaining[0] || null;

  const sessionId = currentDraft.version?.sessionId || currentDraft.id;
  const currentRevision = currentDraft.version?.revision || 1;
  const sameSession = remaining
    .filter((draft) => (draft.version?.sessionId || draft.id) === sessionId)
    .sort((left, right) => {
      const leftDistance = Math.abs((left.version?.revision || 1) - currentRevision);
      const rightDistance = Math.abs((right.version?.revision || 1) - currentRevision);
      return leftDistance - rightDistance || compareCreatedAtDesc(left, right);
    });

  return sameSession[0] || remaining[0] || null;
}

function getBriefProgressStage(elapsedMs: number, useWebResearch: boolean) {
  if (elapsedMs < 3_000) return "整理上下文";
  if (useWebResearch && elapsedMs < 60_000) return "联网检索";
  if (elapsedMs < 105_000) return "等待模型";
  return "远端较慢";
}

function makeDraftWriterInputSignature(draft: Draft) {
  return makeWriterInputSignature({
    targetType: draft.targetType === "project" ? "project" : "account",
    referenceId: draft.targetType === "project" ? draft.projectId : draft.accountId,
    mode: draft.mode,
    prompt: draft.prompt,
    sourceText: draft.input || "",
    supportDocLinks: draft.supportDocLinks || "",
    useWebResearch: Boolean(draft.sourceDigest?.webResearchEnabled)
  });
}

function makeWriterInputSignature(input: {
  targetType: "account" | "project";
  referenceId: string;
  mode: Draft["mode"];
  prompt: string;
  sourceText: string;
  supportDocLinks: string;
  useWebResearch: boolean;
}) {
  return JSON.stringify({
    targetType: input.targetType,
    referenceId: input.referenceId,
    mode: input.mode,
    prompt: input.prompt.trim(),
    sourceText: input.sourceText.trim(),
    supportDocLinks: input.supportDocLinks.trim(),
    useWebResearch: input.useWebResearch
  });
}

function WriterFallback() {
  return (
    <div className="page writer-page">
      <header className="page-header">
        <div className="page-title-group">
          <span className="page-title-eyebrow">创作台</span>
          <div className="page-title-row">
            <span className="page-title-mark" aria-hidden="true">
              <PenLine size={20} strokeWidth={2.1} />
            </span>
            <div className="page-title-copy">
              <h1>对话写作</h1>
              <p className="subtle">正在读取写作台引用和历史记录。</p>
            </div>
          </div>
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
