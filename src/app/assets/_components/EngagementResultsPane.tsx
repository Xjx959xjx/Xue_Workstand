"use client";

import { Download } from "lucide-react";
import { AssetTextList } from "./AssetTextList";
import type { BusyState } from "./asset-view-utils";
import { formatTime } from "./asset-view-utils";
import type { EngagementRecord } from "@/lib/types";

type EngagementResultsPaneProps = {
  busy: BusyState;
  includeDanmaku: boolean;
  resultRecord: EngagementRecord | null;
  onCopyText: (text: string, message: string) => void;
  onExportWord: (record: EngagementRecord) => void;
  onPublishAssetText: (kind: "comments" | "danmaku", items: string[], emptyMessage: string) => void;
};

export function EngagementResultsPane({
  busy,
  includeDanmaku,
  resultRecord,
  onCopyText,
  onExportWord,
  onPublishAssetText
}: EngagementResultsPaneProps) {
  const activeComments = resultRecord?.comments?.items || [];
  const activeDanmaku = resultRecord?.danmaku?.items || [];
  const diagnostics = resultRecord?.comments?.diagnostics;
  const generation = diagnostics?.generation;
  const sourceBrief = diagnostics?.sourceBrief;
  const entityGuard = diagnostics?.entityGuard;
  const relatedResearch = diagnostics?.relatedResearch;

  return (
    <section className="engagement-result-pane">
      <div className="pane-body engagement-results-pane">
        {generation ? (
          <div className="engagement-diagnostics">
            <span>{generation.mode === "keyword_local" ? "关键词生成" : `${generation.batchCount} 批增强`}</span>
            <span>完成 {generation.completedCount}/{generation.requestedCount}</span>
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
          <button
            className="btn"
            disabled={!resultRecord || (!activeComments.length && !activeDanmaku.length) || Boolean(busy)}
            onClick={() => resultRecord ? onExportWord(resultRecord) : undefined}
            type="button"
          >
            <Download size={16} />
            {busy === "export-word" ? "导出中..." : "Word 文档"}
          </button>
        </div>
        <AssetTextList
          empty="生成后会在这里显示评论。"
          items={activeComments.map((item) => item.text)}
          title={`评论 ${activeComments.length}`}
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
