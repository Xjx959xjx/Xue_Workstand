"use client";

import { Suspense, type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Copy,
  Eye,
  FileText,
  FileUp,
  Globe2,
  History,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  PenLine,
  Plus,
  Save,
  Send,
  Sparkles,
  X
} from "lucide-react";
import { splitWriterSourceItems } from "./_lib/source-items";
import { FeishuResultModal } from "./_components/FeishuResultModal";
import { WriterPreference } from "./_components/WriterPreference";
import { WriterPromptField } from "./_components/WriterPromptField";
import { WriterDialogModal } from "./_components/WriterDialogModal";
import { WriterHistoryPanel } from "./_components/WriterHistoryPanel";
import { WriterReferencePicker } from "./_components/WriterReferencePicker";
import { WriterStyleModal } from "./_components/WriterStyleModal";
import { useWriterHistory, useWriterHistoryActions } from "./_hooks/useWriterHistory";
import { useWriterSessionSave } from "./_hooks/useWriterSessionSave";
import { useFeishuPublish } from "./_hooks/useFeishuPublish";
import { useWriterGeneration } from "./_hooks/useWriterGeneration";
import { useWriterReferenceDetails } from "./_hooks/useWriterReferenceDetails";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { useLibrary } from "@/components/LibraryProvider";
import { useRemoteStatus } from "@/components/RemoteStatusProvider";
import { useScopedTasks } from "@/components/TaskProvider";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import {
  getDraft,
  uploadWriterSourceFiles
} from "@/lib/client";
import {
  draftWriteStyleReferenceInputs,
  parseWriteStyleReferenceKey,
  writeStyleReferenceKey
} from "@/lib/write-references";
import {
  extractRewriteSourceMaterial,
  mergeWriterSourceInput,
  normalizeRewritePrompt,
  restoreWriterSourceInput,
  splitWriterSourceInput
} from "@/lib/source-extraction";
import { appendWriterSourceFiles, WRITER_SOURCE_FILE_ACCEPT } from "@/lib/source-file-import";
import type {
  AccountListItem,
  Draft,
  ProjectListItem,
  WriteRevisionScope,
  WriteStyleReferenceInput
} from "@/lib/types";

const WRITER_SESSION_DRAFT_KEY = "writer-mobile-session-draft-v1";
const EMPTY_ACCOUNTS: AccountListItem[] = [];
const EMPTY_PROJECTS: ProjectListItem[] = [];

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
  const remoteStatus = useRemoteStatus();
  const [styleRefs, setStyleRefs] = useState<WriteStyleReferenceInput[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [useWebResearch, setUseWebResearch] = useState(false);
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [revisionScope, setRevisionScope] = useState<WriteRevisionScope>("full");
  const [revisionMode, setRevisionMode] = useState<"edit" | "recalibrate">("edit");
  const [selectedDraftText, setSelectedDraftText] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [sourceExpansion, setSourceExpansion] = useState<{ draftId: string; open: boolean } | null>(null);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const [sourceDragActive, setSourceDragActive] = useState(false);
  const [sourceImporting, setSourceImporting] = useState(false);
  const [sessionDraftHydrated, setSessionDraftHydrated] = useState(false);
  const loadedDraftParamRef = useRef("");
  const appliedSearchParamRef = useRef("");
  const draftEditorRef = useRef<HTMLTextAreaElement>(null);
  const revisionInputRef = useRef<HTMLTextAreaElement>(null);
  const sourceDragDepthRef = useRef(0);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const webResearchCapability = remoteStatus.status?.capabilities.webResearch;
  const webResearchAvailable = webResearchCapability?.available === true;

  useEffect(() => {
    if (webResearchCapability && !webResearchCapability.available) {
      setUseWebResearch(false);
    }
  }, [webResearchCapability]);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(WRITER_SESSION_DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved) as Partial<{
          targetType: "account" | "project";
          accountId: string;
          projectId: string;
          styleRefs: WriteStyleReferenceInput[];
          prompt: string;
          sourceText: string;
          supportDocLinks: string;
          useWebResearch: boolean;
          revisionInstruction: string;
          revisionMode?: "edit" | "recalibrate";
        }>;
        if (Array.isArray(draft.styleRefs) && draft.styleRefs.length) {
          setStyleRefs(draft.styleRefs);
        } else if (draft.targetType === "project" && typeof draft.projectId === "string") {
          setStyleRefs([{ targetType: "project", projectId: draft.projectId }]);
        } else if (typeof draft.accountId === "string") {
          const platform = draft.accountId.split(":")[0];
          if (platform === "bilibili" || platform === "douyin") {
            setStyleRefs([{ targetType: "account", platform, accountId: draft.accountId }]);
          }
        }
        if (typeof draft.prompt === "string") setPrompt(draft.prompt);
        if (typeof draft.sourceText === "string" || typeof draft.supportDocLinks === "string") {
          setSourceText(mergeWriterSourceInput(draft.sourceText, draft.supportDocLinks));
        }
        if (typeof draft.useWebResearch === "boolean") setUseWebResearch(draft.useWebResearch);
        if (draft.revisionMode === "edit" || draft.revisionMode === "recalibrate") setRevisionMode(draft.revisionMode);
        if (typeof draft.revisionInstruction === "string") setRevisionInstruction(draft.revisionInstruction);
      }
    } catch {
      window.sessionStorage.removeItem(WRITER_SESSION_DRAFT_KEY);
    } finally {
      setSessionDraftHydrated(true);
    }
  }, []);

  useWriterSessionSave(WRITER_SESSION_DRAFT_KEY, sessionDraftHydrated, {
    styleRefs, prompt, sourceText, useWebResearch, revisionInstruction, revisionMode
  }, setNotice);

  const selectedStyleRefs = useMemo(() => {
    const availableKeys = new Set([
      ...(library?.accounts || EMPTY_ACCOUNTS).map((account) => writeStyleReferenceKey({
        targetType: "account" as const,
        platform: account.platform,
        accountId: account.id
      })),
      ...(library?.projects || EMPTY_PROJECTS).map((project) => writeStyleReferenceKey({
        targetType: "project" as const,
        projectId: project.id
      }))
    ]);
    const selected = styleRefs.filter((reference) => availableKeys.has(writeStyleReferenceKey(reference)));
    if (selected.length) return selected;
    const firstAccount = library?.accounts[0];
    if (firstAccount) return [{ targetType: "account" as const, platform: firstAccount.platform, accountId: firstAccount.id }];
    const firstProject = library?.projects[0];
    return firstProject ? [{ targetType: "project" as const, projectId: firstProject.id }] : [];
  }, [library?.accounts, library?.projects, styleRefs]);
  const primaryStyleRef = selectedStyleRefs[0];
  const targetType = primaryStyleRef?.targetType || "account";
  const selectedAccount = useMemo(() => primaryStyleRef?.targetType === "account"
    ? library?.accounts.find((account) => account.id === primaryStyleRef.accountId && account.platform === primaryStyleRef.platform) || null
    : null, [library?.accounts, primaryStyleRef]);
  const selectedProject = useMemo(() => primaryStyleRef?.targetType === "project"
    ? library?.projects.find((project) => project.id === primaryStyleRef.projectId) || null
    : null, [library?.projects, primaryStyleRef]);

  const { historyDrafts, historyLoading, handleDraftSaved, setDraftSummaries } = useWriterHistory(loading, setNotice);

  const { activeStyle, activeStyleLoading, activeStyleError, activeSubtitle, activeTitle, styleCards } = useWriterReferenceDetails({
    accounts: library?.accounts || EMPTY_ACCOUNTS,
    projects: library?.projects || EMPTY_PROJECTS,
    references: selectedStyleRefs,
    setNotice
  });
  const separatedSourceInput = useMemo(() => splitWriterSourceInput(sourceText), [sourceText]);
  const sourceExtraction = useMemo(
    () => extractRewriteSourceMaterial(separatedSourceInput.sourceText),
    [separatedSourceInput.sourceText]
  );
  const normalizedSourceText = separatedSourceInput.sourceText;
  const hasRewriteSource = Boolean(normalizedSourceText.trim() || separatedSourceInput.supportDocLinks);
  const effectiveMode: Draft["mode"] = hasRewriteSource ? "rewrite" : "topic";
  const normalizedPrompt = useMemo(() => normalizeRewritePrompt(effectiveMode, prompt, sourceText), [effectiveMode, prompt, sourceText]);
  const hasTaskInput = Boolean(normalizedPrompt.trim() || hasRewriteSource);
  const noticeIsError = notice.includes("失败") || notice.includes("未配置");

  const handleRevisionCompleted = useCallback(() => {
    setRevisionInstruction("");
    setRevisionScope("full");
    setSelectedDraftText("");
  }, []);

  const {
    canGenerate,
    canRevise,
    canStopGenerate,
    activeVariantKey,
    clearDraftResult,
    copyLast,
    generatedVariants,
    generateStage,
    handleContentChange,
    handleGenerate,
    handleOpenAssets,
    handleRevise,
    handleSaveEdit,
    handleStopGenerate,
    hasAnyUnsavedChanges,
    hasUnsavedChanges,
    lastContent,
    lastDraftBase,
    lastDraftId,
    lastDraftVersion,
    lastResearch,
    loadDraftResult,
    selectGeneratedVariant
  } = useWriterGeneration({
    activeJobs,
    activeTitle,
    cancelTask,
    busy,
    hasTaskInput,
    mode: effectiveMode,
    normalizedPrompt,
    normalizedSourceText,
    originalSourceInput: sourceText,
    supportDocLinks: separatedSourceInput.supportDocLinks,
    recentJobs,
    revisionInstruction,
    revisionScope,
    revisionMode,
    selectedText: selectedDraftText,
    onDraftSaved: handleDraftSaved,
    onRevisionCompleted: handleRevisionCompleted,
    refresh,
    routerPush: router.push,
    routerReplace: router.replace,
    selectedAccount,
    selectedProject,
    styleRefs: selectedStyleRefs,
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
  const displayResearch = lastResearch;
  const sourceExpanded = sourceExpansion?.draftId === lastDraftId ? sourceExpansion.open : !lastDraftId;
  const draftCharacterCount = lastContent.replace(/\s/g, "").length;

  useEffect(() => {
    setResearchOpen(false);
  }, [lastDraftId]);

  const sourceFiles = useMemo(() => splitWriterSourceItems(sourceText).filter((item) => item.kind === "file"), [sourceText]);
  const sourceFileCount = sourceFiles.length;
  const sourceEditorText = useMemo(() => {
    let text = sourceText;
    for (const file of [...sourceFiles].reverse()) {
      const start = text.slice(0, file.start).endsWith("\n\n") ? file.start - 2 : file.start;
      text = text.slice(0, start) + text.slice(file.end);
    }
    return text;
  }, [sourceText, sourceFiles]);
  const nonFileTextMaterialCount = Math.max(0, sourceExtraction.textMaterialCount - sourceFileCount);
  const sourceItemCount = sourceExtraction.materials.length + separatedSourceInput.supportDocumentCount;
  const materialStatusLabel = sourceItemCount
    ? `${sourceItemCount} 项资料`
    : normalizedPrompt.trim()
      ? "自由输入"
      : "待素材";

  const handleDraftSelection = useCallback((field: HTMLTextAreaElement) => {
    const nextSelection = field.value.slice(field.selectionStart, field.selectionEnd);
    setSelectedDraftText(nextSelection);
    setRevisionScope(nextSelection.trim() ? "selection" : "full");
  }, []);

  const handleClearDraftSelection = useCallback(() => {
    const field = draftEditorRef.current;
    if (field) {
      const caret = field.selectionEnd;
      field.focus();
      field.setSelectionRange(caret, caret);
    }
    setSelectedDraftText("");
    setRevisionScope("full");
  }, []);

  const handleSelectGeneratedVariant = useCallback((variantKey: string) => {
    selectGeneratedVariant(variantKey);
    setRevisionInstruction("");
    setRevisionScope("full");
    setSelectedDraftText("");
  }, [selectGeneratedVariant]);

  const handleStartNewTask = useCallback(() => {
    if (busy || sourceImporting) return;
    if ((hasTaskInput || lastContent || hasAnyUnsavedChanges) && !window.confirm("新建任务会清空当前输入；已经保存的版本仍会保留。继续吗？")) {
      return;
    }

    loadedDraftParamRef.current = "";
    appliedSearchParamRef.current = "";
    clearDraftResult();
    setPrompt("");
    setSourceText("");
    setUseWebResearch(false);
    setRevisionInstruction("");
    setRevisionScope("full");
    setSelectedDraftText("");
    setHistoryOpen(false);
    setFocusMode(false);
    setSourceExpansion(null);

    const params = createWriterReferenceParams(selectedStyleRefs, "topic");
    router.replace(`/writer?${params.toString()}`, { scroll: false });
  }, [busy, clearDraftResult, hasAnyUnsavedChanges, hasTaskInput, lastContent, router, selectedStyleRefs, sourceImporting]);

  const handleSourceFiles = useCallback(async (files: File[]) => {
    if (!files.length || sourceImporting) return;
    setSourceImporting(true);
    try {
      const result = await uploadWriterSourceFiles(files);
      setSourceText((current) => appendWriterSourceFiles(current, result.files));
      const truncatedCount = result.files.filter((file) => file.truncated).length;
      notify({
        tone: "success",
        message: `已导入 ${result.files.length} 个文件${truncatedCount ? `，其中 ${truncatedCount} 个过长文件已截取` : ""}。`
      });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "导入素材文件失败" });
    } finally {
      setSourceImporting(false);
      setSourceDragActive(false);
      sourceDragDepthRef.current = 0;
      if (sourceFileInputRef.current) sourceFileInputRef.current.value = "";
    }
  }, [notify, sourceImporting]);

  const handleSourceDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (sourceImporting || !event.dataTransfer.types.includes("Files")) return;
    sourceDragDepthRef.current += 1;
    setSourceDragActive(true);
  }, [sourceImporting]);

  const handleSourceDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    sourceDragDepthRef.current = Math.max(0, sourceDragDepthRef.current - 1);
    if (!sourceDragDepthRef.current) setSourceDragActive(false);
  }, []);

  const handleSourceDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    sourceDragDepthRef.current = 0;
    setSourceDragActive(false);
    if (sourceImporting) return;
    void handleSourceFiles(Array.from(event.dataTransfer.files));
  }, [handleSourceFiles, sourceImporting]);

  useEffect(() => {
    if (!notice || isTaskProgressMessage(notice)) return;
    notify({ tone: noticeIsError ? "error" : "success", message: notice });
  }, [notice, noticeIsError, notify]);

  const applyLoadedDraft = useCallback((draft: Draft) => {
    setStyleRefs(draftWriteStyleReferenceInputs(draft));
    setPrompt(draft.prompt);
    setSourceText(restoreWriterSourceInput({
      originalSourceInput: draft.originalSourceInput,
      sourceText: draft.input,
      supportDocLinks: draft.supportDocLinks
    }));
    setUseWebResearch(Boolean(draft.sourceDigest?.webResearchEnabled) && webResearchAvailable);
    setRevisionInstruction("");
    setRevisionScope("full");
    setSelectedDraftText("");
    loadDraftResult(draft);
  }, [loadDraftResult, webResearchAvailable]);

  useEffect(() => {
    let ignore = false;
    const searchKey = searchParams.toString();
    const target = searchParams.get("targetType");
    const nextMode = searchParams.get("mode");
    const nextPrompt = searchParams.get("prompt");
    const nextSourceText = searchParams.get("sourceText");
    const nextAccountId = searchParams.get("accountId");
    const nextProjectId = searchParams.get("projectId");
    const nextStyleRefs = searchParams.getAll("styleRef").flatMap((value) => {
      const reference = parseWriteStyleReferenceKey(value);
      return reference ? [reference] : [];
    });
    const draftId = searchParams.get("draftId");

    if (draftId) {
      if (loadedDraftParamRef.current === draftId || loadedDraftParamRef.current === `loading:${draftId}`) return;
      loadedDraftParamRef.current = `loading:${draftId}`;
      getDraft(draftId)
        .then((draft) => {
          if (ignore) return;
          loadedDraftParamRef.current = draft.id;
          applyLoadedDraft(draft);
        })
        .catch((error) => {
          if (ignore) return;
          loadedDraftParamRef.current = "";
          setNotice(error instanceof Error ? error.message : "读取草稿详情失败");
        });
      return () => {
        ignore = true;
        // 释放本次请求的标记，允许依赖变化或 Strict Mode 清理后重新加载。
        if (loadedDraftParamRef.current === `loading:${draftId}`) {
          loadedDraftParamRef.current = "";
        }
      };
    }
    if (!draftId) loadedDraftParamRef.current = "";
    if (appliedSearchParamRef.current === searchKey) return;

    const hasUrlState =
      Boolean(target || nextMode || nextAccountId || nextProjectId || nextStyleRefs.length) ||
      nextPrompt !== null ||
      nextSourceText !== null;
    if (!hasUrlState) {
      appliedSearchParamRef.current = searchKey;
      return;
    }

    if (nextStyleRefs.length) {
      setStyleRefs(nextStyleRefs);
    } else if (nextProjectId) {
      setStyleRefs([{ targetType: "project", projectId: nextProjectId }]);
    } else if (nextAccountId) {
      const platform = nextAccountId.split(":")[0];
      if (platform === "bilibili" || platform === "douyin") {
        setStyleRefs([{ targetType: "account", platform, accountId: nextAccountId }]);
      }
    }
    if (nextPrompt !== null) setPrompt(nextPrompt);
    if (nextSourceText !== null) setSourceText(nextSourceText);
    setUseWebResearch(false);
    setRevisionInstruction("");
    setRevisionScope("full");
    setSelectedDraftText("");
    appliedSearchParamRef.current = searchKey;
  }, [applyLoadedDraft, searchParams]);

  const clearHistoryCurrent = useCallback(() => {
    loadedDraftParamRef.current = "";
    clearDraftResult();
    setPrompt("");
    setSourceText("");
    setUseWebResearch(false);
    setRevisionInstruction("");
    setRevisionScope("full");
    setSelectedDraftText("");
    const params = createWriterReferenceParams(selectedStyleRefs, effectiveMode);
    router.replace(`/writer?${params.toString()}`, { scroll: false });
  }, [clearDraftResult, effectiveMode, router, selectedStyleRefs]);
  const { handleSelectHistoryDraft, handleDeleteHistoryDraft, handleDeleteHistoryDrafts, handleRenameHistoryDraft } = useWriterHistoryActions({
    historyDrafts, setDraftSummaries, lastDraftId, loadedDraftParamRef, applyLoadedDraft,
    onClearCurrent: clearHistoryCurrent, setNotice, refresh
  });

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
    <div
      className={`page writer-page${focusMode ? " writer-focus-mode" : ""}`}
      data-unsaved-changes={hasAnyUnsavedChanges || hasTaskInput || Boolean(revisionInstruction.trim()) ? "true" : undefined}
    >
      <header className="page-header writer-page-header">
        <div className="page-title-group">
          <div className="page-title-row">
            <span className="page-title-mark" aria-hidden="true">
              <PenLine size={20} strokeWidth={2.1} />
            </span>
            <div className="page-title-copy">
              <h1>对话写作</h1>
              <div className="writer-title-meta">
                <p className="subtle">选风格，写需求，生成。</p>
                {sessionDraftHydrated && hasTaskInput ? (
                  <span className="writer-autosave-status" role="status">
                    <CheckCircle2 aria-hidden="true" size={13} />
                    输入已暂存
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="page-header-meta writer-page-actions">
          <button
            aria-controls="writer-task-panel"
            aria-expanded={!focusMode}
            className="btn"
            onClick={() => setFocusMode((focused) => !focused)}
            type="button"
          >
            {focusMode ? <PanelLeftOpen aria-hidden="true" size={16} /> : <PanelLeftClose aria-hidden="true" size={16} />}
            {focusMode ? "展开任务资料" : "专注写稿"}
          </button>
          <button className="btn" disabled={Boolean(busy) || sourceImporting} onClick={handleStartNewTask} type="button">
            <Plus aria-hidden="true" size={16} />
            新建任务
          </button>
        </div>
      </header>

      <section className="writer-workbench">
        <section className="panel writer-main">
          <div className="writer-content-grid">
            <div className="writer-task" id="writer-task-panel" hidden={focusMode}>
              <div className="section-title-row">
                <div>
                  <h2>本次任务</h2>
                  <p className="pane-subtitle">选好风格，把想法交给这篇稿件。</p>
                </div>
                <div className="writer-task-heading-actions">
                  <span className={`status-pill ${hasTaskInput ? "done" : "pending"}`}>{materialStatusLabel}</span>
                </div>
              </div>

              <div className="writer-refbar">
                <div className="writer-reference-control">
                  <span>参考风格</span>
                  <WriterReferencePicker
                    accounts={library?.accounts || EMPTY_ACCOUNTS}
                    disabled={loading}
                    onChange={setStyleRefs}
                    projects={library?.projects || EMPTY_PROJECTS}
                    references={selectedStyleRefs}
                  />
                </div>

                <div className="writer-reference-status" aria-label="当前风格卡状态">
                  <span className="writer-reference-icon" aria-hidden="true">
                    <FileText aria-hidden="true" size={14} />
                  </span>
                  <span className="writer-reference-copy">
                    <strong>{activeStyleLoading ? "正在载入风格卡" : activeStyleError ? "风格卡读取失败" : activeStyle?.trim() ? "风格卡已载入" : "暂无风格卡"}</strong>
                    <small>
                      {activeSubtitle || "参考风格"}
                      {activeStyleLoading ? "" : activeStyleError ? " · 查看详情" : activeStyle?.trim().length ? ` · ${activeStyle.trim().length} 字` : " · 未配置"}
                    </small>
                  </span>
                  <button
                    aria-label={styleCards.length > 1 ? `查看${activeTitle}` : `查看${activeTitle || "当前参考"}风格卡`}
                    className="btn ghost icon-only writer-style-trigger"
                    disabled={!styleCards.length}
                    onClick={() => setStyleOpen(true)}
                    title="查看风格卡"
                    type="button"
                  >
                    <Eye aria-hidden="true" size={16} />
                  </button>
                </div>
              </div>

              <WriterPromptField prompt={prompt} onChange={setPrompt} />

              <section className={`writer-source-section${sourceExpanded ? " is-expanded" : ""}`}>
                <button
                  aria-controls="writer-source-content"
                  aria-expanded={sourceExpanded}
                  className="writer-source-toggle"
                  onClick={() => setSourceExpansion({ draftId: lastDraftId, open: !sourceExpanded })}
                  type="button"
                >
                  <Paperclip aria-hidden="true" size={16} />
                  <span><strong>素材与原文</strong><small>{materialStatusLabel} · {sourceExpanded ? "收起资料" : "展开查看或编辑"}</small></span>
                  <ChevronDown aria-hidden="true" size={15} />
                </button>
                <div id="writer-source-content" className="writer-source-content" hidden={!sourceExpanded}>
                  <div className="writer-field writer-source-field">
                    <div className="writer-source-label-row">
                      <label htmlFor="writer-source-text">素材 / 原文 / 支持文档</label>
                      <button
                        aria-busy={sourceImporting}
                        className="btn small ghost writer-source-file-button"
                        disabled={sourceImporting}
                        onClick={() => sourceFileInputRef.current?.click()}
                        title="支持 TXT、Markdown、CSV、JSON、HTML、字幕和 DOCX"
                        type="button"
                      >
                        <Paperclip aria-hidden="true" size={14} />
                        {sourceImporting ? "导入中" : "添加文件"}
                      </button>
                      <input
                        accept={WRITER_SOURCE_FILE_ACCEPT}
                        aria-label="选择素材文件"
                        className="writer-source-file-input"
                        disabled={sourceImporting}
                        multiple
                        onChange={(event) => void handleSourceFiles(Array.from(event.target.files || []))}
                        ref={sourceFileInputRef}
                        type="file"
                      />
                    </div>
                    <div
                      className={`writer-source-dropzone ${sourceDragActive ? "drag-active" : ""}`}
                      onDragEnter={handleSourceDragEnter}
                      onDragLeave={handleSourceDragLeave}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={handleSourceDrop}
                    >
                      <textarea
                        aria-label="素材、原文、视频链接或支持文档"
                        autoComplete="off"
                        className="writer-textarea source"
                        id="writer-source-text"
                        name="sourceText"
                        placeholder="可选：粘贴原文、抖音/B站视频链接、飞书/企业微信/腾讯文档或公开网页链接；多条资料换行即可。"
                        value={sourceEditorText}
                        onChange={(event) => {
                          const text = event.target.value;
                          setSourceText((current) => {
                            const files = splitWriterSourceItems(current).filter((item) => item.kind === "file");
                            return [text, ...files.map((file) => file.raw)].filter(Boolean).join("\n\n");
                          });
                        }}
                      />
                      {sourceDragActive ? (
                        <div className="writer-source-drop-overlay" aria-hidden="true">
                          <Paperclip size={20} />
                          <strong>松开即可导入</strong>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {sourceFiles.length ? (
                    <div className="writer-attachments" aria-label="参考附件" aria-live="polite">
                      {sourceFiles.map((file, index) => (
                        <div className="source-detect-row" key={`${index}:${file.title}`}>
                          <FileText size={14} aria-hidden="true" />
                          <span>{file.title}</span>
                          <small>{file.content.length.toLocaleString()} 字 · 已作为参考资料</small>
                          <button
                            className="btn small ghost icon-only"
                            type="button"
                            aria-label={`移除附件 ${file.title}`}
                            disabled={Boolean(busy) || sourceImporting}
                            onClick={() => setSourceText((current) => {
                              const target = splitWriterSourceItems(current).filter((item) => item.kind === "file")[index];
                              return target ? current.slice(0, target.start) + current.slice(target.end) : current;
                            })}
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {sourceText.trim() ? (
                    <div className="source-detect-row" aria-live="polite">
                      {sourceFileCount ? <span className="status-pill done">{sourceFileCount} 个本地文件</span> : null}
                      {separatedSourceInput.supportDocumentCount ? <span className="status-pill done">{separatedSourceInput.supportDocumentCount} 份支持文档</span> : null}
                      {sourceExtraction.pendingLinkCount ? <span className="status-pill pending">{sourceExtraction.pendingLinkCount} 个视频链接待转写</span> : null}
                      {sourceExtraction.reusedTextLinkCount ? <span className="status-pill done">{sourceExtraction.reusedTextLinkCount} 个链接复用已有文案</span> : null}
                      {nonFileTextMaterialCount ? <span className="status-pill">{nonFileTextMaterialCount} 条文案</span> : null}
                      {sourceExtraction.onlyLinkCount ? <span className="status-pill pending">{sourceExtraction.onlyLinkCount} 条仅链接</span> : null}
                    </div>
                  ) : null}

                </div>
              </section>
              {lastDraftId ? (
                <details className="writer-preference-disclosure" key={lastDraftId}>
                  <summary><PenLine aria-hidden="true" size={15} /><span>长期写作偏好</span><ChevronDown aria-hidden="true" size={14} /></summary>
                  <WriterPreference draftId={lastDraftId} disabled={Boolean(busy)} onSaved={refresh} />
                </details>
              ) : null}

              <div className="writer-actionbar">
                <div className="writer-action-controls">
                  <button
                    aria-label={useWebResearch ? "关闭联网补充资料" : "开启联网补充资料"}
                    aria-pressed={useWebResearch}
                    className={`btn icon-toggle writer-web-toggle ${useWebResearch ? "active" : ""}`}
                    disabled={!webResearchAvailable}
                    onClick={() => setUseWebResearch((enabled) => !enabled)}
                    title={webResearchCapability
                      ? webResearchCapability.available
                        ? `联网补充资料${webResearchCapability.model ? ` · ${webResearchCapability.model}` : ""}`
                        : webResearchCapability.reason
                      : "正在检查联网能力"}
                    type="button"
                  >
                    <Globe2 aria-hidden="true" size={16} />
                    {useWebResearch ? "已联网" : webResearchAvailable ? "联网" : "联网不可用"}
                  </button>
                  <button
                    className={`btn ${lastContent ? "secondary" : "primary"} writer-generate-button`}
                    disabled={!canGenerate}
                    onClick={() => void handleGenerate()}
                    title={canGenerate
                      ? selectedStyleRefs.length > 1 ? `并发生成 ${selectedStyleRefs.length} 篇独立文案` : "生成文案"
                      : "先填写素材或写作要求"}
                    type="button"
                  >
                    <Sparkles aria-hidden="true" size={16} />
                    {busy === "generate"
                      ? "生成中"
                      : selectedStyleRefs.length > 1 ? `并发生成 ${selectedStyleRefs.length} 篇` : lastContent ? "重新生成文案" : "生成文案"}
                  </button>
                  {canStopGenerate ? (
                    <button className="btn ghost" onClick={() => void handleStopGenerate()} type="button">
                      <CircleStop aria-hidden="true" size={16} />
                      停止
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="writer-result" id="writer-result">
              <div className="section-title-row writer-document-toolbar">
                <div className="writer-result-title">
                  <h2>当前稿件</h2>
                  {lastDraftId ? <span className="status-pill done">V{lastDraftVersion?.revision || 1}</span> : null}
                  {lastContent ? <span className="writer-document-count" title="不含空白字符">{draftCharacterCount.toLocaleString()} 字</span> : null}
                  {hasUnsavedChanges ? <span className="status-pill pending">未保存</span> : null}
                </div>
                <div className="writer-result-actions">
                  <button
                    aria-label="打开稿件历史，查看当前稿件版本或全部历史"
                    className="btn compact writer-history-trigger"
                    onClick={() => setHistoryOpen(true)}
                    type="button"
                  >
                    <History aria-hidden="true" size={15} />
                    稿件历史
                  </button>
                  {displayResearch ? (
                    <button className="btn compact" onClick={() => setResearchOpen(true)} type="button" aria-haspopup="dialog">
                      <BookOpenText aria-hidden="true" size={15} />
                      {displayResearch.includes("成稿检查（需修改）") ? "参考资料 · 待检查" : "参考资料"}
                    </button>
                  ) : null}
                  {lastContent ? (
                    <>
                    <button className="btn compact" onClick={copyLast} type="button">
                      <Copy aria-hidden="true" size={16} />
                      复制
                    </button>
                    <button
                      aria-busy={busy === "save-draft"}
                      className="btn compact"
                      disabled={!hasUnsavedChanges || Boolean(busy)}
                      onClick={() => void handleSaveEdit()}
                      type="button"
                    >
                      <Save aria-hidden="true" size={16} />
                      {busy === "save-draft" ? "保存中" : "保存版本"}
                    </button>
                    <details className="writer-output-more">
                      <summary className="btn compact">
                        <MoreHorizontal aria-hidden="true" size={16} />
                        更多
                      </summary>
                      <div className="writer-output-menu">
                        <button disabled={Boolean(busy)} onClick={handlePublishFeishu} type="button">
                          <FileUp aria-hidden="true" size={16} />
                          {busy === "feishu" ? "发布中…" : "发布到飞书"}
                        </button>
                        <button disabled={!lastDraftBase || Boolean(busy)} onClick={handleOpenAssets} type="button">
                          <MessageSquarePlus aria-hidden="true" size={16} />
                          {busy === "assets" ? "准备中" : "生成评论 / 弹幕"}
                        </button>
                      </div>
                    </details>
                    </>
                  ) : (
                    <span className="status-pill pending" data-busy={busy === "generate" ? "true" : undefined}>{busy === "generate" ? "生成中" : "待输入"}</span>
                  )}
                </div>
              </div>
              {busy === "generate" ? (
                <div className="writer-generation-status" role="status" aria-live="polite">
                  <span className="writer-activity-dot" aria-hidden="true" />
                  <div>
                    <strong>{generateStage || "正在生成文案"}</strong>
                    <span>任务会在后台继续，可以留在当前页面等待。</span>
                  </div>
                  {canStopGenerate ? (
                    <button className="btn small ghost" onClick={() => void handleStopGenerate()} type="button">
                      <CircleStop aria-hidden="true" size={14} />
                      停止
                    </button>
                  ) : null}
                </div>
              ) : null}
              {generatedVariants.length > 1 ? (
                <div aria-label="并发生成的独立稿件" className="writer-variant-tabs" role="tablist">
                  {generatedVariants.map((variant, index) => (
                    <button
                      aria-selected={variant.key === activeVariantKey}
                      className={variant.key === activeVariantKey ? "active" : ""}
                      key={variant.key}
                      onClick={() => handleSelectGeneratedVariant(variant.key)}
                      role="tab"
                      type="button"
                    >
                      <span>{variant.title || `风格 ${index + 1}`}</span>
                      <small>
                        {variant.hasUnsavedChanges ? "未保存" : `V${variant.version?.revision || 1}`}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
              {lastContent ? (
                <textarea
                  aria-label="当前稿件"
                  className="result-box writer-draft-editor"
                  onChange={(event) => {
                    handleContentChange(event.target.value);
                    setSelectedDraftText("");
                    setRevisionScope("full");
                  }}
                  onKeyUp={(event) => handleDraftSelection(event.currentTarget)}
                  onMouseUp={(event) => handleDraftSelection(event.currentTarget)}
                  readOnly={busy === "generate"}
                  ref={draftEditorRef}
                  spellCheck={false}
                  value={lastContent}
                />
              ) : (
                <div className="writer-result-empty">
                  <span aria-hidden="true"><Sparkles size={20} /></span>
                  <strong>{busy === "generate" ? "正在准备第一版" : "暂无稿件"}</strong>
                  <p>{busy === "generate" ? "正在整理素材、风格和写作要求。" : `${activeTitle || "当前参考"} · ${materialStatusLabel}`}</p>
                </div>
              )}
              {lastContent ? (
                <section className="writer-revision-composer" aria-labelledby="writer-revision-title">
                  <div className="writer-revision-head">
                    <div>
                      <h3 id="writer-revision-title">继续修改 <span>基于 V{lastDraftVersion?.revision || 1}</span></h3>
                    </div>
                    {selectedDraftText ? (
                      <button className="writer-selection-chip" onClick={handleClearDraftSelection} type="button">
                        只改选中 {selectedDraftText.length} 字
                        <X aria-hidden="true" size={13} />
                      </button>
                    ) : null}
                    <label className="writer-revision-mode">
                      <span>修改方式</span>
                      <select className="writer-ref-select" aria-label="修改方式" aria-describedby="writer-revision-mode-help" disabled={busy === "generate"} value={revisionMode}
                        onChange={(event) => setRevisionMode(event.target.value as "edit" | "recalibrate")}>
                        <option value="edit">按要求微调</option>
                        <option value="recalibrate">重新校准风格</option>
                      </select>
                    </label>
                  </div>
                  <label className="writer-field">
                    <span>本轮修改要求</span>
                    <textarea
                      aria-label="本轮修改要求"
                      aria-describedby="writer-revision-mode-help"
                      ref={revisionInputRef}
                      rows={2}
                      className="writer-textarea revision"
                      disabled={busy === "generate"}
                      onChange={(event) => setRevisionInstruction(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canRevise) {
                          event.preventDefault();
                          void handleRevise();
                        }
                      }}
                      placeholder="例如：压缩第 2 段，产品参数和原有表达方式保持不变。"
                      value={revisionInstruction}
                    />
                  </label>
                  <div className="writer-revision-actions">
                    <div className="writer-revision-shortcuts" aria-label="快捷修改要求">
                      {[
                        ["精简篇幅", "精简篇幅，保留核心信息和原有表达风格。"],
                        ["加强开头", "加强开头的吸引力，其余内容尽量保持不变。"]
                      ].map(([label, instruction]) => (
                        <button className="btn small ghost" disabled={Boolean(busy)} key={label} type="button" onClick={() => {
                          setRevisionInstruction((current) => current.trim() ? `${current.trim()}\n${instruction}` : instruction);
                          revisionInputRef.current?.focus();
                        }}>{label}</button>
                      ))}
                    </div>
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
                  <p className="writer-revision-help" id="writer-revision-mode-help">
                    {selectedDraftText ? "仅修改选中内容，生成完整新版本。" : revisionMode === "recalibrate" ? "沿用本稿参考，重新组织表达。" : "选中文字可局部修改；其余表达尽量保留。"}
                    <span>⌘ / Ctrl + Enter</span>
                  </p>
                </section>
              ) : null}
            </div>
          </div>
        </section>

        <WriterHistoryPanel
          drafts={historyDrafts}
          loading={historyLoading}
          open={historyOpen}
          onClose={closeHistory}
          onDeleteDraft={handleDeleteHistoryDraft}
          onDeleteDrafts={handleDeleteHistoryDrafts}
          onRenameDraft={handleRenameHistoryDraft}
          selectedDraftId={lastDraftId}
          onSelectDraft={handleSelectHistoryDraft}
        />
      </section>

      {researchOpen && displayResearch ? (
        <WriterDialogModal labelledBy="writer-reference-dialog-title" onClose={() => setResearchOpen(false)} panelClassName="writer-reference-dialog">
          <div className="modal-header">
            <div><h2 id="writer-reference-dialog-title">本稿参考资料</h2><p className="subtle">生成当前稿件时使用的写法、原文与资料</p></div>
            <button className="btn ghost icon-only" aria-label="关闭参考资料" onClick={() => setResearchOpen(false)} type="button"><X aria-hidden="true" size={18} /></button>
          </div>
          <ResearchReferenceBody text={displayResearch} />
        </WriterDialogModal>
      ) : null}

      {styleOpen ? (
        <WriterStyleModal activeTitle={activeTitle} onClose={() => setStyleOpen(false)} styleCards={styleCards} />
      ) : null}

      {feishuResult ? (
        <FeishuResultModal result={feishuResult} onClose={() => setFeishuResult(null)} />
      ) : null}
    </div>
  );
}

function ResearchReferenceBody({ id, text }: { id?: string; text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"'）)]+)/g);
  return (
    <pre className="style-reference-body" id={id}>
      {parts.map((part, index) =>
        /^https?:\/\//i.test(part) ? (
          <a href={part} key={`${part}-${index}`} rel="noreferrer" target="_blank">
            {part}
          </a>
        ) : part
      )}
    </pre>
  );
}

function createWriterReferenceParams(references: WriteStyleReferenceInput[], mode: Draft["mode"]) {
  const primary = references[0];
  const params = new URLSearchParams({
    targetType: primary?.targetType || "account",
    mode
  });
  if (primary?.targetType === "project") params.set("projectId", primary.projectId);
  if (primary?.targetType === "account") params.set("accountId", primary.accountId);
  for (const reference of references) params.append("styleRef", writeStyleReferenceKey(reference));
  return params;
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
