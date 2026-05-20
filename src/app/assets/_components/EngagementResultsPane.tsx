"use client";

import { AssetTextList } from "./AssetTextList";
import type { BusyState } from "./asset-view-utils";
import { formatTime } from "./asset-view-utils";
import type { EngagementRecord } from "@/lib/types";

type EngagementResultsPaneProps = {
  busy: BusyState;
  includeDanmaku: boolean;
  resultRecord: EngagementRecord | null;
  onCopyText: (text: string, message: string) => void;
  onPublishAssetText: (kind: "comments" | "danmaku", items: string[], emptyMessage: string) => void;
};

export function EngagementResultsPane({
  busy,
  includeDanmaku,
  resultRecord,
  onCopyText,
  onPublishAssetText
}: EngagementResultsPaneProps) {
  const activeComments = resultRecord?.comments?.items || [];
  const activeDanmaku = resultRecord?.danmaku?.items || [];

  return (
    <section className="engagement-result-pane">
      <div className="pane-body engagement-results-pane">
        <AssetTextList
          empty="生成后会在这里显示评论池。"
          items={activeComments.map((item) => item.text)}
          title={`评论池 ${activeComments.length}`}
          onCopy={() => onCopyText(activeComments.map((item) => item.text).join("\n"), "评论已复制。")}
          onPublish={() =>
            onPublishAssetText(
              "comments",
              activeComments.map((item) => item.text),
              "导出评论池失败"
            )
          }
          publishDisabled={Boolean(busy)}
          publishing={busy === "feishu-comments"}
        />
        <AssetTextList
          empty={includeDanmaku || activeDanmaku.length ? "生成后会在这里显示弹幕池。" : "勾选弹幕后会生成弹幕池。"}
          items={activeDanmaku.map((item) => `${formatTime(item.timeSec)}  ${item.text}`)}
          title={`弹幕池 ${activeDanmaku.length}`}
          onCopy={() => onCopyText(activeDanmaku.map((item) => `${formatTime(item.timeSec)}\t${item.text}`).join("\n"), "弹幕已复制。")}
          onPublish={() =>
            onPublishAssetText(
              "danmaku",
              activeDanmaku.map((item) => `${formatTime(item.timeSec)}\t${item.text}`),
              "导出弹幕池失败"
            )
          }
          publishDisabled={Boolean(busy)}
          publishing={busy === "feishu-danmaku"}
        />
      </div>
    </section>
  );
}
