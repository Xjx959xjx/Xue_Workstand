"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { engagementSourceKey } from "@/lib/job-scope";
import { extractFirstLinkFromInput } from "@/lib/platform-links";
import type { EngagementGenerationMode, EngagementRecord, JobRecord, JobStartInput } from "@/lib/types";
import type { BusyState } from "../_components/asset-view-utils";

type EngagementJobInput = Extract<JobStartInput, { kind: "engagement" }>["input"];

type UseEngagementGenerationInput = {
  activeJobs: JobRecord[];
  commentCount: number;
  danmakuCount: number;
  includeComments: boolean;
  includeDanmaku: boolean;
  generationMode: EngagementGenerationMode;
  recentJobs: JobRecord[];
  sourceInput: string;
  startTask: (input: JobStartInput) => Promise<JobRecord>;
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
  generationMode,
  recentJobs,
  setBusy,
  setNotice,
  sourceInput,
  startTask
}: UseEngagementGenerationInput) {
  const [resultRecord, setResultRecord] = useState<EngagementRecord | null>(null);
  const [activeEngagementJobId, setActiveEngagementJobId] = useState("");
  const [handledEngagementJobIds, setHandledEngagementJobIds] = useState<string[]>([]);
  const trimmedSource = sourceInput.trim();
  const activeTitle = resultRecord?.title || trimmedSource.slice(0, 32) || "评论生成";
  const currentInput = useMemo(
    () =>
      trimmedSource
        ? buildEngagementJobInput(trimmedSource, {
            includeComments,
            commentCount,
            includeDanmaku,
            danmakuCount,
            generationMode
          })
      : null,
    [commentCount, danmakuCount, generationMode, includeComments, includeDanmaku, trimmedSource]
  );
  const engagementJobCandidates = useMemo(
    () => [...activeJobs, ...recentJobs].filter((job) => job.kind === "engagement"),
    [activeJobs, recentJobs]
  );

  const engagementJob = useMemo(
    () =>
      findTaskJob(
        engagementJobCandidates,
        activeEngagementJobId,
        "engagement",
        currentInput ? (job) => matchesEngagementScope(job, currentInput) : () => false
      ),
    [activeEngagementJobId, currentInput, engagementJobCandidates]
  );
  const isGenerating = Boolean(engagementJob && (engagementJob.status === "queued" || engagementJob.status === "running"));
  const canGenerate = !busy && !isGenerating && (includeComments || includeDanmaku) && Boolean(trimmedSource);
  const previewResult = isGenerating
    ? engagementJob?.result as { previewComments?: NonNullable<EngagementRecord["comments"]>["items"] } | undefined
    : undefined;
  const generationProgress = isGenerating && engagementJob
    ? {
        stage: engagementJob.stage || "prepare",
        message: engagementJob.message,
        progress: engagementJob.progress
      }
    : null;
  const runningPreviewComments = previewResult?.previewComments || [];
  const previewComments = resultRecord && engagementJob?.scope?.engagementRecordId === resultRecord.id
    ? mergePreviewComments(resultRecord.comments?.items || [], runningPreviewComments)
    : runningPreviewComments;

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

    const rawSource = trimmedSource;
    if (!rawSource) {
      setNotice("请先输入链接或文案。");
      return;
    }

    const input = buildEngagementJobInput(rawSource, {
      includeComments,
      commentCount,
      includeDanmaku,
      danmakuCount,
      generationMode
    });

    setBusy("generate");
    setNotice("");
    setResultRecord(null);
    try {
      const job = await startTask({
        kind: "engagement",
        title: "生成评论素材",
        inputSummary: input.sourceType === "url" ? input.url : rawSource.slice(0, 48),
        href: "/assets",
        input
      });
      setActiveEngagementJobId(job.id);
    } catch (err) {
      setBusy("");
      setNotice(err instanceof Error ? err.message : "生成评论失败，请检查输入和模型配置。");
    }
  }, [
    commentCount,
    danmakuCount,
    includeComments,
    includeDanmaku,
    generationMode,
    setBusy,
    setNotice,
    setResultRecord,
    startTask,
    trimmedSource
  ]);

  const handleSupplement = useCallback(async (record: EngagementRecord) => {
    const requestedCount = record.comments?.requestedCount || record.options.commentCount;
    const actualCount = record.comments?.items.length || 0;
    const missingCount = Math.max(requestedCount - actualCount, 0);
    if (!missingCount) {
      setNotice("当前评论数量已经补齐。");
      return;
    }

    setBusy("generate");
    setNotice("");
    try {
      const job = await startTask({
        kind: "engagement",
        title: "补齐评论素材",
        inputSummary: `${record.title} · 缺 ${missingCount} 条`,
        href: "/assets",
        input: {
          sourceType: "record",
          recordId: record.id,
          includeComments: true,
          commentCount: missingCount,
          includeDanmaku: false,
          danmakuCount: 1,
          generationMode: record.options.generationMode || generationMode
        }
      });
      setActiveEngagementJobId(job.id);
    } catch (err) {
      setBusy("");
      setNotice(err instanceof Error ? err.message : "补齐评论失败，请检查模型配置。");
    }
  }, [generationMode, setBusy, setNotice, startTask]);

  return {
    canGenerate,
    activeTitle,
    generationProgress,
    handleGenerate,
    handleSupplement,
    previewComments,
    resultRecord,
    setResultRecord
  };
}

function buildSuccessMessage(record: EngagementRecord) {
  const commentCount = record.comments?.items.length || 0;
  const requestedCount = record.comments?.requestedCount || record.options.commentCount;
  const danmakuCount = record.danmaku?.items.length || 0;
  const commentLabel = requestedCount && commentCount < requestedCount
    ? `${commentCount}/${requestedCount} 条评论，可继续补齐`
    : `${commentCount} 条评论`;
  if (commentCount && danmakuCount) return `已生成 ${commentLabel}和 ${danmakuCount} 条弹幕。`;
  if (commentCount) return `已生成 ${commentLabel}。`;
  return `已生成 ${danmakuCount} 条弹幕。`;
}

function buildEngagementJobInput(
  rawSource: string,
  options: Pick<Extract<EngagementJobInput, { sourceType: "text" }>, "includeComments" | "commentCount" | "includeDanmaku" | "danmakuCount" | "generationMode">
): EngagementJobInput {
  const extractedUrl = extractFirstLinkFromInput(rawSource, { kind: "video" });

  if (extractedUrl) {
    return {
      sourceType: "url",
      url: extractedUrl,
      ...options
    };
  }

  return {
    sourceType: "text",
    text: rawSource,
    ...options
  };
}

function matchesEngagementScope(job: JobRecord, input: EngagementJobInput) {
  if (input.sourceType === "draft") return Boolean(job.scope?.targetType === "draft" && job.scope.draftId === input.draftId);
  if (input.sourceType === "record") {
    return Boolean(job.scope?.targetType === "engagement" && job.scope.engagementRecordId === input.recordId);
  }
  return job.scope?.targetType === input.sourceType && job.scope.sourceKey === engagementSourceKey(input);
}

function findTaskJob(
  jobs: JobRecord[],
  jobId: string,
  kind: JobRecord["kind"],
  matchesScope: (job: JobRecord) => boolean
) {
  if (jobId) {
    const tracked = jobs.find((job) => job.id === jobId && job.kind === kind);
    if (tracked) return tracked;
  }
  return jobs.find((job) => job.kind === kind && isActiveJob(job) && matchesScope(job)) || null;
}

function isActiveJob(job: JobRecord) {
  return job.status === "queued" || job.status === "running";
}

function mergePreviewComments(
  existing: NonNullable<EngagementRecord["comments"]>["items"],
  preview: NonNullable<EngagementRecord["comments"]>["items"]
) {
  const seen = new Set(existing.map((item) => item.text.replace(/\s+/g, "").toLowerCase()));
  return [...existing, ...preview.filter((item) => {
    const key = item.text.replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}
