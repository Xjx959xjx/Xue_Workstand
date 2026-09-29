"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { History, Plus, RefreshCw } from "lucide-react";
import { AssetsFeishuModal } from "./_components/AssetsFeishuModal";
import { EngagementGeneratorPane } from "./_components/EngagementGeneratorPane";
import { EngagementHistoryPane } from "./_components/EngagementHistoryPane";
import { EngagementResultsPane } from "./_components/EngagementResultsPane";
import type { BusyState } from "./_components/asset-view-utils";
import { useAssetFeishuPublish } from "./_hooks/useAssetFeishuPublish";
import { useEngagementGeneration } from "./_hooks/useEngagementGeneration";
import { useFeedback } from "@/components/FeedbackProvider";
import { useTasks } from "@/components/TaskProvider";
import { confirmDiscardUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { isTaskProgressMessage } from "@/lib/feedback-messages";
import { ENGAGEMENT_RECORD_QUERY_PARAM } from "@/lib/job-links";
import {
  deleteEngagementRecords,
  engagementSummaryFromRecord,
  exportEngagementRecord,
  getCachedEngagementRecords,
  getEngagementRecord,
  getEngagementRecords,
  refreshEngagementRecords
} from "@/lib/client";
import { detectPlatformFromLink, extractFirstLinkFromInput } from "@/lib/platform-links";
import type { EngagementRecord, EngagementRecordSummary, Platform } from "@/lib/types";

export default function AssetsPage() {
  return (
    <Suspense fallback={<AssetsPageFallback />}>
      <AssetsPageContent />
    </Suspense>
  );
}

function AssetsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeJobs, recentJobs, startTask } = useTasks();
  const { notify } = useFeedback();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [includeComments, setIncludeComments] = useState(true);
  const [includeDanmaku, setIncludeDanmaku] = useState(false);
  const [commentCount, setCommentCount] = useState(50);
  const [danmakuCount, setDanmakuCount] = useState(50);
  const [targetPlatform, setTargetPlatform] = useState<Platform>("douyin");
  const [busy, setBusy] = useState<BusyState>("");
  const [notice, setNotice] = useState("");
  const [records, setRecords] = useState<EngagementRecordSummary[]>(() => getCachedEngagementRecords()?.records ?? []);
  const [recordsLoading, setRecordsLoading] = useState(() => !getCachedEngagementRecords());
  const [openingRecordId, setOpeningRecordId] = useState("");
  const loadedRecordParamRef = useRef("");
  const openRecordRequestRef = useRef(0);

  const noticeIsError = notice.includes("失败") || notice.includes("未配置") || notice.includes("不支持") || notice.includes("请");
  const sourceLink = extractFirstLinkFromInput(sourceInput, { kind: "video" });
  const detectedPlatform = detectPlatformFromLink(sourceLink);
  const effectivePlatform = detectedPlatform === "unknown" ? targetPlatform : detectedPlatform;
  const supportsDanmaku = effectivePlatform === "bilibili";
  const handleRecordCompleted = useCallback((record: EngagementRecord) => {
    setRecords((current) => mergeEngagementRecords([engagementSummaryFromRecord(record)], current));
  }, []);

  const {
    activeTitle,
    canGenerate,
    generationProgress,
    handleGenerate,
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
    onRecordCompleted: handleRecordCompleted,
    targetPlatform,
    recentJobs,
    setBusy,
    setNotice,
    sourceInput,
    startTask
  });
  const loadedSource = resultRecord
    ? resultRecord.sourceType === "url"
      ? resultRecord.sourceUrl || resultRecord.resolvedUrl || resultRecord.sourceText
      : resultRecord.sourceText
    : "";
  const hasUnsavedDraft = Boolean(sourceInput.trim()) && (!resultRecord
    || sourceInput.trim() !== loadedSource.trim()
    || includeComments !== resultRecord.options.includeComments
    || (includeComments && commentCount !== resultRecord.options.commentCount)
    || includeDanmaku !== resultRecord.options.includeDanmaku
    || (includeDanmaku && danmakuCount !== resultRecord.options.danmakuCount)
    || (resultRecord.platform !== "unknown" && targetPlatform !== (resultRecord.options.targetPlatform || resultRecord.platform)));

  useEffect(() => {
    if (!supportsDanmaku && includeDanmaku) setIncludeDanmaku(false);
  }, [includeDanmaku, supportsDanmaku]);

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

  const applyLoadedRecord = useCallback((detail: EngagementRecord) => {
    const restoredPlatform = detail.options.targetPlatform
      || (detail.platform === "unknown" ? targetPlatform : detail.platform);

    setSourceInput(detail.sourceType === "url"
      ? detail.sourceUrl || detail.resolvedUrl || detail.sourceText
      : detail.sourceText);
    setTargetPlatform(restoredPlatform);
    setIncludeComments(detail.options.includeComments);
    setCommentCount(clampCount(detail.options.commentCount, 1, 200, 50));
    setIncludeDanmaku(detail.options.includeDanmaku && restoredPlatform === "bilibili");
    setDanmakuCount(clampCount(detail.options.danmakuCount, 1, 300, 50));
    setResultRecord(detail);
  }, [setResultRecord, targetPlatform]);

  const openRecord = useCallback(async (recordId: string) => {
    const requestId = openRecordRequestRef.current + 1;
    openRecordRequestRef.current = requestId;
    setOpeningRecordId(recordId);
    setNotice("");
    try {
      const detail = await getEngagementRecord(recordId);
      if (openRecordRequestRef.current !== requestId) return false;
      applyLoadedRecord(detail);
      return true;
    } catch (error) {
      if (openRecordRequestRef.current === requestId) {
        setNotice(error instanceof Error ? error.message : "读取评论详情失败");
      }
      return false;
    } finally {
      if (openRecordRequestRef.current === requestId) setOpeningRecordId("");
    }
  }, [applyLoadedRecord]);

  const requestedRecordId = searchParams.get(ENGAGEMENT_RECORD_QUERY_PARAM)?.trim() || "";
  const replaceSelectedRecordInUrl = useCallback((recordId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (recordId) params.set(ENGAGEMENT_RECORD_QUERY_PARAM, recordId);
    else params.delete(ENGAGEMENT_RECORD_QUERY_PARAM);
    const query = params.toString();
    router.replace(query ? `/assets?${query}` : "/assets", { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    if (!requestedRecordId) {
      loadedRecordParamRef.current = "";
      return;
    }
    if (
      loadedRecordParamRef.current === requestedRecordId
      || loadedRecordParamRef.current === `loading:${requestedRecordId}`
    ) return;

    const loadingKey = `loading:${requestedRecordId}`;
    loadedRecordParamRef.current = loadingKey;
    void openRecord(requestedRecordId).then((opened) => {
      if (loadedRecordParamRef.current !== loadingKey) return;
      loadedRecordParamRef.current = opened ? requestedRecordId : "";
    });
  }, [openRecord, requestedRecordId]);

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
        if (!ignore) setRecords((current) => mergeEngagementRecords(result.records, current));
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

  async function handleDeleteRecord(record: EngagementRecordSummary) {
    try {
      await deleteEngagementRecords([record.id]);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      if (resultRecord?.id === record.id) {
        setResultRecord(null);
        loadedRecordParamRef.current = "";
        replaceSelectedRecordInUrl("");
      }
      notify({ tone: "success", message: "历史记录已删除。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除历史记录失败";
      notify({ tone: "error", message });
      throw error;
    }
  }

  async function handleExportRecord(record: EngagementRecordSummary | EngagementRecord) {
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

  async function handleSelectRecord(record: EngagementRecordSummary) {
    if (openingRecordId) return;
    if (!confirmDiscardUnsavedChanges("打开历史记录会替换当前尚未生成的输入，是否继续？")) return;
    const opened = await openRecord(record.id);
    if (!opened) return;
    loadedRecordParamRef.current = record.id;
    replaceSelectedRecordInUrl(record.id);
    setHistoryOpen(false);
  }

  function handleNewTask() {
    if (!confirmDiscardUnsavedChanges("新建任务会清空当前尚未生成的输入，是否继续？")) return;
    openRecordRequestRef.current += 1;
    loadedRecordParamRef.current = "";
    setSourceInput("");
    setResultRecord(null);
    setNotice("");
    setHistoryOpen(false);
    router.replace("/assets", { scroll: false });
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    setNotice(message);
  }

  return (
    <div className="page assets-page" data-unsaved-changes={hasUnsavedDraft ? "true" : undefined}>
      <header className="page-header">
        <div className="page-title-group">
          <span className="page-title-eyebrow">CREATE / 03</span>
          <div className="page-title-row">
            <div className="page-title-copy">
              <h1>让内容，产生更多对话</h1>
              <p className="subtle">准备素材与生成参数，集中整理互动结果。</p>
            </div>
          </div>
        </div>
        <div className="page-header-meta">
          <button className="btn primary" type="button" disabled={Boolean(busy) || Boolean(generationProgress)} onClick={handleNewTask}><Plus size={16} aria-hidden="true" />新建任务</button>
          <button className="btn ghost" onClick={() => void handleRefresh()} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      <nav className="engagement-view-navigation" aria-label="评论生成视图">
        <button className={!historyOpen ? "active" : ""} onClick={() => setHistoryOpen(false)} type="button">工作区</button>
        <button className={historyOpen ? "active" : ""} onClick={() => setHistoryOpen(true)} type="button"><History size={14} aria-hidden="true" />历史记录 <span>{records.length}</span></button>
      </nav>

      <section className="engagement-workbench">
        <section className="panel engagement-main" hidden={historyOpen}>
          <div className="engagement-content-grid">
            <EngagementGeneratorPane
              busy={busy}
              canGenerate={canGenerate}
              commentCount={commentCount}
              danmakuCount={danmakuCount}
              includeComments={includeComments}
              includeDanmaku={includeDanmaku}
              generationProgress={generationProgress}
              targetPlatform={targetPlatform}
              supportsDanmaku={supportsDanmaku}
              sourceInput={sourceInput}
              onCommentCountChange={setCommentCount}
              onDanmakuCountChange={setDanmakuCount}
              onGenerate={handleGenerate}
              onTargetPlatformChange={setTargetPlatform}
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
              onPublishAssetText={handlePublishAssetText}
            />
          </div>
        </section>
        <aside className="engagement-inspector" hidden={historyOpen} aria-label="生成上下文">
          <span className="page-title-eyebrow">CONTEXT / 当前工作</span>
          <h2>生成参数</h2>
          <p>左侧准备素材，中央浏览、复制与导出结果。历史记录在顶部单独查看。</p>
          <dl>
            <div><dt>目标平台</dt><dd>{effectivePlatform === "bilibili" ? "B站" : "抖音"}</dd></div>
            <div><dt>生成类型</dt><dd>{[includeComments ? "评论" : "", includeDanmaku ? "弹幕" : ""].filter(Boolean).join(" / ") || "未选择"}</dd></div>
            <div><dt>预计数量</dt><dd>{(includeComments ? commentCount : 0) + (includeDanmaku ? danmakuCount : 0)} 条</dd></div>
          </dl>
          <h3>当前结果</h3>
          <p>{resultRecord ? "结果已生成，可以在中央查看或导出。" : "尚未生成内容"}</p>
          <button className="btn" onClick={() => setHistoryOpen(true)} type="button"><History size={15} aria-hidden="true" />查看历史记录</button>
        </aside>
        <div id="engagement-history" hidden={!historyOpen}>
        <EngagementHistoryPane
          loading={recordsLoading}
          openingRecordId={openingRecordId}
          records={records}
          resultRecord={resultRecord}
          onDeleteRecord={handleDeleteRecord}
          onExportRecord={(record) => void handleExportRecord(record)}
          onSelectRecord={handleSelectRecord}
        />
        </div>
      </section>

      {feishuResult ? <AssetsFeishuModal result={feishuResult} onClose={() => setFeishuResult(null)} /> : null}
    </div>
  );
}

function mergeEngagementRecords(nextRecords: EngagementRecordSummary[], currentRecords: EngagementRecordSummary[]) {
  const byId = new Map(currentRecords.map((record) => [record.id, record]));
  for (const record of nextRecords) {
    const current = byId.get(record.id);
    if (!current || +new Date(record.updatedAt) >= +new Date(current.updatedAt)) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()].sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt));
}

function readCountParam(params: URLSearchParams, key: string) {
  const rawValue = params.get(key);
  if (!rawValue) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function clampCount(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

function AssetsPageFallback() {
  return (
    <div className="page assets-page">
      <p className="subtle">正在打开评论历史…</p>
    </div>
  );
}
