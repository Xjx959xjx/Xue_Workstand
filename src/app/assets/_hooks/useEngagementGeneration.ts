"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { engagementSourceKey } from "@/lib/job-scope";
import { extractFirstLinkFromInput, normalizeLinkInput } from "@/lib/platform-links";
import type { EngagementRecord, JobRecord, JobStartInput } from "@/lib/types";
import type { BusyState } from "../_components/asset-view-utils";

type EngagementJobInput = Extract<JobStartInput, { kind: "engagement" }>["input"];

type UseEngagementGenerationInput = {
  activeJobs: JobRecord[];
  commentCount: number;
  danmakuCount: number;
  includeComments: boolean;
  includeDanmaku: boolean;
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
            danmakuCount
          })
      : null,
    [commentCount, danmakuCount, includeComments, includeDanmaku, trimmedSource]
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
      danmakuCount
    });

    setBusy("generate");
    setNotice("");
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
    setBusy,
    setNotice,
    startTask,
    trimmedSource
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

function buildEngagementJobInput(
  rawSource: string,
  options: Pick<Extract<EngagementJobInput, { sourceType: "text" }>, "includeComments" | "commentCount" | "includeDanmaku" | "danmakuCount">
): EngagementJobInput {
  const normalizedUrl = normalizeLinkInput(rawSource, { kind: "video" });
  const extractedUrl = extractFirstLinkFromInput(rawSource, { kind: "video" });
  const strippedSource = rawSource.replace(/[)\]}>，。！？、；;,.!?）】\]]+$/g, "").trim();
  const strippedNoScheme = strippedSource.replace(/^https?:\/\//i, "");
  const normalizedNoScheme = normalizedUrl.replace(/^https?:\/\//i, "");
  const isUrl = Boolean(extractedUrl) && strippedNoScheme === normalizedNoScheme;

  if (isUrl) {
    return {
      sourceType: "url",
      url: normalizedUrl,
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
