"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, Download, ImagePlus, MessageCircle, Play, RefreshCw, Upload } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { formatDate, formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import {
  collectDraftCoverReferences,
  draftAssetFileUrl,
  generateDraftEngagement,
  streamGenerateDraftCover,
  uploadDraftCoverReferences
} from "@/lib/client";
import { Draft, DraftCoverReference } from "@/lib/types";

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
  const [selectedId, setSelectedId] = useState("");
  const [commentCount, setCommentCount] = useState(50);
  const [danmakuCount, setDanmakuCount] = useState(100);
  const [coverCount, setCoverCount] = useState(2);
  const [coverPrompt, setCoverPrompt] = useState("");
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [coverStage, setCoverStage] = useState("");
  const [coverProgress, setCoverProgress] = useState(0);

  const drafts = useMemo(() => library?.drafts || [], [library?.drafts]);
  const selectedDraft = useMemo(() => drafts.find((draft) => draft.id === selectedId) || drafts[0] || null, [drafts, selectedId]);
  const supportsBilibili = selectedDraft ? draftSupportsBilibili(selectedDraft) : false;
  const references = selectedDraft?.assets?.cover?.references || [];
  const accountReferences = references.filter((reference) => reference.source === "account");
  const uploadedReferences = references.filter((reference) => reference.source === "upload");
  const noticeIsError = notice.includes("失败") || notice.includes("未配置") || notice.includes("不支持");

  useEffect(() => {
    const draftId = searchParams.get("draftId");
    if (draftId) setSelectedId(draftId);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedDraft) return;
    const available = (selectedDraft.assets?.cover?.references || []).map((reference) => reference.id);
    setSelectedReferenceIds((current) => {
      const kept = current.filter((id) => available.includes(id));
      return kept.length ? kept : available.slice(0, 3);
    });
  }, [selectedDraft]);

  async function handleGenerateEngagement() {
    if (!selectedDraft) return;
    setBusy("engagement");
    setNotice("");
    try {
      const result = await generateDraftEngagement({
        draftId: selectedDraft.id,
        commentCount,
        danmakuCount
      });
      setNotice(result.supportsDanmaku ? "评论和弹幕已生成。" : "评论已生成；当前草稿不支持 B站弹幕。");
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成评论和弹幕失败");
    } finally {
      setBusy("");
    }
  }

  async function handleCollectReferences() {
    if (!selectedDraft) return;
    setBusy("references");
    setNotice("");
    try {
      const result = await collectDraftCoverReferences(selectedDraft.id);
      setSelectedReferenceIds(result.references.slice(0, 3).map((reference) => reference.id));
      setNotice(result.supportsCover ? "账号封面参考图已更新。" : "当前草稿没有 B站参考账号，无法收集账号封面。");
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "收集封面参考图失败");
    } finally {
      setBusy("");
    }
  }

  async function handleUploadReferences(files: FileList | null) {
    if (!selectedDraft || !files?.length) return;
    setBusy("upload");
    setNotice("");
    try {
      const result = await uploadDraftCoverReferences({
        draftId: selectedDraft.id,
        files: Array.from(files)
      });
      setSelectedReferenceIds((current) => [...new Set([...current, ...result.references.map((reference) => reference.id)])]);
      setNotice("参考图已上传。");
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "上传参考图失败");
    } finally {
      setBusy("");
    }
  }

  async function handleGenerateCover() {
    if (!selectedDraft) return;
    setBusy("cover");
    setNotice("");
    setCoverStage("准备生成封面");
    setCoverProgress(8);
    try {
      await streamGenerateDraftCover(
        {
          draftId: selectedDraft.id,
          referenceIds: selectedReferenceIds,
          prompt: coverPrompt,
          count: coverCount
        },
        {
          onStage(stage) {
            setCoverStage(stage.message);
            setCoverProgress(stage.progress || 0);
          },
          onResult() {
            setNotice("封面已生成。");
          }
        }
      );
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成封面失败");
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setCoverStage("");
        setCoverProgress(0);
      }, 500);
    }
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    setNotice(message);
  }

  if (!loading && !drafts.length) {
    return (
      <div className="page">
        <header className="page-header workbench-header">
          <div>
            <p className="eyebrow">Assets</p>
            <h1>衍生素材</h1>
            <p className="subtle">先在写作台保存一篇草稿，再生成评论、弹幕和封面。</p>
          </div>
        </header>
        <EmptyState title="还没有草稿" body="衍生素材会跟随草稿保存。" action={{ href: "/writer", label: "去写作台" }} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Assets</p>
          <h1>衍生素材</h1>
          <p className="subtle">围绕已保存草稿生成观众评论、B站弹幕和 B站封面。</p>
        </div>
        <div className="button-row">
          <span className="stat-pill">{drafts.length} 个草稿</span>
          <button className="btn" onClick={refresh} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      {notice ? (
        <div aria-live={noticeIsError ? "assertive" : "polite"} className={noticeIsError ? "error" : "notice"} role={noticeIsError ? "alert" : "status"}>
          {notice}
        </div>
      ) : null}

      <section className="panel three-pane assets-workspace">
        <aside className="pane">
          <div className="pane-header">
            <h2>草稿</h2>
          </div>
          <div className="pane-body">
            <div className="status-summary">
              <span>{drafts.length} 个草稿</span>
              <span>选择后生成素材</span>
            </div>
            {drafts.map((draft) => (
              <button
                aria-current={selectedDraft?.id === draft.id ? "true" : undefined}
                className={`list-button ${selectedDraft?.id === draft.id ? "active" : ""}`}
                key={draft.id}
                onClick={() => setSelectedId(draft.id)}
                type="button"
              >
                <span>
                  <span className="list-title">{draft.title}</span>
                  <span className="list-meta">
                    {getDraftReferenceLabel(draft)} · {formatDate(draft.createdAt)}
                  </span>
                </span>
                <span className="status-pill done">{draft.assets ? "有素材" : "草稿"}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="pane assets-main-pane">
          <div className="pane-header">
            <div>
              <h2>{selectedDraft?.title || "素材生成"}</h2>
              <p className="pane-subtitle">{selectedDraft ? getDraftReferenceLabel(selectedDraft) : "选择草稿后开始"}</p>
            </div>
          </div>
          <div className="pane-body detail-stack">
            {selectedDraft ? (
              <>
                <div className="stat-row">
                  <span className="stat-pill">{selectedDraft.targetType === "project" ? "项目" : formatPlatform(selectedDraft.platform)}</span>
                  <span className="stat-pill">评论默认 50</span>
                  <span className="stat-pill">B站弹幕默认 100</span>
                  <span className={supportsBilibili ? "status-pill done" : "status-pill pending"}>{supportsBilibili ? "支持 B站封面" : "仅评论可用"}</span>
                </div>

                <section className="detail-section">
                  <div className="section-title-row">
                    <div>
                      <h3>观众评论与 B站弹幕</h3>
                      <p className="subtle">评论覆盖 B站 / 抖音，弹幕仅 B站草稿可用。</p>
                    </div>
                    <button className="btn primary" disabled={busy === "engagement"} onClick={handleGenerateEngagement} type="button">
                      <MessageCircle size={16} />
                      {busy === "engagement" ? "生成中..." : "生成"}
                    </button>
                  </div>
                  <div className="assets-control-grid">
                    <label className="field">
                      <span>评论条数</span>
                      <input min={1} max={200} type="number" value={commentCount} onChange={(event) => setCommentCount(Number(event.target.value))} />
                    </label>
                    <label className="field">
                      <span>B站弹幕条数</span>
                      <input min={1} max={300} type="number" value={danmakuCount} onChange={(event) => setDanmakuCount(Number(event.target.value))} />
                    </label>
                  </div>
                  <AssetTextList
                    empty="还没有评论。"
                    items={(selectedDraft.assets?.comments?.items || []).map((item) => item.text)}
                    title={`评论池 ${selectedDraft.assets?.comments?.items.length || 0}`}
                    onCopy={() => copyText((selectedDraft.assets?.comments?.items || []).map((item) => item.text).join("\n"), "评论已复制。")}
                  />
                  {supportsBilibili ? (
                    <AssetTextList
                      empty="还没有弹幕。"
                      items={(selectedDraft.assets?.danmaku?.items || []).map((item) => `${formatTime(item.timeSec)}  ${item.text}`)}
                      title={`B站弹幕 ${selectedDraft.assets?.danmaku?.items.length || 0}`}
                      onCopy={() =>
                        copyText((selectedDraft.assets?.danmaku?.items || []).map((item) => `${formatTime(item.timeSec)}\t${item.text}`).join("\n"), "弹幕已复制。")
                      }
                    />
                  ) : null}
                </section>

                <section className={`detail-section ${supportsBilibili ? "" : "disabled-card"}`}>
                  <div className="section-title-row">
                    <div>
                      <h3>B站封面</h3>
                      <p className="subtle">可从账号爆款封面和上传图片里选择参考图。</p>
                    </div>
                    <div className="button-row">
                      <button className="btn" disabled={!supportsBilibili || busy === "references"} onClick={handleCollectReferences} type="button">
                        <ImagePlus size={16} />
                        {busy === "references" ? "收集中..." : "账号封面"}
                      </button>
                      <label className="btn file-button">
                        <Upload size={16} />
                        上传图片
                        <input accept="image/*" disabled={!supportsBilibili || busy === "upload"} multiple type="file" onChange={(event) => handleUploadReferences(event.target.files)} />
                      </label>
                    </div>
                  </div>

                  <div className="assets-control-grid">
                    <label className="field">
                      <span>生成张数</span>
                      <input min={1} max={4} type="number" value={coverCount} onChange={(event) => setCoverCount(Number(event.target.value))} />
                    </label>
                    <label className="field">
                      <span>额外封面要求</span>
                      <input placeholder="例如：更强对比、人物留白、标题区明显" value={coverPrompt} onChange={(event) => setCoverPrompt(event.target.value)} />
                    </label>
                  </div>

                  {busy === "cover" ? (
                    <div className="project-progress" role="status" aria-live="polite">
                      <div className="project-progress-copy">
                        <span>{coverStage || "正在生成封面"}</span>
                        <strong>{coverProgress}%</strong>
                      </div>
                      <div className="progress-track" aria-hidden="true">
                        <div className="progress-fill" style={{ width: `${coverProgress}%` }} />
                      </div>
                    </div>
                  ) : null}

                  <ReferenceGrid
                    draftId={selectedDraft.id}
                    references={references}
                    selectedIds={selectedReferenceIds}
                    onToggle={(id) =>
                      setSelectedReferenceIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
                    }
                  />

                  <button className="btn primary" disabled={!supportsBilibili || busy === "cover"} onClick={handleGenerateCover} type="button">
                    <Play size={16} />
                    {busy === "cover" ? "生成中..." : "生成封面"}
                  </button>

                  <div className="cover-image-grid">
                    {(selectedDraft.assets?.cover?.images || []).map((image) => (
                      <a className="cover-card" href={draftAssetFileUrl(selectedDraft.id, image.path)} key={image.id} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt="生成封面" src={draftAssetFileUrl(selectedDraft.id, image.path)} />
                        <span>
                          <Download size={14} />
                          {formatDate(image.createdAt)}
                        </span>
                      </a>
                    ))}
                  </div>

                  {!accountReferences.length && !uploadedReferences.length ? <p className="subtle">先收集账号封面，或上传一张参考图。</p> : null}
                </section>
              </>
            ) : (
              <p className="subtle">选择一个草稿查看和生成衍生素材。</p>
            )}
          </div>
        </section>

        <aside className="pane">
          <div className="pane-header">
            <h2>文案</h2>
          </div>
          <div className="pane-body">
            {selectedDraft ? (
              <>
                <div className="stat-row">
                  <span className="stat-pill">{formatDate(selectedDraft.createdAt)}</span>
                </div>
                <article className="markdown-box draft-document">{selectedDraft.content}</article>
              </>
            ) : (
              <p className="subtle">暂无草稿。</p>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}

function AssetTextList({ title, items, empty, onCopy }: { title: string; items: string[]; empty: string; onCopy: () => void }) {
  return (
    <div className="asset-list-block">
      <div className="section-title-row">
        <h3>{title}</h3>
        <button className="btn" disabled={!items.length} onClick={onCopy} type="button">
          <Copy size={16} />
          复制
        </button>
      </div>
      <div className={`asset-text-list ${items.length ? "" : "empty"}`}>
        {items.length ? items.map((item, index) => <p key={`${index}-${item}`}>{item}</p>) : empty}
      </div>
    </div>
  );
}

function ReferenceGrid({
  draftId,
  references,
  selectedIds,
  onToggle
}: {
  draftId: string;
  references: DraftCoverReference[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (!references.length) return <p className="subtle">暂无参考图。</p>;
  return (
    <div className="reference-grid">
      {references.map((reference) => {
        const src = reference.path ? draftAssetFileUrl(draftId, reference.path) : reference.url || "";
        const selected = selectedIds.includes(reference.id);
        return (
          <button className={`reference-card ${selected ? "active" : ""}`} key={reference.id} onClick={() => onToggle(reference.id)} type="button">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={reference.label} src={src} />
            ) : (
              <span className="subtle">无预览</span>
            )}
            <span>
              <strong>{reference.source === "upload" ? "上传" : "账号"}</strong>
              <small>{reference.label}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AssetsFallback() {
  return (
    <div className="page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Assets</p>
          <h1>衍生素材</h1>
          <p className="subtle">正在读取素材模块。</p>
        </div>
      </header>
    </div>
  );
}

function getDraftReferenceLabel(draft: Draft) {
  return draft.targetType === "project" ? `项目 ${draft.projectName}` : `${formatPlatform(draft.platform)} / ${draft.accountName}`;
}

function draftSupportsBilibili(draft: Draft) {
  if (draft.targetType !== "project") return draft.platform === "bilibili";
  return Boolean(draft.styleRef.sourceAccountIds?.some((id) => id.startsWith("bilibili:")));
}

function formatTime(seconds: number) {
  const minute = Math.floor(seconds / 60);
  const second = seconds % 60;
  return `${minute}:${String(second).padStart(2, "0")}`;
}
