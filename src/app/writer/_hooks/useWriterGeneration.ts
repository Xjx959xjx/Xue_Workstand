"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { saveDraft } from "@/lib/client";
import type {
  AccountDraftInput,
  AccountListItem,
  Draft,
  DraftInput,
  JobRecord,
  JobStartInput,
  ProjectDraftInput,
  ProjectListItem,
  WriteResult
} from "@/lib/types";

type DraftSaveBase = Omit<AccountDraftInput, "content"> | Omit<ProjectDraftInput, "content">;

type UseWriterGenerationInput = {
  activeJobs: JobRecord[];
  activeTitle?: string;
  busy: string;
  hasTaskInput: boolean;
  mode: Draft["mode"];
  normalizedPrompt: string;
  normalizedSourceText: string;
  recentJobs: JobRecord[];
  onDraftSaved?: (draft: Draft) => void;
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
  busy,
  hasTaskInput,
  mode,
  normalizedPrompt,
  normalizedSourceText,
  recentJobs,
  onDraftSaved,
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

  const activeWriteJob = useMemo(() => {
    const candidates = [...activeJobs, ...recentJobs].filter((job) => job.kind === "write-copy");
    return candidates.find((job) => job.id === activeWriteJobId) || activeJobs.find((job) => job.kind === "write-copy") || null;
  }, [activeJobs, activeWriteJobId, recentJobs]);
  const isGenerating = Boolean(activeWriteJob && (activeWriteJob.status === "queued" || activeWriteJob.status === "running"));
  const canGenerate = Boolean(hasTaskInput && !busy && !isGenerating && (targetType === "project" ? selectedProject : selectedAccount));

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
    }
  }, [activeWriteJob, onDraftSaved, refresh, setBusy, setNotice, useWebResearch]);

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
        title: mode === "topic" ? "生成主题文案" : "改写文案",
        inputSummary: activeTitle ? `${activeTitle} · ${mode === "topic" ? "主题写作" : "文案改写"}` : undefined,
        href: "/writer",
        input: {
          targetType,
          platform: targetType === "account" ? selectedAccount?.platform : undefined,
          accountId: targetType === "account" ? selectedAccount?.id : undefined,
          projectId: targetType === "project" ? selectedProject?.id : undefined,
          mode,
          prompt: normalizedPrompt,
          sourceText: normalizedSourceText,
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
    targetType,
    useWebResearch
  ]);

  const handleOpenAssets = useCallback(async () => {
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

  return {
    canGenerate,
    copyLast,
    generateProgress,
    generateStage,
    handleGenerate,
    handleOpenAssets,
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
