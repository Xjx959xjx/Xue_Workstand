"use client";

import { Suspense, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AssetsFeishuModal } from "./_components/AssetsFeishuModal";
import { EngagementGeneratorPane } from "./_components/EngagementGeneratorPane";
import { EngagementHistoryPane } from "./_components/EngagementHistoryPane";
import { EngagementResultsPane } from "./_components/EngagementResultsPane";
import type { BusyState } from "./_components/asset-view-utils";
import { useAssetFeishuPublish } from "./_hooks/useAssetFeishuPublish";
import { useEngagementGeneration } from "./_hooks/useEngagementGeneration";
import { useFeedback } from "@/components/FeedbackProvider";
import { useLibrary } from "@/components/LibraryProvider";
import { useTasks } from "@/components/TaskProvider";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import { deleteEngagementRecords } from "@/lib/client";
import type { EngagementRecord } from "@/lib/types";

export default function AssetsPage() {
  return (
    <Suspense fallback={<AssetsFallback />}>
      <AssetsPageContent />
    </Suspense>
  );
}

function AssetsPageContent() {
  const { library, refresh } = useLibrary();
  const { activeJobs, recentJobs, startTask } = useTasks();
  const { notify } = useFeedback();
  const [sourceInput, setSourceInput] = useState("");
  const [includeComments, setIncludeComments] = useState(true);
  const [includeDanmaku, setIncludeDanmaku] = useState(false);
  const [commentCount, setCommentCount] = useState(50);
  const [danmakuCount, setDanmakuCount] = useState(100);
  const [busy, setBusy] = useState<BusyState>("");
  const [notice, setNotice] = useState("");

  const records = library?.engagementRecords || [];
  const noticeIsError = notice.includes("失败") || notice.includes("未配置") || notice.includes("不支持") || notice.includes("请");

  const { activeTitle, canGenerate, handleGenerate, resultRecord, setResultRecord } = useEngagementGeneration({
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
  });

  const { feishuResult, handlePublishAssetText, setFeishuResult } = useAssetFeishuPublish({
    activeTitle,
    setBusy,
    setNotice
  });

  useEffect(() => {
    if (!notice || isTaskProgressMessage(notice)) return;
    notify({ tone: noticeIsError ? "error" : "success", message: notice });
  }, [notice, noticeIsError, notify]);

  async function handleRefresh() {
    try {
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "刷新失败");
    }
  }

  async function handleDeleteRecord(record: EngagementRecord) {
    const replacement = records.find((item) => item.id !== record.id) || null;

    try {
      await deleteEngagementRecords([record.id]);
      if (resultRecord?.id === record.id) {
        setResultRecord(replacement);
      }
      notify({ tone: "success", message: "历史记录已删除。" });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除历史记录失败";
      notify({ tone: "error", message });
      throw error;
    }
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    setNotice(message);
  }

  return (
    <div className="page assets-page">
      <header className="page-header">
        <div>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              💬
            </span>
            <span>评论生成</span>
          </h1>
          <p className="subtle">输入链接会先转写，输入文案会直接生成；评论默认开启，弹幕按需勾选。</p>
        </div>
        <div className="button-row">
          <span className="stat-pill">{records.length} 条记录</span>
          <button className="btn" onClick={() => void handleRefresh()} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      <section className="engagement-workbench">
        <section className="panel engagement-main">
          <div className="engagement-refbar">
            <div>
              <h2>生成器</h2>
              <p className="pane-subtitle">一个输入框，链接转写后生成，文案直接生成。</p>
            </div>
          </div>
          <div className="engagement-content-grid">
            <EngagementGeneratorPane
              busy={busy}
              canGenerate={canGenerate}
              commentCount={commentCount}
              danmakuCount={danmakuCount}
              includeComments={includeComments}
              includeDanmaku={includeDanmaku}
              sourceInput={sourceInput}
              onCommentCountChange={setCommentCount}
              onDanmakuCountChange={setDanmakuCount}
              onGenerate={handleGenerate}
              onIncludeCommentsChange={setIncludeComments}
              onIncludeDanmakuChange={setIncludeDanmaku}
              onSourceInputChange={setSourceInput}
            />

            <EngagementResultsPane
              busy={busy}
              includeDanmaku={includeDanmaku}
              resultRecord={resultRecord}
              onCopyText={copyText}
              onPublishAssetText={handlePublishAssetText}
            />
          </div>
        </section>
        <EngagementHistoryPane
          records={records}
          resultRecord={resultRecord}
          onDeleteRecord={handleDeleteRecord}
          onSelectRecord={setResultRecord}
        />
      </section>

      {feishuResult ? <AssetsFeishuModal result={feishuResult} onClose={() => setFeishuResult(null)} /> : null}
    </div>
  );
}

function AssetsFallback() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              💬
            </span>
            <span>评论生成</span>
          </h1>
          <p className="subtle">正在读取生成记录。</p>
        </div>
      </header>
    </div>
  );
}
