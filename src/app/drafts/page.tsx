"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, MessageSquarePlus, PenLine, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { formatDate, formatPlatform } from "@/components/Formatters";
import { useLibrary } from "@/components/LibraryProvider";
import { Draft } from "@/lib/types";

export default function DraftsPage() {
  const { library, loading, refresh } = useLibrary();
  const [selectedId, setSelectedId] = useState("");
  const drafts = useMemo(() => library?.drafts || [], [library?.drafts]);

  const selectedDraft = useMemo(() => {
    return drafts.find((draft) => draft.id === selectedId) || drafts[0] || null;
  }, [drafts, selectedId]);

  async function handleCopy() {
    if (!selectedDraft) return;
    await navigator.clipboard.writeText(selectedDraft.content);
  }

  if (!loading && !drafts.length) {
    return (
      <div className="page">
        <header className="page-header workbench-header">
          <div>
            <p className="eyebrow">Drafts</p>
            <h1>草稿管理</h1>
            <p className="subtle">写作台保存后的内容会沉淀到这里。</p>
          </div>
        </header>
        <EmptyState title="还没有草稿" body="在对话写作页生成结果后点击“保存草稿”，内容会写入对应账号的 drafts 目录。" action={{ href: "/writer", label: "去写作台" }} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header workbench-header">
        <div>
          <p className="eyebrow">Drafts</p>
          <h1>草稿管理</h1>
          <p className="subtle">所有草稿来自本地账号目录，可按引用账号回溯风格来源。</p>
        </div>
        <div className="button-row">
          <span className="stat-pill">{drafts.length} 个草稿</span>
          <button className="btn" onClick={refresh} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      <section className="panel three-pane drafts-workspace">
        <aside className="pane">
          <div className="pane-header">
            <h2>草稿</h2>
          </div>
          <div className="pane-body">
            <div className="status-summary">
              <span>{drafts.length} 个草稿</span>
              <span>按保存时间排序</span>
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
                <span className="status-pill done">{draft.mode === "topic" ? "主题" : "改写"}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="pane">
          <div className="pane-header">
            <h2>{selectedDraft?.title || "草稿详情"}</h2>
            <div className="button-row">
              {selectedDraft ? (
                <Link className="btn" href={buildRewriteHref(selectedDraft)} title="带入对话写作继续改写">
                  <PenLine size={16} />
                  改写
                </Link>
              ) : null}
              {selectedDraft ? (
                <Link className="btn" href={`/assets?draftId=${encodeURIComponent(selectedDraft.id)}`} title="基于这篇草稿生成评论、弹幕和封面">
                  <MessageSquarePlus size={16} />
                  衍生素材
                </Link>
              ) : null}
              <button className="btn" disabled={!selectedDraft} onClick={handleCopy} type="button">
                <Copy size={16} />
                复制
              </button>
            </div>
          </div>
          <div className="pane-body detail-stack">
            {selectedDraft ? (
              <>
                <div className="stat-row">
                  <span className="stat-pill">{selectedDraft.targetType === "project" ? "项目" : formatPlatform(selectedDraft.platform)}</span>
                  <span className="stat-pill">参考 {getDraftReferenceLabel(selectedDraft)}</span>
                  <span className="stat-pill">{formatDate(selectedDraft.createdAt)}</span>
                </div>
                <div>
                  <h3>需求</h3>
                  <div className="code-box">{selectedDraft.prompt}</div>
                </div>
                {selectedDraft.input ? (
                  <div>
                    <h3>原文</h3>
                    <div className="code-box">{selectedDraft.input}</div>
                  </div>
                ) : null}
                <div>
                  <h3>生成结果</h3>
                  <article className="markdown-box draft-document">{selectedDraft.content}</article>
                </div>
              </>
            ) : (
              <p className="subtle">选择一个草稿查看内容。</p>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

function getDraftReferenceLabel(draft: Draft) {
  return draft.targetType === "project" ? `项目 ${draft.projectName}` : draft.accountName;
}

function buildRewriteHref(draft: Draft) {
  const params = new URLSearchParams({
    mode: "rewrite",
    draftId: draft.id
  });

  if (draft.targetType === "project") {
    params.set("targetType", "project");
    params.set("projectId", draft.projectId);
  } else {
    params.set("targetType", "account");
    params.set("accountId", draft.accountId);
  }

  return `/writer?${params.toString()}`;
}
