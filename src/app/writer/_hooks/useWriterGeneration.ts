"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { saveDraft } from "@/lib/client";
import { writeCopySourceKey } from "@/lib/job-scope";
import type {
  AccountDraftInput,
  AccountListItem,
  Draft,
  JobRecord,
  JobStartInput,
  ProjectDraftInput,
  ProjectListItem,
  WriteResult
} from "@/lib/types";

type DraftSaveBase = Omit<AccountDraftInput, "assets" | "content"> | Omit<ProjectDraftInput, "assets" | "content">;
type DraftSaveInput = Omit<AccountDraftInput, "assets"> | Omit<ProjectDraftInput, "assets">;

type UseWriterGenerationInput = {
  activeJobs: JobRecord[];
  activeTitle?: string;
  brief: string;
  busy: string;
  hasTaskInput: boolean;
  mode: Draft["mode"];
  normalizedPrompt: string;
  normalizedSourceText: string;
  preparedSourceText: string;
  supportDocLinks: string;
  recentJobs: JobRecord[];
  onGenerationResult?: (result: WriteResult) => void;
  onDraftSaved?: (draft: Draft) => void;
  cancelTask: (jobId: string) => Promise<JobRecord>;
  refresh: () => Promise<void>;
  routerPush: (href: string) => void;
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
  brief,
  busy,
  hasTaskInput,
  mode,
  normalizedPrompt,
  normalizedSourceText,
  preparedSourceText,
  supportDocLinks,
  recentJobs,
  onGenerationResult,
  onDraftSaved,
  cancelTask,
  refresh,
  routerPush,
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
  const [activeWriteJobId, setActiveWriteJobId] = useState("");
  const handledWriteJobsRef = useRef<Set<string>>(new Set());
  const reportedHydrationErrorsRef = useRef<Set<string>>(new Set());
  const writeJobSourceKey = useMemo(
    () =>
      writeCopySourceKey({
        targetType,
        platform: targetType === "account" ? selectedAccount?.platform : undefined,
        accountId: targetType === "account" ? selectedAccount?.id : undefined,
        projectId: targetType === "project" ? selectedProject?.id : undefined,
        mode,
        prompt: normalizedPrompt,
        sourceText: preparedSourceText || normalizedSourceText,
        supportDocLinks,
        brief,
        useWebResearch
      }),
    [
      brief,
      mode,
      normalizedPrompt,
      normalizedSourceText,
      preparedSourceText,
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
    if (tracked && isCurrentWriteJob(tracked, targetType, selectedAccount?.id, selectedProject?.id)) return tracked;
    return writeJobCandidates.find((job) =>
      isActiveJob(job) && isCurrentWriteJob(job, targetType, selectedAccount?.id, selectedProject?.id, writeJobSourceKey)
    ) || null;
  }, [activeWriteJobId, selectedAccount?.id, selectedProject?.id, targetType, writeJobCandidates, writeJobSourceKey]);
  const activeWriteJobIdMismatch = useMemo(() => {
    if (!activeWriteJobId) return false;
    const tracked = writeJobCandidates.find((job) => job.id === activeWriteJobId);
    return Boolean(tracked && !isCurrentWriteJob(tracked, targetType, selectedAccount?.id, selectedProject?.id));
  }, [activeWriteJobId, selectedAccount?.id, selectedProject?.id, targetType, writeJobCandidates]);
  const isGenerating = Boolean(activeWriteJob && (activeWriteJob.status === "queued" || activeWriteJob.status === "running"));
  const canGenerate = Boolean(hasTaskInput && !busy && !isGenerating && (targetType === "project" ? selectedProject : selectedAccount));
  const canStopGenerate = Boolean(activeWriteJobId && isGenerating);

  useEffect(() => {
    if (!activeWriteJobIdMismatch || busy !== "generate") return;
    setActiveWriteJobId("");
    setBusy("");
  }, [activeWriteJobIdMismatch, busy, setBusy]);

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

    const result = activeWriteJob.result as WriteResult | undefined;
    const isWaitingForHydratedResult = activeWriteJob.status === "completed" && !result && Boolean((activeWriteJob as { hasResult?: boolean }).hasResult);
    if (isWaitingForHydratedResult) {
      if (activeWriteJob.error) {
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
    setBusy("");

    if (activeWriteJob.status === "completed") {
      if (result) {
        setLastContent(result.content);
        setLastResearch(result.research || "");
        setLastSavedContent(result.draft ? result.content : "");
        setLastDraftId(result.draft?.id || "");
        setLastDraftBase(result.draft ? draftToSaveBase(result.draft) : null);
        onGenerationResult?.(result);
        if (result.draft) {
          onDraftSaved?.(result.draft);
          void refresh();
        }
        setNotice(
          `${result.fallback ? result.fallbackReason || "模型暂不可用，已用本地模板生成，可继续编辑。" : `已调用 ${result.usedModel}${useWebResearch ? "，已启用联网检索" : ""}。`}已自动保存到历史记录。`
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
      return;
    }

    if (activeWriteJob.status === "cancelled") {
      setNotice("已停止本次生成，历史记录不会新增未完成内容。");
      setGenerateStage("已停止");
      setGenerateProgress(Math.max(0, activeWriteJob.progress || 0));
    }
  }, [activeWriteJob, onDraftSaved, onGenerationResult, refresh, setBusy, setNotice, useWebResearch]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
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
          targetType,
          platform: targetType === "account" ? selectedAccount?.platform : undefined,
          accountId: targetType === "account" ? selectedAccount?.id : undefined,
          projectId: targetType === "project" ? selectedProject?.id : undefined,
          mode,
          prompt: normalizedPrompt,
          sourceText: preparedSourceText || normalizedSourceText,
          supportDocLinks: supportDocLinks.trim() || undefined,
          brief: brief.trim() || undefined,
          save: true,
          useWebResearch
        }
      });
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
    preparedSourceText,
    brief,
    supportDocLinks,
    selectedAccount,
    selectedProject,
    setBusy,
    setNotice,
    startTask,
    targetType,
    useWebResearch
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

  const handleOpenAssets = useCallback(async () => {
    if (!lastContent || !lastDraftBase) return;
    setBusy("assets");
    setNotice("");
    try {
      let draftId = lastDraftId;
      if (!draftId || lastSavedContent !== lastContent) {
        const payload: DraftSaveInput =
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
        onDraftSaved?.(draft);
        await refresh();
      }
      routerPush(`/assets?draftId=${encodeURIComponent(draftId)}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "打开评论生成失败，请先保存当前结果后重试。");
    } finally {
      setBusy("");
    }
  }, [lastContent, lastDraftBase, lastDraftId, lastSavedContent, onDraftSaved, refresh, routerPush, setBusy, setNotice]);

  const copyLast = useCallback(async () => {
    if (!lastContent) return;
    await navigator.clipboard.writeText(lastContent);
    setNotice("生成结果已复制到剪贴板。");
  }, [lastContent, setNotice]);

  const loadDraftResult = useCallback((draft: Draft) => {
    setLastContent(draft.content);
    setLastResearch("");
    setLastSavedContent(draft.content);
    setLastDraftId(draft.id);
    setLastDraftBase(draftToSaveBase(draft));
    setGenerateStage("");
    setGenerateProgress(100);
  }, []);

  const clearDraftResult = useCallback(() => {
    setLastContent("");
    setLastResearch("");
    setLastSavedContent("");
    setLastDraftBase(null);
    setLastDraftId("");
    setGenerateStage("");
    setGenerateProgress(0);
    setActiveWriteJobId("");
  }, []);

  return {
    canGenerate,
    canStopGenerate,
    clearDraftResult,
    copyLast,
    generateProgress,
    generateStage,
    handleGenerate,
    handleOpenAssets,
    handleStopGenerate,
    lastContent,
    lastDraftBase,
    lastDraftId,
    lastResearch,
    loadDraftResult
  };
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
      supportDocLinks: draft.supportDocLinks,
      brief: draft.brief,
      sourceDigest: draft.sourceDigest,
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
    supportDocLinks: draft.supportDocLinks,
    brief: draft.brief,
    sourceDigest: draft.sourceDigest,
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
