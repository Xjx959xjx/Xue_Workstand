"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { hasSourceInput, type BusyState } from "../_components/asset-view-utils";
import type { Draft, EngagementRecord, EngagementSourceType, JobRecord, JobStartInput } from "@/lib/types";

type UseEngagementGenerationInput = {
  activeJobs: JobRecord[];
  commentCount: number;
  danmakuCount: number;
  includeComments: boolean;
  includeDanmaku: boolean;
  recentJobs: JobRecord[];
  selectedDraft: Draft | null;
  sourceType: EngagementSourceType;
  startTask: (input: JobStartInput) => Promise<JobRecord>;
  textInput: string;
  textTitle: string;
  urlInput: string;
  busy: BusyState;
  setBusy: Dispatch<SetStateAction<BusyState>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useEngagementGeneration({
  activeJobs,
  busy,
  commentCount,
  danmakuCount,
  includeComments,
  includeDanmaku,
  recentJobs,
  selectedDraft,
  setBusy,
  setNotice,
  sourceType,
  startTask,
  textInput,
  textTitle,
  urlInput
}: UseEngagementGenerationInput) {
  const [resultRecord, setResultRecord] = useState<EngagementRecord | null>(null);
  const [activeEngagementJobId, setActiveEngagementJobId] = useState("");
  const [handledEngagementJobIds, setHandledEngagementJobIds] = useState<string[]>([]);
  const activeTitle = resultRecord?.title || selectedDraft?.title || "评论生成";

  const engagementJob = useMemo(
    () => findTaskJob([...activeJobs, ...recentJobs], activeEngagementJobId, "engagement"),
    [activeEngagementJobId, activeJobs, recentJobs]
  );
  const isGenerating = Boolean(engagementJob && (engagementJob.status === "queued" || engagementJob.status === "running"));
  const canGenerate =
    !busy && !isGenerating && (includeComments || includeDanmaku) && hasSourceInput(sourceType, selectedDraft, textInput, urlInput);

  useEffect(() => {
    if (!engagementJob) return;
    setActiveEngagementJobId(engagementJob.id);
    if (engagementJob.status === "running" || engagementJob.status === "queued") {
      setBusy("generate");
      return;
    }
    if (handledEngagementJobIds.includes(engagementJob.id)) return;
    setHandledEngagementJobIds((current) => [...current, engagementJob.id]);
    setBusy("");
    if (engagementJob.status === "completed") {
      const result = engagementJob.result as { record?: EngagementRecord } | undefined;
      if (result?.record) {
        setResultRecord(result.record);
        setNotice(buildSuccessMessage(result.record));
      } else {
        setNotice("互动素材已生成。");
      }
      return;
    }
    if (engagementJob.status === "failed") {
      setNotice(engagementJob.error || "生成评论失败，请检查输入和模型配置。");
    }
  }, [engagementJob, handledEngagementJobIds, setBusy, setNotice]);

  const handleGenerate = useCallback(async () => {
    if (!includeComments && !includeDanmaku) {
      setNotice("请至少选择评论或弹幕。");
      return;
    }

    setBusy("generate");
    setNotice("");
    try {
      const options = {
        includeComments,
        commentCount,
        includeDanmaku,
        danmakuCount
      };
      const input =
        sourceType === "draft"
          ? {
              sourceType,
              draftId: selectedDraft?.id || "",
              ...options
            }
          : sourceType === "text"
            ? {
                sourceType,
                title: textTitle,
                text: textInput,
                ...options
              }
            : {
                sourceType,
                url: urlInput,
                ...options
              };
      const job = await startTask({
        kind: "engagement",
        title: "生成评论素材",
        inputSummary: activeTitle,
        href: "/assets",
        input
      });
      setActiveEngagementJobId(job.id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成评论失败，请检查输入和模型配置。");
    }
  }, [
    activeTitle,
    commentCount,
    danmakuCount,
    includeComments,
    includeDanmaku,
    selectedDraft?.id,
    setBusy,
    setNotice,
    sourceType,
    startTask,
    textInput,
    textTitle,
    urlInput
  ]);

  return {
    canGenerate,
    activeTitle,
    handleGenerate,
    resultRecord,
    setResultRecord
  };
}

function buildSuccessMessage(record: EngagementRecord) {
  const commentCount = record.comments?.items.length || 0;
  const danmakuCount = record.danmaku?.items.length || 0;
  if (commentCount && danmakuCount) return `已生成 ${commentCount} 条评论和 ${danmakuCount} 条弹幕。`;
  if (commentCount) return `已生成 ${commentCount} 条评论。`;
  return `已生成 ${danmakuCount} 条弹幕。`;
}

function findTaskJob(jobs: JobRecord[], jobId: string, kind: JobRecord["kind"]) {
  return jobs.find((job) => job.id === jobId && job.kind === kind) || jobs.find((job) => job.kind === kind && (job.status === "queued" || job.status === "running")) || null;
}
