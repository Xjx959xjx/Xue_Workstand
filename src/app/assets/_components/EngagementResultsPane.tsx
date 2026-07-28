"use client";

import { Download, ListPlus } from "lucide-react";
import { AssetTextList } from "./AssetTextList";
import type { BusyState } from "./asset-view-utils";
import { formatTime } from "./asset-view-utils";
import type { EngagementRecord } from "@/lib/types";

type EngagementResultsPaneProps = {
  busy: BusyState;
  includeDanmaku: boolean;
  previewComments: NonNullable<EngagementRecord["comments"]>["items"];
  resultRecord: EngagementRecord | null;
  onCopyText: (text: string, message: string) => void;
  onExportWord: (record: EngagementRecord) => void;
  onSupplement: (record: EngagementRecord) => void;
  onPublishAssetText: (kind: "comments" | "danmaku", items: string[], emptyMessage: string) => void;
};

export function EngagementResultsPane({
  busy,
  includeDanmaku,
  previewComments,
  resultRecord,
  onCopyText,
  onExportWord,
  onSupplement,
  onPublishAssetText
}: EngagementResultsPaneProps) {
  const activeComments = previewComments.length ? previewComments : resultRecord?.comments?.items || [];
  const activeDanmaku = resultRecord?.danmaku?.items || [];
  const diagnostics = resultRecord?.comments?.diagnostics;
  const generation = diagnostics?.generation;
  const sourceBrief = diagnostics?.sourceBrief;
  const entityGuard = diagnostics?.entityGuard;
  const relatedResearch = diagnostics?.relatedResearch;
  const requestedCommentCount = resultRecord?.comments?.requestedCount || resultRecord?.options.commentCount || 0;
  const actualCommentCount = resultRecord?.comments?.items.length || 0;
  const missingCommentCount = Math.max(requestedCommentCount - actualCommentCount, 0);
  const isGenerating = busy === "generate";

  return (
    <section className="engagement-result-pane">
      <div className="pane-body engagement-results-pane">
        {generation && !isGenerating ? (
          <div className="engagement-diagnostics">
            {resultRecord?.comments?.generationMode ? (
              <span>{resultRecord.comments.generationMode === "reference" ? "参考热评" : "快速自然"}</span>
            ) : null}
            <span>{generation.mode === "keyword_local" ? "关键词生成" : `${generation.batchCount} 批增强`}</span>
            <span>完成 {actualCommentCount || generation.completedCount}/{requestedCommentCount || generation.requestedCount}</span>
            {resultRecord?.comments?.timings ? <span>耗时 {formatDuration(resultRecord.comments.timings.totalMs)}</span> : null}
            {resultRecord?.comments?.timings?.cacheHits.length ? <span>缓存 {resultRecord.comments.timings.cacheHits.length}</span> : null}
            {sourceBrief ? <span>锚点 {sourceBrief.keyFacts.length + sourceBrief.anchorTerms.length}</span> : null}
            {(generation.lowSignalRejectedCount || generation.syntheticRejectedCount || generation.nearDuplicateRejectedCount || generation.repeatedStyleRejectedCount) ? (
              <span>过滤 {(generation.lowSignalRejectedCount || 0) + (generation.syntheticRejectedCount || 0) + (generation.nearDuplicateRejectedCount || 0) + (generation.repeatedStyleRejectedCount || 0)}</span>
            ) : null}
            {generation.entityCorrectedCount ? <span>型号纠错 {generation.entityCorrectedCount}</span> : null}
            {generation.unsupportedEntityRejectedCount ? <span>型号过滤 {generation.unsupportedEntityRejectedCount}</span> : null}
            {entityGuard?.allowedModels?.length ? <span>型号 {entityGuard.allowedModels.length}</span> : null}
            {generation.lengthBuckets?.long ? <span>长评 {generation.lengthBuckets.long}/{generation.targetLongCommentCount || generation.lengthBuckets.long}</span> : null}
            {generation.intentBuckets ? <span>追问 {generation.intentBuckets.question}</span> : null}
            {generation.intentBuckets ? <span>价格 {generation.intentBuckets.price}</span> : null}
            {generation.intentBuckets ? <span>观望 {generation.intentBuckets.skeptical}</span> : null}
            {generation.intentBuckets?.chatter ? <span>吹水 {generation.intentBuckets.chatter}</span> : null}
            {relatedResearch?.longCommentCount ? <span>长评样本 {relatedResearch.longCommentCount}</span> : null}
            {generation.mode === "model_batch" ? <span>模型解析 {generation.parsedCount}</span> : null}
          </div>
        ) : null}
        <div className="engagement-export-row">
          {resultRecord && missingCommentCount > 0 ? (
            <button
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => onSupplement(resultRecord)}
              type="button"
            >
              <ListPlus aria-hidden="true" size={16} />
              补齐 {missingCommentCount} 条
            </button>
          ) : null}
          <button
            className="btn"
            disabled={!resultRecord || (!activeComments.length && !activeDanmaku.length) || Boolean(busy)}
            onClick={() => resultRecord ? onExportWord(resultRecord) : undefined}
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            {busy === "export-word" ? "导出中…" : "Word 文档"}
          </button>
        </div>
        <AssetTextList
          empty={isGenerating ? "首批评论生成后会直接显示。" : "生成后会在这里显示评论。"}
          items={activeComments.map((item) => item.text)}
          title={`评论 ${activeComments.length}${isGenerating && previewComments.length ? " · 生成中" : ""}`}
          onCopy={() => onCopyText(activeComments.map((item) => item.text).join("\n"), "评论已复制。")}
          onPublish={() =>
            onPublishAssetText(
              "comments",
              activeComments.map((item) => item.text),
              "导出评论失败"
            )
          }
          publishDisabled={Boolean(busy)}
          publishing={busy === "feishu-comments"}
        />
        <AssetTextList
          empty={includeDanmaku || activeDanmaku.length ? "生成后会在这里显示弹幕。" : "勾选弹幕后会生成弹幕。"}
          items={activeDanmaku.map((item) => `${formatTime(item.timeSec)}  ${item.text}`)}
          title={`弹幕 ${activeDanmaku.length}`}
          onCopy={() => onCopyText(activeDanmaku.map((item) => `${formatTime(item.timeSec)}\t${item.text}`).join("\n"), "弹幕已复制。")}
          onPublish={() =>
            onPublishAssetText(
              "danmaku",
              activeDanmaku.map((item) => `${formatTime(item.timeSec)}\t${item.text}`),
              "导出弹幕失败"
            )
          }
          publishDisabled={Boolean(busy)}
          publishing={busy === "feishu-danmaku"}
        />
      </div>
    </section>
  );
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
