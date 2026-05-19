"use client";

import Link from "next/link";
import { Copy, FileUp, MessageSquarePlus, PenLine } from "lucide-react";
import { formatDate, formatPlatform } from "@/components/Formatters";
import type { Draft } from "@/lib/types";
import { buildRewriteHref, getDraftReferenceLabel } from "./draft-view-utils";

type DraftDetailPaneProps = {
  publishing: boolean;
  selectedDraft: Draft | null;
  onCopy: () => void;
  onPublishFeishu: () => void;
};

export function DraftDetailPane({ publishing, selectedDraft, onCopy, onPublishFeishu }: DraftDetailPaneProps) {
  return (
    <section className="pane">
      <div className="pane-header">
        <h2>{selectedDraft?.title || "草稿详情"}</h2>
        <div className="button-row">
          {selectedDraft ? (
            <Link className="btn" href={buildRewriteHref(selectedDraft)} title="带入对话写作继续改写">
              <PenLine aria-hidden="true" size={16} />
              改写
            </Link>
          ) : null}
          {selectedDraft ? (
            <Link className="btn" href={`/assets?draftId=${encodeURIComponent(selectedDraft.id)}`} title="基于这篇草稿生成评论和弹幕">
              <MessageSquarePlus size={16} />
              评论生成
            </Link>
          ) : null}
          <button className="btn" disabled={!selectedDraft || publishing} onClick={onPublishFeishu} type="button">
            <FileUp aria-hidden="true" size={16} />
            {publishing ? "输出中..." : "飞书文档"}
          </button>
          <button className="btn" disabled={!selectedDraft} onClick={onCopy} type="button">
            <Copy aria-hidden="true" size={16} />
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
  );
}
