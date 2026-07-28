"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus, RefreshCw } from "lucide-react";
import { AssetsFeishuModal } from "./_components/AssetsFeishuModal";
import { EngagementGeneratorPane } from "./_components/EngagementGeneratorPane";
import { EngagementHistoryPane } from "./_components/EngagementHistoryPane";
import { EngagementResultsPane } from "./_components/EngagementResultsPane";
import type { BusyState } from "./_components/asset-view-utils";
import { useAssetFeishuPublish } from "./_hooks/useAssetFeishuPublish";
import { useEngagementGeneration } from "./_hooks/useEngagementGeneration";
import { useFeedback } from "@/components/FeedbackProvider";
import { useTasks } from "@/components/TaskProvider";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import {
  deleteEngagementRecords,
  exportEngagementRecord,
  getCachedEngagementRecords,
  getEngagementRecords,
  refreshEngagementRecords
} from "@/lib/client";
import type { EngagementGenerationMode, EngagementRecord } from "@/lib/types";

export default function AssetsPage() {
  return <AssetsPageContent />;
}

function AssetsPageContent() {
  const { activeJobs, recentJobs, startTask } = useTasks();
  const { notify } = useFeedback();
  const [sourceInput, setSourceInput] = useState("");
  const [includeComments, setIncludeComments] = useState(true);
  const [includeDanmaku, setIncludeDanmaku] = useState(false);
  const [commentCount, setCommentCount] = useState(50);
  const [danmakuCount, setDanmakuCount] = useState(50);
  const [generationMode, setGenerationMode] = useState<EngagementGenerationMode>("quick");
  const [busy, setBusy] = useState<BusyState>("");
  const [notice, setNotice] = useState("");
  const [records, setRecords] = useState<EngagementRecord[]>(() => getCachedEngagementRecords()?.records ?? []);
  const [recordsLoading, setRecordsLoading] = useState(() => !getCachedEngagementRecords());

  const noticeIsError = notice.includes("失败") || notice.includes("未配置") || notice.includes("不支持") || notice.includes("请");

  const {
    activeTitle,
    canGenerate,
    generationProgress,
    handleGenerate,
    handleSupplement,
    previewComments,
    resultRecord,
    setResultRecord
  } = useEngagementGeneration({
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
    const params = new URLSearchParams(window.location.search);
    const source = params.get("source")?.trim();
    const nextCommentCount = readCountParam(params, "comments");
    const nextDanmakuCount = readCountParam(params, "danmaku");

    if (source) setSourceInput(source);
    if (nextCommentCount !== null) {
      setIncludeComments(true);
      setCommentCount(nextCommentCount);
    }
    if (nextDanmakuCount !== null) {
      setIncludeDanmaku(true);
      setDanmakuCount(nextDanmakuCount);
    }
    if (nextCommentCount === null && nextDanmakuCount !== null) {
      setIncludeComments(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const cachedRecords = getCachedEngagementRecords();
    if (cachedRecords) {
      setRecords(cachedRecords.records);
      setRecordsLoading(false);
      return;
    }

    setRecordsLoading(true);

    getEngagementRecords()
      .then((result) => {
        if (!ignore) setRecords(result.records);
      })
      .catch((err) => {
        if (!ignore) setNotice(err instanceof Error ? err.message : "读取互动素材历史失败");
      })
      .finally(() => {
        if (!ignore) setRecordsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!resultRecord) return;
    setRecords((current) => mergeEngagementRecords([resultRecord], current));
  }, [resultRecord]);

  async function handleRefresh() {
    setRecordsLoading(true);
    setNotice("");
    try {
      const result = await refreshEngagementRecords();
      setRecords(result.records);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRecordsLoading(false);
    }
  }

  async function handleDeleteRecord(record: EngagementRecord) {
    const replacement = records.find((item) => item.id !== record.id) || null;

    try {
      await deleteEngagementRecords([record.id]);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      if (resultRecord?.id === record.id) {
        setResultRecord(replacement);
      }
      notify({ tone: "success", message: "历史记录已删除。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除历史记录失败";
      notify({ tone: "error", message });
      throw error;
    }
  }

  async function handleExportRecord(record: EngagementRecord) {
    setBusy("export-word");
    setNotice("");
    try {
      const result = await exportEngagementRecord(record.id);
      setNotice(`已导出 Word 文档：${result.fileName}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "导出数据维护文档失败");
    } finally {
      setBusy("");
    }
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    setNotice(message);
  }

  return (
    <div className="page assets-page">
      <header className="page-header">
        <div className="page-title-group">
          <span className="page-title-eyebrow">互动素材</span>
          <div className="page-title-row">
            <span className="page-title-mark" aria-hidden="true">
              <MessageSquarePlus size={20} strokeWidth={2.1} />
            </span>
            <div className="page-title-copy">
              <h1>评论生成</h1>
              <p className="subtle">链接转写，文案直接生成。</p>
            </div>
          </div>
        </div>
        <div className="page-header-meta">
          <span className="stat-pill">{recordsLoading ? "读取中" : `${records.length} 条记录`}</span>
          <button className="btn ghost" onClick={() => void handleRefresh()} type="button">
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
              <p className="pane-subtitle">链接或文案。</p>
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
              generationMode={generationMode}
              generationProgress={generationProgress}
              sourceInput={sourceInput}
              onCommentCountChange={setCommentCount}
              onDanmakuCountChange={setDanmakuCount}
              onGenerate={handleGenerate}
              onGenerationModeChange={setGenerationMode}
              onIncludeCommentsChange={setIncludeComments}
              onIncludeDanmakuChange={setIncludeDanmaku}
              onSourceInputChange={setSourceInput}
            />

            <EngagementResultsPane
              busy={busy}
              includeDanmaku={includeDanmaku}
              previewComments={previewComments}
              resultRecord={resultRecord}
              onCopyText={copyText}
              onExportWord={(record) => void handleExportRecord(record)}
              onSupplement={(record) => void handleSupplement(record)}
              onPublishAssetText={handlePublishAssetText}
            />
          </div>
        </section>
        <EngagementHistoryPane
          loading={recordsLoading}
          records={records}
          resultRecord={resultRecord}
          onDeleteRecord={handleDeleteRecord}
          onExportRecord={(record) => void handleExportRecord(record)}
          onSelectRecord={setResultRecord}
        />
      </section>

      {feishuResult ? <AssetsFeishuModal result={feishuResult} onClose={() => setFeishuResult(null)} /> : null}
    </div>
  );
}

function mergeEngagementRecords(nextRecords: EngagementRecord[], currentRecords: EngagementRecord[]) {
  const byId = new Map(currentRecords.map((record) => [record.id, record]));
  for (const record of nextRecords) byId.set(record.id, record);
  return [...byId.values()].sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt));
}

function readCountParam(params: URLSearchParams, key: string) {
  const rawValue = params.get(key);
  if (!rawValue) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}
