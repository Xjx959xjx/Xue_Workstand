"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { saveDraft } from "@/lib/client";
import { buildWriterDraftHref } from "@/lib/draft-links";
import { writeCopySourceKey } from "@/lib/job-scope";
import type {
  AccountDraftInput,
  AccountListItem,
  Draft,
  DraftVersion,
  JobRecord,
  JobStartInput,
  ProjectDraftInput,
  ProjectListItem,
  WriteResult,
  WriteRevisionScope
} from "@/lib/types";

type DraftSaveBase = Omit<AccountDraftInput, "assets" | "content"> | Omit<ProjectDraftInput, "assets" | "content">;
type DraftSaveInput = Omit<AccountDraftInput, "assets"> | Omit<ProjectDraftInput, "assets">;
const PENDING_WRITE_JOB_STORAGE_KEY = "style-workbench-pending-write-job";

type UseWriterGenerationInput = {
  activeJobs: JobRecord[];
  activeTitle?: string;
  busy: string;
  hasTaskInput: boolean;
  mode: Draft["mode"];
  normalizedPrompt: string;
  normalizedSourceText: string;
  supportDocLinks: string;
  recentJobs: JobRecord[];
  revisionInstruction: string;
  revisionScope: WriteRevisionScope;
  selectedText: string;
  onDraftSaved?: (draft: Draft) => void;
  onRevisionCompleted?: () => void;
  cancelTask: (jobId: string) => Promise<JobRecord>;
  refresh: () => Promise<void>;
  routerPush: (href: string) => void;
  routerReplace: (href: string, options?: { scroll?: boolean }) => void;
  selectedAccount: AccountListItem | null;
  selectedProject: ProjectListItem | null;
  setBusy: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  startTask: (input: JobStartInput) => Promise<JobRecord>;
  targetType: "account" | "project";
  useWebResearch: boolean;
};

export function useWriterGeneration({
  activeJobs,
  activeTitle,
  busy,
  hasTaskInput,
  mode,
  normalizedPrompt,
  normalizedSourceText,
  supportDocLinks,
  recentJobs,
  revisionInstruction,
  revisionScope,
  selectedText,
  onDraftSaved,
  onRevisionCompleted,
  cancelTask,
  refresh,
  routerPush,
  routerReplace,
  selectedAccount,
  selectedProject,
  setBusy,
  setNotice,
  startTask,
  targetType,
  useWebResearch
}: UseWriterGenerationInput) {
  const [lastContent, setLastContent] = useState("");
  const [lastResearch, setLastResearch] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [lastDraftBase, setLastDraftBase] = useState<DraftSaveBase | null>(null);
  const [lastDraftId, setLastDraftId] = useState("");
  const [generateStage, setGenerateStage] = useState("");
  const [generateProgress, setGenerateProgress] = useState(0);
  const [activeWriteJobId, setActiveWriteJobId] = useState(readPendingWriteJobId);
  const generationBaseContentRef = useRef("");
  const handledWriteJobsRef = useRef<Set<string>>(new Set());
  const reportedHydrationErrorsRef = useRef<Set<string>>(new Set());
  const writeJobSourceKey = useMemo(
    () =>
      writeCopySourceKey({
        action: "create",
        targetType,
        platform: targetType === "account" ? selectedAccount?.platform : undefined,
        accountId: targetType === "account" ? selectedAccount?.id : undefined,
        projectId: targetType === "project" ? selectedProject?.id : undefined,
        mode,
        prompt: normalizedPrompt,
        sourceText: normalizedSourceText,
        supportDocLinks,
        useWebResearch
      }),
    [
      mode,
      normalizedPrompt,
      normalizedSourceText,
      selectedAccount?.id,
      selectedAccount?.platform,
      selectedProject?.id,
      supportDocLinks,
      targetType,
      useWebResearch
    ]
  );

  const writeJobCandidates = useMemo(
    () => [...activeJobs, ...recentJobs].filter((job) => job.kind === "write-copy"),
    [activeJobs, recentJobs]
  );
  const activeWriteJob = useMemo(() => {
    const tracked = writeJobCandidates.find((job) => job.id === activeWriteJobId);
    if (tracked) return tracked;
    return writeJobCandidates.find((job) =>
      isActiveJob(job) && isCurrentWriteJob(job, targetType, selectedAccount?.id, selectedProject?.id, writeJobSourceKey)
    ) || null;
  }, [activeWriteJobId, selectedAccount?.id, selectedProject?.id, targetType, writeJobCandidates, writeJobSourceKey]);
  const isGenerating = Boolean(activeWriteJob && isActiveJob(activeWriteJob));
  const canGenerate = Boolean(hasTaskInput && !busy && !isGenerating && (targetType === "project" ? selectedProject : selectedAccount));
  const canRevise = Boolean(
    lastDraftId &&
    lastDraftBase &&
    lastContent.trim() &&
    revisionInstruction.trim() &&
    !busy &&
    !isGenerating &&
    (revisionScope === "full" || selectedText.trim())
  );
  const canStopGenerate = Boolean(activeWriteJobId && isGenerating);
  const hasUnsavedChanges = Boolean(lastDraftId && lastContent !== lastSavedContent);

  useEffect(() => {
    if (!activeWriteJob) return;
    setActiveWriteJobId(activeWriteJob.id);
    setGenerateStage(activeWriteJob.message || "正在生成文案");
    setGenerateProgress(activeWriteJob.progress || 0);
    if (activeWriteJob.partialText) setLastContent(activeWriteJob.partialText);

    if (isActiveJob(activeWriteJob)) {
      setBusy("generate");
      return;
    }

    const result = activeWriteJob.result as WriteResult | undefined;
    const isWaitingForHydratedResult = activeWriteJob.status === "completed" && !result && Boolean((activeWriteJob as { hasResult?: boolean }).hasResult);
    if (isWaitingForHydratedResult) {
      if (activeWriteJob.error) {
        restoreGenerationBase();
        setBusy("");
        setGenerateStage("结果同步失败");
        setGenerateProgress(100);
        if (!reportedHydrationErrorsRef.current.has(activeWriteJob.id)) {
          reportedHydrationErrorsRef.current.add(activeWriteJob.id);
          setNotice(activeWriteJob.error);
        }
        return;
      }
      setGenerateStage("正在同步生成结果");
      setGenerateProgress(100);
      return;
    }

    if (handledWriteJobsRef.current.has(activeWriteJob.id)) return;
    handledWriteJobsRef.current.add(activeWriteJob.id);
    clearPendingWriteJobId(activeWriteJob.id);
    setActiveWriteJobId("");
    setBusy("");

    if (activeWriteJob.status === "completed") {
      if (result) {
        generationBaseContentRef.current = "";
        setLastContent(result.content);
        setLastResearch(result.research || "");
        setLastSavedContent(result.draft ? result.content : "");
        setLastDraftId(result.draft?.id || "");
        setLastDraftBase(result.draft ? draftToSaveBase(result.draft) : null);
        if (result.draft) {
          onDraftSaved?.(result.draft);
          routerReplace(buildWriterDraftHref(result.draft), { scroll: false });
          if (result.draft.version?.origin === "revision") onRevisionCompleted?.();
          void refresh();
        }
        setNotice(
          `${result.fallback ? result.fallbackReason || "模型暂不可用，已用本地模板生成，可继续编辑。" : `已调用 ${result.usedModel}${useWebResearch ? "，已启用联网检索" : ""}。`}已自动保存到版本历史。`
        );
      } else {
        generationBaseContentRef.current = "";
        setNotice("文案生成完成。");
      }
      setGenerateStage("生成完成");
      setGenerateProgress(100);
      return;
    }

    if (activeWriteJob.status === "failed") {
      restoreGenerationBase();
      setNotice(activeWriteJob.error || "生成失败，请检查模型配置、代理或输入内容后重试。");
      setGenerateStage("生成失败");
      setGenerateProgress(100);
      return;
    }

    if (activeWriteJob.status === "cancelled") {
      restoreGenerationBase();
      setNotice("已停止本次生成，版本历史不会新增未完成内容。");
      setGenerateStage("已停止");
      setGenerateProgress(Math.max(0, activeWriteJob.progress || 0));
    }

    function restoreGenerationBase() {
      if (!generationBaseContentRef.current) return;
      setLastContent(generationBaseContentRef.current);
      generationBaseContentRef.current = "";
    }
  }, [activeWriteJob, onDraftSaved, onRevisionCompleted, refresh, routerReplace, setBusy, setNotice, useWebResearch]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    generationBaseContentRef.current = "";
    setBusy("generate");
    setNotice("");
    setGenerateStage("准备写作任务");
    setGenerateProgress(6);
    setLastContent("");
    setLastResearch("");

    try {
      const job = await startTask({
        kind: "write-copy",
        title: "生成文案",
        inputSummary: activeTitle ? `${activeTitle} · ${mode === "topic" ? "自由输入" : "素材改写"}` : undefined,
        href: "/writer",
        input: {
          action: "create",
          targetType,
          platform: targetType === "account" ? selectedAccount?.platform : undefined,
          accountId: targetType === "account" ? selectedAccount?.id : undefined,
          projectId: targetType === "project" ? selectedProject?.id : undefined,
          mode,
          prompt: normalizedPrompt,
          sourceText: normalizedSourceText,
          supportDocLinks: supportDocLinks.trim() || undefined,
          save: true,
          useWebResearch
        }
      });
      rememberPendingWriteJobId(job.id);
      setActiveWriteJobId(job.id);
      setGenerateStage(job.message);
      setGenerateProgress(job.progress);
      setNotice("文案生成已在后台开始，可以切换到其他模块。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成失败，请检查模型配置、代理或输入内容后重试。");
      setGenerateStage("任务启动失败");
      setGenerateProgress(0);
      setActiveWriteJobId("");
      setBusy("");
    }
  }, [
    activeTitle,
    canGenerate,
    mode,
    normalizedPrompt,
    normalizedSourceText,
    selectedAccount,
    selectedProject,
    setBusy,
    setNotice,
    startTask,
    supportDocLinks,
    targetType,
    useWebResearch
  ]);

  const handleRevise = useCallback(async () => {
    if (!canRevise || !lastDraftBase) return;
    generationBaseContentRef.current = lastContent;
    setBusy("generate");
    setNotice("");
    setGenerateStage("准备续改任务");
    setGenerateProgress(6);

    const isProject = lastDraftBase.targetType === "project";
    try {
      const job = await startTask({
        kind: "write-copy",
        title: "继续修改文案",
        inputSummary: `V${(lastDraftBase.version?.revision || 1) + 1} · ${revisionScope === "selection" ? "选中段落" : "全文"}`,
        href: "/writer",
        input: {
          action: "revise",
          targetType: isProject ? "project" : "account",
          platform: isProject ? undefined : lastDraftBase.platform,
          accountId: isProject ? undefined : lastDraftBase.accountId,
          projectId: isProject ? lastDraftBase.projectId : undefined,
          mode: lastDraftBase.mode,
          prompt: lastDraftBase.prompt,
          sourceText: lastDraftBase.input,
          save: true,
          parentDraftId: lastDraftId,
          currentContent: lastContent,
          revisionInstruction: revisionInstruction.trim(),
          revisionScope,
          selectedText: revisionScope === "selection" ? selectedText : undefined
        }
      });
      rememberPendingWriteJobId(job.id);
      setActiveWriteJobId(job.id);
      setGenerateStage(job.message);
      setGenerateProgress(job.progress);
      setNotice("续改任务已开始，完成后会新增一个版本。");
    } catch (err) {
      generationBaseContentRef.current = "";
      setNotice(err instanceof Error ? err.message : "续改任务启动失败，请稍后重试。");
      setGenerateStage("任务启动失败");
      setGenerateProgress(0);
      setActiveWriteJobId("");
      setBusy("");
    }
  }, [
    canRevise,
    lastContent,
    lastDraftBase,
    lastDraftId,
    revisionInstruction,
    revisionScope,
    selectedText,
    setBusy,
    setNotice,
    startTask
  ]);

  const handleStopGenerate = useCallback(async () => {
    if (!activeWriteJobId) return;
    try {
      await cancelTask(activeWriteJobId);
      setNotice("正在停止生成任务…");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "停止生成失败，请稍后重试。");
    }
  }, [activeWriteJobId, cancelTask, setNotice]);

  const saveCurrentContent = useCallback(async () => {
    if (!lastContent || !lastDraftBase) return null;
    if (lastDraftId && lastSavedContent === lastContent) return { draftId: lastDraftId, draft: null };

    const version = nextManualDraftVersion(lastDraftBase, lastDraftId);
    const payload: DraftSaveInput = lastDraftBase.targetType === "project"
      ? { ...lastDraftBase, version, content: lastContent }
      : { ...lastDraftBase, version, content: lastContent };
    const draft = await saveDraft(payload);
    setLastDraftId(draft.id);
    setLastSavedContent(lastContent);
    setLastDraftBase(draftToSaveBase(draft));
    onDraftSaved?.(draft);
    routerReplace(buildWriterDraftHref(draft), { scroll: false });
    await refresh();
    return { draftId: draft.id, draft };
  }, [lastContent, lastDraftBase, lastDraftId, lastSavedContent, onDraftSaved, refresh, routerReplace]);

  const handleSaveEdit = useCallback(async () => {
    if (!hasUnsavedChanges) return;
    setBusy("save-draft");
    setNotice("");
    try {
      const saved = await saveCurrentContent();
      if (saved?.draft) setNotice(`手动编辑已保存为 V${saved.draft.version?.revision || 1}。`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "保存编辑失败，请稍后重试。");
    } finally {
      setBusy("");
    }
  }, [hasUnsavedChanges, saveCurrentContent, setBusy, setNotice]);

  const handleOpenAssets = useCallback(async () => {
    if (!lastContent || !lastDraftBase) return;
    setBusy("assets");
    setNotice("");
    try {
      const saved = await saveCurrentContent();
      if (!saved?.draftId) throw new Error("当前稿件尚未保存");
      routerPush(`/assets?draftId=${encodeURIComponent(saved.draftId)}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "打开评论生成失败，请先保存当前结果后重试。");
    } finally {
      setBusy("");
    }
  }, [lastContent, lastDraftBase, routerPush, saveCurrentContent, setBusy, setNotice]);

  const copyLast = useCallback(async () => {
    if (!lastContent) return;
    await navigator.clipboard.writeText(lastContent);
    setNotice("生成结果已复制到剪贴板。");
  }, [lastContent, setNotice]);

  const loadDraftResult = useCallback((draft: Draft) => {
    generationBaseContentRef.current = "";
    setLastContent(draft.content);
    setLastResearch(draft.research || "");
    setLastSavedContent(draft.content);
    setLastDraftId(draft.id);
    setLastDraftBase(draftToSaveBase(draft));
    setGenerateStage("");
    setGenerateProgress(100);
  }, []);

  const clearDraftResult = useCallback(() => {
    generationBaseContentRef.current = "";
    setLastContent("");
    setLastResearch("");
    setLastSavedContent("");
    setLastDraftBase(null);
    setLastDraftId("");
    setGenerateStage("");
    setGenerateProgress(0);
    clearPendingWriteJobId(activeWriteJobId);
    setActiveWriteJobId("");
  }, [activeWriteJobId]);

  return {
    canGenerate,
    canRevise,
    canStopGenerate,
    clearDraftResult,
    copyLast,
    generateProgress,
    generateStage,
    handleContentChange: setLastContent,
    handleGenerate,
    handleOpenAssets,
    handleRevise,
    handleSaveEdit,
    handleStopGenerate,
    hasUnsavedChanges,
    lastContent,
    lastDraftBase,
    lastDraftId,
    lastDraftVersion: lastDraftBase?.version,
    lastResearch,
    loadDraftResult
  };
}

function nextManualDraftVersion(base: DraftSaveBase, parentDraftId: string): DraftVersion {
  return {
    sessionId: base.version?.sessionId || parentDraftId,
    parentDraftId,
    revision: (base.version?.revision || 1) + 1,
    instruction: "手动编辑",
    contextFingerprint: base.version?.contextFingerprint || `legacy-${parentDraftId}`,
    promptVersion: base.version?.promptVersion || "writer-v2",
    origin: "manual_edit"
  };
}

function draftToSaveBase(draft: Draft): DraftSaveBase {
  const shared = {
    title: draft.title,
    mode: draft.mode,
    prompt: draft.prompt,
    input: draft.input,
    supportDocLinks: draft.supportDocLinks,
    brief: draft.brief,
    research: draft.research,
    sourceDigest: draft.sourceDigest,
    version: draft.version
  };

  if (draft.targetType === "project") {
    return {
      ...shared,
      targetType: "project",
      projectId: draft.projectId,
      projectName: draft.projectName,
      styleRef: draft.styleRef
    };
  }

  return {
    ...shared,
    platform: draft.platform,
    accountId: draft.accountId,
    accountName: draft.accountName,
    styleRef: draft.styleRef
  };
}

function isCurrentWriteJob(
  job: JobRecord,
  targetType: "account" | "project",
  accountId?: string,
  projectId?: string,
  sourceKey?: string
) {
  if (job.scope?.targetType !== targetType) return false;
  if (sourceKey && job.scope.sourceKey !== sourceKey) return false;
  if (targetType === "account") return Boolean(accountId && job.scope.accountId === accountId);
  return Boolean(projectId && job.scope.projectId === projectId);
}

function isActiveJob(job: JobRecord) {
  return job.status === "queued" || job.status === "running";
}

function readPendingWriteJobId() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(PENDING_WRITE_JOB_STORAGE_KEY) || "";
}

function rememberPendingWriteJobId(jobId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_WRITE_JOB_STORAGE_KEY, jobId);
}

function clearPendingWriteJobId(jobId: string) {
  if (typeof window === "undefined" || !jobId) return;
  if (window.sessionStorage.getItem(PENDING_WRITE_JOB_STORAGE_KEY) === jobId) {
    window.sessionStorage.removeItem(PENDING_WRITE_JOB_STORAGE_KEY);
  }
}
