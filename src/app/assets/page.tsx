"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Copy,
  ExternalLink,
  FileText,
  FileUp,
  Link as LinkIcon,
  RefreshCw,
  Send,
  TextCursorInput
} from "lucide-react";
import { useFeedback } from "@/components/FeedbackProvider";
import { formatDate, formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { useTasks } from "@/components/TaskProvider";
import { publishFeishuDocument } from "@/lib/client";
import { Draft, EngagementRecord, EngagementSourceType, JobRecord } from "@/lib/types";

type BusyState = "generate" | "feishu-comments" | "feishu-danmaku" | "";

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
  const [resultRecord, setResultRecord] = useState<EngagementRecord | null>(null);
  const [feishuResult, setFeishuResult] = useState<{ title: string; url: string } | null>(null);
  const [previewDraft, setPreviewDraft] = useState<Draft | null>(null);
  const [activeEngagementJobId, setActiveEngagementJobId] = useState("");
  const [handledEngagementJobIds, setHandledEngagementJobIds] = useState<string[]>([]);

  const drafts = useMemo(() => library?.drafts || [], [library?.drafts]);
  const records = useMemo(() => library?.engagementRecords || [], [library?.engagementRecords]);
  const selectedDraft = useMemo(() => drafts.find((draft) => draft.id === selectedId) || drafts[0] || null, [drafts, selectedId]);
  const noticeIsError = notice.includes("失败") || notice.includes("未配置") || notice.includes("不支持") || notice.includes("请");
  const activeComments = resultRecord?.comments?.items || [];
  const activeDanmaku = resultRecord?.danmaku?.items || [];
  const activeTitle = resultRecord?.title || selectedDraft?.title || "评论生成";
  const engagementJob = useMemo(
    () => findTaskJob([...activeJobs, ...recentJobs], activeEngagementJobId, "engagement"),
    [activeEngagementJobId, activeJobs, recentJobs]
  );
  const isGenerating = Boolean(engagementJob && (engagementJob.status === "queued" || engagementJob.status === "running"));
  const canGenerate = !busy && !isGenerating && (includeComments || includeDanmaku) && hasSourceInput(sourceType, selectedDraft, textInput, urlInput);

  useEffect(() => {
    if (!notice || isBackgroundStartMessage(notice)) return;
    notify({ tone: noticeIsError ? "error" : "success", message: notice });
  }, [notice, noticeIsError, notify]);

  useEffect(() => {
    const draftId = searchParams.get("draftId");
    if (draftId) {
      setSourceType("draft");
      setSelectedId(draftId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!engagementJob) return;
    setActiveEngagementJobId(engagementJob.id);
    if (engagementJob.status === "running" || engagementJob.status === "queued") {
      setBusy("generate");
      setNotice(engagementJob.message || "正在生成互动素材");
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
  }, [engagementJob, handledEngagementJobIds]);

  async function handleGenerate() {
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
      setNotice("评论素材已在后台开始生成，可以切换到其他模块。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成评论失败，请检查输入和模型配置。");
    }
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    setNotice(message);
  }

  async function handlePublishAssetText(kind: "comments" | "danmaku", items: string[], emptyMessage: string) {
    if (!items.length) return;
    setBusy(kind === "comments" ? "feishu-comments" : "feishu-danmaku");
    setNotice("");
    try {
      const result = await publishFeishuDocument({
        title: `${activeTitle}-${kind === "comments" ? "评论池" : "弹幕池"}`,
        content: items.join("\n")
      });
      setFeishuResult({ title: result.title, url: result.url });
      setNotice("已导出到飞书文档。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : emptyMessage);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page assets-page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Engagement</p>
          <h1>评论生成</h1>
          <p className="subtle">从草稿、粘贴文案或 B站 / 抖音视频链接生成评论池；需要时再生成弹幕。</p>
        </div>
        <div className="button-row">
          <span className="stat-pill">{records.length} 条记录</span>
          <button className="btn" onClick={refresh} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      <section className="panel three-pane assets-workspace engagement-workspace">
        <section className="pane assets-main-pane engagement-generator-pane">
          <div className="pane-header">
            <div>
              <h2>生成器</h2>
              <p className="pane-subtitle">评论默认开启，弹幕按需勾选</p>
            </div>
          </div>
          <div className="pane-body detail-stack">
            <div className="segmented source-tabs" role="tablist" aria-label="选择来源">
              {sourceTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    aria-selected={sourceType === tab.value}
                    className={sourceType === tab.value ? "active" : ""}
                    key={tab.value}
                    onClick={() => {
                      setSourceType(tab.value);
                      setResultRecord(null);
                    }}
                    role="tab"
                    type="button"
                  >
                    <Icon size={15} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <SourceInput
              drafts={drafts}
              loading={loading}
              selectedDraft={selectedDraft}
              selectedId={selectedId}
              sourceType={sourceType}
              textInput={textInput}
              textTitle={textTitle}
              urlInput={urlInput}
              onSelectDraft={setSelectedId}
              onOpenPreview={setPreviewDraft}
              onTextInput={setTextInput}
              onTextTitle={setTextTitle}
              onUrlInput={setUrlInput}
            />

            <section className="detail-section engagement-options">
              <div className="section-title-row">
                <div>
                  <h3>生成选项</h3>
                  <p className="subtle">关闭评论后可以只生成弹幕。</p>
                </div>
              </div>
              <div className="engagement-option-grid">
                <label className={`engagement-option ${includeComments ? "active" : ""}`}>
                  <input checked={includeComments} type="checkbox" onChange={(event) => setIncludeComments(event.target.checked)} />
                  <span>
                    <strong>评论</strong>
                    <small>默认生成评论池</small>
                  </span>
                  <input
                    aria-label="评论条数"
                    disabled={!includeComments}
                    max={200}
                    min={1}
                    type="number"
                    value={commentCount}
                    onChange={(event) => setCommentCount(Number(event.target.value))}
                  />
                </label>
                <label className={`engagement-option ${includeDanmaku ? "active" : ""}`}>
                  <input checked={includeDanmaku} type="checkbox" onChange={(event) => setIncludeDanmaku(event.target.checked)} />
                  <span>
                    <strong>弹幕</strong>
                    <small>按口播节奏生成时间点</small>
                  </span>
                  <input
                    aria-label="弹幕条数"
                    disabled={!includeDanmaku}
                    max={300}
                    min={1}
                    type="number"
                    value={danmakuCount}
                    onChange={(event) => setDanmakuCount(Number(event.target.value))}
                  />
                </label>
              </div>
              <button className="btn primary engagement-submit" disabled={!canGenerate} onClick={handleGenerate} type="button">
                <Send size={16} />
                {busy === "generate" ? "正在生成" : "生成"}
              </button>
            </section>

            {busy === "generate" ? (
              <div className="project-progress" role="status" aria-live="polite">
                <div className="project-progress-copy">
                  <span>{sourceType === "url" ? "正在读取链接并生成互动素材" : "正在生成互动素材"}</span>
                  <strong>处理中</strong>
                </div>
                <div className="progress-track" aria-hidden="true">
                  <div className="progress-fill indeterminate" />
                </div>
              </div>
            ) : null}

          </div>
        </section>

        <aside className="pane">
          <div className="pane-header">
            <div>
              <h2>生成结果</h2>
              <p className="pane-subtitle">{resultRecord ? resultRecord.title : "评论和弹幕会显示在这里"}</p>
            </div>
          </div>
          <div className="pane-body engagement-results-pane">
            <AssetTextList
              empty="生成后会在这里显示评论池。"
              items={activeComments.map((item) => item.text)}
              title={`评论池 ${activeComments.length}`}
              onCopy={() => copyText(activeComments.map((item) => item.text).join("\n"), "评论已复制。")}
              onPublish={() =>
                handlePublishAssetText(
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
              onCopy={() => copyText(activeDanmaku.map((item) => `${formatTime(item.timeSec)}\t${item.text}`).join("\n"), "弹幕已复制。")}
              onPublish={() =>
                handlePublishAssetText(
                  "danmaku",
                  activeDanmaku.map((item) => `${formatTime(item.timeSec)}\t${item.text}`),
                  "导出弹幕池失败"
                )
              }
              publishDisabled={Boolean(busy)}
              publishing={busy === "feishu-danmaku"}
            />
          </div>
        </aside>

        <aside className="pane engagement-history-pane">
          <div className="pane-header">
            <div>
              <h2>历史记录</h2>
              <p className="pane-subtitle">链接、粘贴和草稿都会保存</p>
            </div>
          </div>
          <div className="pane-body">
            <div className="status-summary">
              <span>{records.length} 条记录</span>
              <span>点击查看结果</span>
            </div>
            {records.length ? (
              records.map((record) => (
                <button
                  aria-current={resultRecord?.id === record.id ? "true" : undefined}
                  className={`list-button ${resultRecord?.id === record.id ? "active" : ""}`}
                  key={record.id}
                  onClick={() => setResultRecord(record)}
                  type="button"
                >
                  <span>
                    <span className="list-title">{record.title}</span>
                    <span className="list-meta">
                      {formatSourceType(record.sourceType)} · {formatDate(record.createdAt)}
                    </span>
                  </span>
                  <span className="status-pill done">{record.comments?.items.length || 0}/{record.danmaku?.items.length || 0}</span>
                </button>
              ))
            ) : (
              <p className="subtle">生成后会在这里保留记录。</p>
            )}
          </div>
        </aside>
      </section>

      {feishuResult ? (
        <div className="modal-backdrop">
          <div aria-labelledby="assets-feishu-dialog-title" aria-modal="true" className="modal-panel feishu-modal" role="dialog" tabIndex={-1}>
            <div className="modal-header">
              <h2 id="assets-feishu-dialog-title">飞书文档已创建</h2>
              <button className="btn" onClick={() => setFeishuResult(null)} type="button">
                关闭
              </button>
            </div>
            <div className="feishu-success-card">
              <p>{feishuResult.title}</p>
              <a className="btn primary" href={feishuResult.url} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={16} />
                打开飞书文档
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {previewDraft ? (
        <SourcePreviewModal draft={previewDraft} onClose={() => setPreviewDraft(null)} />
      ) : null}
    </div>
  );
}

function SourceInput({
  drafts,
  loading,
  selectedDraft,
  selectedId,
  sourceType,
  textInput,
  textTitle,
  urlInput,
  onSelectDraft,
  onOpenPreview,
  onTextInput,
  onTextTitle,
  onUrlInput
}: {
  drafts: Draft[];
  loading: boolean;
  selectedDraft: Draft | null;
  selectedId: string;
  sourceType: EngagementSourceType;
  textInput: string;
  textTitle: string;
  urlInput: string;
  onSelectDraft: (id: string) => void;
  onOpenPreview: (draft: Draft) => void;
  onTextInput: (value: string) => void;
  onTextTitle: (value: string) => void;
  onUrlInput: (value: string) => void;
}) {
  const [draftSearch, setDraftSearch] = useState("");
  const filteredDrafts = useMemo(() => {
    const keyword = draftSearch.trim().toLowerCase();
    if (!keyword) return drafts;
    return drafts.filter((draft) => {
      const haystack = `${draft.title} ${getDraftReferenceLabel(draft)} ${formatDate(draft.createdAt)}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [draftSearch, drafts]);

  if (sourceType === "text") {
    return (
      <section className="detail-section engagement-source-panel">
        <label className="field">
          <span>标题，可不填</span>
          <input placeholder="例如：这篇评论池" value={textTitle} onChange={(event) => onTextTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>文案</span>
          <textarea className="engagement-textarea" placeholder="把要生成评论的文案粘贴到这里。" value={textInput} onChange={(event) => onTextInput(event.target.value)} />
        </label>
      </section>
    );
  }

  if (sourceType === "url") {
    return (
      <section className="detail-section engagement-source-panel">
        <label className="field">
          <span>视频链接</span>
          <input placeholder="粘贴 B站或抖音视频链接" value={urlInput} onChange={(event) => onUrlInput(event.target.value)} />
        </label>
        <p className="subtle">暂只支持 B站 / 抖音视频链接；普通网页文章请改用粘贴文案。</p>
      </section>
    );
  }

  return (
    <section className="detail-section engagement-source-panel">
      <div className="section-title-row">
        <div>
          <h3>选择草稿</h3>
          <p className="subtle">{selectedDraft ? getDraftReferenceLabel(selectedDraft) : loading ? "正在读取草稿" : "暂无草稿"}</p>
        </div>
        <button className="btn" disabled={!selectedDraft} onClick={() => selectedDraft && onOpenPreview(selectedDraft)} type="button">
          <FileText size={16} />
          来源预览
        </button>
      </div>
      <label className="field engagement-draft-search">
        <span>搜索草稿</span>
        <input
          placeholder="按标题、账号或项目筛选"
          value={draftSearch}
          onChange={(event) => setDraftSearch(event.target.value)}
        />
      </label>
      <div className="status-summary engagement-draft-summary">
        <span>{filteredDrafts.length}/{drafts.length} 个草稿</span>
        <span>列表内滚动</span>
      </div>
      <div className="engagement-draft-list" role="listbox" aria-label="草稿列表">
        {filteredDrafts.length ? (
          filteredDrafts.map((draft) => {
            const active = (selectedDraft?.id || selectedId) === draft.id;
            return (
              <button
                aria-current={active ? "true" : undefined}
                aria-selected={active}
                className={`list-button ${active ? "active" : ""}`}
                key={draft.id}
                onClick={() => onSelectDraft(draft.id)}
                role="option"
                title="选择这篇草稿"
                type="button"
              >
                <span>
                  <span className="list-title">{draft.title}</span>
                  <span className="list-meta">
                    {getDraftReferenceLabel(draft)} · {formatDate(draft.createdAt)}
                  </span>
                </span>
                <span className="status-pill done">{draft.assets?.comments || draft.assets?.danmaku ? "有记录" : "草稿"}</span>
              </button>
            );
          })
        ) : drafts.length ? (
          <p className="subtle">没有匹配的草稿，换个关键词试试。</p>
        ) : (
          <p className="subtle">还没有草稿，也可以切换到粘贴文案或视频链接。</p>
        )}
      </div>
    </section>
  );
}

function SourcePreviewModal({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <div aria-labelledby="source-preview-title" aria-modal="true" className="modal-panel source-preview-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="source-preview-title">来源预览</h2>
            <p className="pane-subtitle">{draft.title}</p>
          </div>
          <button className="btn" onClick={onClose} type="button">
            关闭
          </button>
        </div>
        <div className="source-preview-body">
          <div className="stat-row">
            <span className="stat-pill">{draft.targetType === "project" ? "项目" : formatPlatform(draft.platform)}</span>
            <span className="stat-pill">{getDraftReferenceLabel(draft)}</span>
            <span className="stat-pill">{formatDate(draft.createdAt)}</span>
          </div>
          <article className="markdown-box draft-document">{draft.content}</article>
        </div>
      </div>
    </div>
  );
}

function AssetTextList({
  title,
  items,
  empty,
  onCopy,
  onPublish,
  publishDisabled,
  publishing
}: {
  title: string;
  items: string[];
  empty: string;
  onCopy: () => void;
  onPublish?: () => void;
  publishDisabled?: boolean;
  publishing?: boolean;
}) {
  return (
    <div className="asset-list-block">
      <div className="section-title-row">
        <h3>{title}</h3>
        <div className="button-row">
          <button className="btn" disabled={!items.length} onClick={onCopy} type="button">
            <Copy size={16} />
            复制
          </button>
          {onPublish ? (
            <button className="btn" disabled={!items.length || publishDisabled} onClick={onPublish} type="button">
              <FileUp size={16} />
              {publishing ? "导出中..." : "飞书文档"}
            </button>
          ) : null}
        </div>
      </div>
      <div className={`asset-text-list ${items.length ? "" : "empty"}`}>
        {items.length ? items.map((item, index) => <p key={`${index}-${item}`}>{item}</p>) : empty}
      </div>
    </div>
  );
}

function AssetsFallback() {
  return (
    <div className="page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Engagement</p>
          <h1>评论生成</h1>
          <p className="subtle">正在读取草稿和已生成记录。</p>
        </div>
      </header>
    </div>
  );
}

const sourceTabs: Array<{ value: EngagementSourceType; label: string; icon: typeof FileText }> = [
  { value: "draft", label: "选草稿", icon: FileText },
  { value: "text", label: "粘贴文案", icon: TextCursorInput },
  { value: "url", label: "视频链接", icon: LinkIcon }
];

function hasSourceInput(sourceType: EngagementSourceType, selectedDraft: Draft | null, textInput: string, urlInput: string) {
  if (sourceType === "draft") return Boolean(selectedDraft);
  if (sourceType === "text") return Boolean(textInput.trim());
  return Boolean(urlInput.trim());
}

function buildSuccessMessage(record: EngagementRecord) {
  const commentCount = record.comments?.items.length || 0;
  const danmakuCount = record.danmaku?.items.length || 0;
  if (commentCount && danmakuCount) return `已生成 ${commentCount} 条评论和 ${danmakuCount} 条弹幕。`;
  if (commentCount) return `已生成 ${commentCount} 条评论。`;
  return `已生成 ${danmakuCount} 条弹幕。`;
}

function getDraftReferenceLabel(draft: Draft) {
  return draft.targetType === "project" ? `项目 ${draft.projectName}` : `${formatPlatform(draft.platform)} / ${draft.accountName}`;
}

function formatSourceType(sourceType: EngagementSourceType) {
  if (sourceType === "draft") return "草稿";
  if (sourceType === "text") return "粘贴";
  return "链接";
}

function formatTime(seconds: number) {
  const minute = Math.floor(seconds / 60);
  const second = seconds % 60;
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function findTaskJob(jobs: JobRecord[], jobId: string, kind: JobRecord["kind"]) {
  return jobs.find((job) => job.id === jobId && job.kind === kind) || jobs.find((job) => job.kind === kind && (job.status === "queued" || job.status === "running")) || null;
}

function isBackgroundStartMessage(message: string) {
  return message.includes("已在后台开始");
}
