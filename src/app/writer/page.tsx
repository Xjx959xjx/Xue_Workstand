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
  Paperclip,
  PenLine,
  Plus,
  Save,
  Send,
  Sparkles,
  X
} from "lucide-react";
import { FeishuResultModal } from "./_components/FeishuResultModal";
import { WriterPreference } from "./_components/WriterPreference";
import { WriterHistoryPanel } from "./_components/WriterHistoryPanel";
import { WriterReferencePicker } from "./_components/WriterReferencePicker";
import { WriterStyleModal } from "./_components/WriterStyleModal";
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
  deleteDrafts,
  draftSummaryFromDraft,
  getCachedDrafts,
  getDraft,
  getDrafts,
  renameDraft,
  uploadWriterSourceFiles
} from "@/lib/client";
import { buildWriterDraftHref } from "@/lib/draft-links";
import {
  draftWriteStyleReferenceInputs,
  parseWriteStyleReferenceKey,
  writeStyleReferenceKey
} from "@/lib/write-references";
import {
  DEFAULT_REWRITE_PROMPT,
  extractRewriteSourceMaterial,
  mergeWriterSourceInput,
  normalizeRewritePrompt,
  restoreWriterSourceInput,
  splitWriterSourceInput
} from "@/lib/source-extraction";
import { appendWriterSourceFiles, countWriterSourceFiles, WRITER_SOURCE_FILE_ACCEPT } from "@/lib/source-file-import";
import type {
  AccountListItem,
  Draft,
  DraftSummary,
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
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const [sourceDragActive, setSourceDragActive] = useState(false);
  const [sourceImporting, setSourceImporting] = useState(false);
  const [sessionDraftHydrated, setSessionDraftHydrated] = useState(false);
  const [draftSummaries, setDraftSummaries] = useState<DraftSummary[] | null>(() => getCachedDrafts()?.drafts ?? null);
  const loadedDraftParamRef = useRef("");
  const appliedSearchParamRef = useRef("");
  const draftEditorRef = useRef<HTMLTextAreaElement>(null);
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

  useEffect(() => {
    if (!sessionDraftHydrated) return;
    window.sessionStorage.setItem(WRITER_SESSION_DRAFT_KEY, JSON.stringify({
      styleRefs,
      prompt,
      sourceText,
      useWebResearch,
      revisionInstruction,
      revisionMode
    }));
  }, [
    prompt,
    revisionInstruction,
    revisionMode,
    sessionDraftHydrated,
    sourceText,
    styleRefs,
    useWebResearch
  ]);

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

  const allDrafts = useMemo(() => draftSummaries || [], [draftSummaries]);
  const historyLoading = loading || draftSummaries === null;
  const historyDrafts = useMemo(() => [...allDrafts].sort(compareCreatedAtDesc), [allDrafts]);

  const handleDraftSaved = useCallback(
    (draft: Draft) => {
      setDraftSummaries((current) => mergeDraftSummaryLists(current || [], [draftSummaryFromDraft(draft)]));
    },
    []
  );

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

  useEffect(() => {
    setResearchOpen(false);
  }, [lastDraftId]);

  const sourceFileCount = useMemo(() => countWriterSourceFiles(sourceText), [sourceText]);
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

  useEffect(() => {
    let ignore = false;
    if (draftSummaries !== null) return;

    getDrafts()
      .then((result) => {
        if (ignore) return;
        setDraftSummaries((current) => mergeDraftSummaryLists(current || [], result.drafts));
      })
      .catch((err) => {
        if (!ignore) setNotice(err instanceof Error ? err.message : "读取历史记录失败");
      });

    return () => {
      ignore = true;
    };
  }, [draftSummaries]);

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

  const handleSelectHistoryDraft = useCallback(
    async (summary: DraftSummary) => {
      try {
        const draft = await getDraft(summary.id);
        loadedDraftParamRef.current = draft.id;
        applyLoadedDraft(draft);
        router.replace(buildWriterDraftHref(draft), { scroll: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取草稿详情失败";
        setNotice(message);
        throw error;
      }
    },
    [applyLoadedDraft, router]
  );

  const handleDeleteHistoryDraft = useCallback(
    async (draft: DraftSummary) => {
      const replacement = findReplacementDraft(historyDrafts, new Set([draft.id]), draft);

      try {
        await deleteDrafts([draft.id]);
        setDraftSummaries((current) => (current || []).filter((item) => item.id !== draft.id));

        if (draft.id === lastDraftId) {
          if (replacement) {
            await handleSelectHistoryDraft(replacement);
          } else {
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
      clearDraftResult,
      handleSelectHistoryDraft,
      historyDrafts,
      effectiveMode,
      lastDraftId,
      notify,
      refresh,
      router,
      selectedStyleRefs
    ]
  );

  const handleDeleteHistoryDrafts = useCallback(
    async (draftsToDelete: DraftSummary[]) => {
      const draftIds = draftsToDelete.map((draft) => draft.id);
      const deletedIds = new Set(draftIds);
      const currentDraft = historyDrafts.find((draft) => draft.id === lastDraftId);
      const replacement = findReplacementDraft(historyDrafts, deletedIds, currentDraft);

      try {
        await deleteDrafts(draftIds);
        setDraftSummaries((current) => (current || []).filter((item) => !deletedIds.has(item.id)));

        if (lastDraftId && deletedIds.has(lastDraftId)) {
          if (replacement) {
            await handleSelectHistoryDraft(replacement);
          } else {
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
      clearDraftResult,
      handleSelectHistoryDraft,
      historyDrafts,
      effectiveMode,
      lastDraftId,
      notify,
      refresh,
      router,
      selectedStyleRefs
    ]
  );

  const handleRenameHistoryDraft = useCallback(
    async (draft: DraftSummary, title: string) => {
      try {
        const updatedDraft = await renameDraft({ draftId: draft.id, title });
        setDraftSummaries((current) => mergeDraftSummaryLists(current || [], [draftSummaryFromDraft(updatedDraft)]));
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
    <div
      className="page writer-page"
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
      </header>

      <section className="writer-workbench">
        <section className="panel writer-main">
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

          <div className="writer-content-grid">
            <div className="writer-task">
              <div className="section-title-row">
                <div>
                  <h2>写作任务</h2>
                  <p className="pane-subtitle">说清目标，有素材就贴；其余交给系统处理。</p>
                </div>
                <div className="writer-task-heading-actions">
                  <span className={`status-pill ${hasTaskInput ? "done" : "pending"}`}>{materialStatusLabel}</span>
                  <button className="btn compact" disabled={Boolean(busy) || sourceImporting} onClick={handleStartNewTask} type="button">
                    <Plus aria-hidden="true" size={15} />
                    新建任务
                  </button>
                </div>
              </div>

              <label className="writer-field">
                <span>这次想怎么写</span>
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
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                  />
                  {sourceDragActive ? (
                    <div className="writer-source-drop-overlay" aria-hidden="true">
                      <Paperclip size={20} />
                      <strong>松开即可导入</strong>
                    </div>
                  ) : null}
                </div>
              </div>
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
                    className="btn primary writer-generate-button"
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
                      : selectedStyleRefs.length > 1 ? `并发生成 ${selectedStyleRefs.length} 篇` : "生成文案"}
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
              <div className="section-title-row">
                <div className="writer-result-title">
                  <h2>当前稿件</h2>
                  {lastDraftId ? <span className="status-pill done">V{lastDraftVersion?.revision || 1}</span> : null}
                  {hasUnsavedChanges ? <span className="status-pill pending">有未保存编辑</span> : null}
                </div>
                <div className="writer-result-actions">
                  <button
                    aria-label={`打开版本历史，共 ${historyDrafts.length} 个版本`}
                    className="btn compact writer-history-trigger"
                    onClick={() => setHistoryOpen(true)}
                    type="button"
                  >
                    <History aria-hidden="true" size={15} />
                    版本历史
                    <span className="writer-history-count">{historyLoading ? "…" : historyDrafts.length}</span>
                  </button>
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
              {displayResearch ? (
                <section className={`style-reference ${researchOpen ? "is-open" : ""}`}>
                  <button
                    aria-controls="writer-research-reference"
                    aria-expanded={researchOpen}
                    className="style-reference-summary"
                    onClick={() => setResearchOpen((open) => !open)}
                    type="button"
                  >
                    <span className="style-reference-icon" aria-hidden="true">
                      <BookOpenText size={16} />
                    </span>
                    <span className="style-reference-heading">
                      <span className="style-reference-title">参考资料</span>
                      <small>{displayResearch.includes("成稿检查（需修改）") ? "有未满足的要求，请展开检查" : "本稿选用的写法、原文与资料"}</small>
                    </span>
                    <ChevronDown className="style-reference-chevron" aria-hidden="true" size={16} />
                  </button>
                  {researchOpen ? <ResearchReferenceBody id="writer-research-reference" text={displayResearch} /> : null}
                </section>
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
              {lastDraftId ? <WriterPreference key={lastDraftId} draftId={lastDraftId} disabled={Boolean(busy)} onSaved={refresh} /> : null}
              {lastContent ? (
                <section className="writer-revision-composer" aria-labelledby="writer-revision-title">
                  <div className="writer-revision-head">
                    <div>
                      <h3 id="writer-revision-title">继续修改</h3>
                      <p>{selectedDraftText ? `已选中 ${selectedDraftText.length} 字` : "基于当前版本生成下一版"}</p>
                    </div>
                    {selectedDraftText ? (
                      <button className="writer-selection-chip" onClick={handleClearDraftSelection} type="button">
                        只改选中内容
                        <X aria-hidden="true" size={13} />
                      </button>
                    ) : null}
                  </div>
                  <label className="writer-field">
                    <span>修改方式</span>
                    <select className="writer-ref-select" aria-label="修改方式" aria-describedby="writer-revision-mode-help" disabled={busy === "generate"} value={revisionMode}
                      onChange={(event) => setRevisionMode(event.target.value as "edit" | "recalibrate")}>
                      <option value="edit">按要求微调</option>
                      <option value="recalibrate">重新校准风格</option>
                    </select>
                    <span id="writer-revision-mode-help">{revisionMode === "recalibrate" ? "沿用本稿参考，重新组织表达；选中段落时只调整选中范围。" : "处理本轮点名的问题，尽量保留其余表达。"}</span>
                  </label>
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
                      placeholder="例如：压缩第 2 段，产品参数和原有表达方式保持不变。"
                      value={revisionInstruction}
                    />
                  </label>
                  <div className="writer-revision-actions">
                    <span>{selectedDraftText ? "会只调整选中内容，并返回完整新稿。" : "在稿件里选中文字，可直接切换为局部修改。"}</span>
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

function mergeDraftSummaryLists(...groups: DraftSummary[][]) {
  const byId = new Map<string, DraftSummary>();

  for (const group of groups) {
    for (const draft of group) {
      const current = byId.get(draft.id);
      if (!current) {
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

function findReplacementDraft(drafts: DraftSummary[], deletedIds: Set<string>, currentDraft?: DraftSummary) {
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
