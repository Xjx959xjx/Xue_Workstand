"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { AssetsFeishuModal } from "./_components/AssetsFeishuModal";
import { EngagementGeneratorPane } from "./_components/EngagementGeneratorPane";
import { EngagementHistoryPane } from "./_components/EngagementHistoryPane";
import { EngagementResultsPane } from "./_components/EngagementResultsPane";
import { SourcePreviewModal } from "./_components/SourcePreviewModal";
import type { BusyState } from "./_components/asset-view-utils";
import { useAssetFeishuPublish } from "./_hooks/useAssetFeishuPublish";
import { useEngagementGeneration } from "./_hooks/useEngagementGeneration";
import { useFeedback } from "@/components/FeedbackProvider";
import { useLibrary } from "@/components/LibraryProvider";
import { useTasks } from "@/components/TaskProvider";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import { getDrafts } from "@/lib/client";
import type { Draft, EngagementSourceType } from "@/lib/types";

export default function AssetsPage() {
  return (
    <Suspense fallback={<AssetsFallback />}>
      <AssetsPageContent />
    </Suspense>
  );
}

function AssetsPageContent() {
  const searchParams = useSearchParams();
  const { library, loading, refresh } = useLibrary();
  const { activeJobs, recentJobs, startTask } = useTasks();
  const { notify } = useFeedback();
  const [sourceType, setSourceType] = useState<EngagementSourceType>("draft");
  const [selectedId, setSelectedId] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textInput, setTextInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [includeComments, setIncludeComments] = useState(true);
  const [includeDanmaku, setIncludeDanmaku] = useState(false);
  const [commentCount, setCommentCount] = useState(50);
  const [danmakuCount, setDanmakuCount] = useState(100);
  const [busy, setBusy] = useState<BusyState>("");
  const [notice, setNotice] = useState("");
  const [previewDraft, setPreviewDraft] = useState<Draft | null>(null);
  const [fullDrafts, setFullDrafts] = useState<Draft[] | null>(null);

  const drafts = useMemo(() => fullDrafts || library?.drafts || [], [fullDrafts, library?.drafts]);
  const records = useMemo(() => library?.engagementRecords || [], [library?.engagementRecords]);
  const selectedDraft = useMemo(() => drafts.find((draft) => draft.id === selectedId) || drafts[0] || null, [drafts, selectedId]);
  const noticeIsError = notice.includes("失败") || notice.includes("未配置") || notice.includes("不支持") || notice.includes("请");
  const draftsLoading = loading || (fullDrafts === null && Boolean(library?.drafts.length));

  const {
    activeTitle,
    canGenerate,
    handleGenerate,
    resultRecord,
    setResultRecord
  } = useEngagementGeneration({
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

  useEffect(() => {
    let ignore = false;
    if (loading) return;
    getDrafts()
      .then((result) => {
        if (!ignore) setFullDrafts(result.drafts);
      })
      .catch((err) => {
        if (!ignore) setNotice(err instanceof Error ? err.message : "读取草稿失败");
      });
    return () => {
      ignore = true;
    };
  }, [loading, library?.drafts.length]);

  useEffect(() => {
    const draftId = searchParams.get("draftId");
    if (draftId) {
      setSourceType("draft");
      setSelectedId(draftId);
    }
  }, [searchParams]);

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    setNotice(message);
  }

  async function handleRefresh() {
    try {
      const [draftResult] = await Promise.all([getDrafts(), refresh()]);
      setFullDrafts(draftResult.drafts);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "刷新失败");
    }
  }

  return (
    <div className="page assets-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Engagement</p>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              💬
            </span>
            <span>评论生成</span>
          </h1>
          <p className="subtle">从草稿、粘贴文案或 B站 / 抖音视频链接生成评论池；需要时再生成弹幕。</p>
        </div>
        <div className="button-row">
          <span className="stat-pill">{records.length} 条记录</span>
          <button className="btn" onClick={() => void handleRefresh()} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      <section className="panel three-pane assets-workspace engagement-workspace">
        <EngagementGeneratorPane
          busy={busy}
          canGenerate={canGenerate}
          commentCount={commentCount}
          danmakuCount={danmakuCount}
          drafts={drafts}
          includeComments={includeComments}
          includeDanmaku={includeDanmaku}
          loading={draftsLoading}
          selectedDraft={selectedDraft}
          selectedId={selectedId}
          sourceType={sourceType}
          textInput={textInput}
          textTitle={textTitle}
          urlInput={urlInput}
          onCommentCountChange={setCommentCount}
          onDanmakuCountChange={setDanmakuCount}
          onGenerate={handleGenerate}
          onIncludeCommentsChange={setIncludeComments}
          onIncludeDanmakuChange={setIncludeDanmaku}
          onOpenPreview={setPreviewDraft}
          onSelectDraft={setSelectedId}
          onSourceTypeChange={(value) => {
            setSourceType(value);
            setResultRecord(null);
          }}
          onTextInputChange={setTextInput}
          onTextTitleChange={setTextTitle}
          onUrlInputChange={setUrlInput}
        />

        <EngagementResultsPane
          busy={busy}
          includeDanmaku={includeDanmaku}
          resultRecord={resultRecord}
          onCopyText={copyText}
          onPublishAssetText={handlePublishAssetText}
        />

        <EngagementHistoryPane records={records} resultRecord={resultRecord} onSelectRecord={setResultRecord} />
      </section>

      {feishuResult ? (
        <AssetsFeishuModal result={feishuResult} onClose={() => setFeishuResult(null)} />
      ) : null}

      {previewDraft ? (
        <SourcePreviewModal draft={previewDraft} onClose={() => setPreviewDraft(null)} />
      ) : null}
    </div>
  );
}

function AssetsFallback() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Engagement</p>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              💬
            </span>
            <span>评论生成</span>
          </h1>
          <p className="subtle">正在读取草稿和已生成记录。</p>
        </div>
      </header>
    </div>
  );
}
