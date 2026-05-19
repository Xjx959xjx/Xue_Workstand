"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { useFeedback } from "@/components/FeedbackProvider";
import { useLibrary } from "@/components/LibraryProvider";
import { useManagedSelection } from "@/app/_hooks/useManagedSelection";
import { deleteDrafts, getDrafts, publishFeishuDocument } from "@/lib/client";
import type { Draft } from "@/lib/types";
import { DraftDetailPane } from "./_components/DraftDetailPane";
import { DraftListPane } from "./_components/DraftListPane";
import { DraftsHeader } from "./_components/DraftsHeader";
import { DraftFeishuModal } from "./_components/DraftFeishuModal";

export default function DraftsPage() {
  const { library, loading, error, refresh } = useLibrary();
  const { notify } = useFeedback();
  const [selectedId, setSelectedId] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [feishuResult, setFeishuResult] = useState<{ title: string; url: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [fullDrafts, setFullDrafts] = useState<Draft[] | null>(null);
  const draftSelection = useManagedSelection();
  const drafts = useMemo(() => fullDrafts || library?.drafts || [], [fullDrafts, library?.drafts]);
  const selectedDraft = useMemo(() => {
    return drafts.find((draft) => draft.id === selectedId) || drafts[0] || null;
  }, [drafts, selectedId]);
  const messageIsError = message.includes("失败") || message.includes("没有") || message.includes("不合法");
  const draftsLoading = loading || (fullDrafts === null && Boolean(library?.drafts.length));

  useEffect(() => {
    if (!message) return;
    notify({ tone: messageIsError ? "error" : "success", message });
  }, [message, messageIsError, notify]);

  useEffect(() => {
    let ignore = false;
    if (loading) return;
    getDrafts()
      .then((result) => {
        if (!ignore) setFullDrafts(result.drafts);
      })
      .catch((err) => {
        if (!ignore) setMessage(err instanceof Error ? err.message : "读取草稿失败");
      });
    return () => {
      ignore = true;
    };
  }, [loading, library?.drafts.length]);

  async function handleRefreshDrafts() {
    try {
      const [draftResult] = await Promise.all([getDrafts(), refresh()]);
      setFullDrafts(draftResult.drafts);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "刷新草稿失败");
    }
  }

  async function handleCopy() {
    if (!selectedDraft) return;
    await navigator.clipboard.writeText(selectedDraft.content);
  }

  async function handlePublishFeishu() {
    if (!selectedDraft) return;
    setBusy("feishu-draft");
    setMessage("");
    try {
      const result = await publishFeishuDocument({
        title: selectedDraft.title || "草稿文档",
        content: selectedDraft.content
      });
      setFeishuResult({ title: result.title, url: result.url });
      setMessage("已输出到飞书文档，可以在弹窗中打开。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "发布飞书文档失败，请检查 lark-cli 登录状态和文件夹配置。");
    } finally {
      setBusy("");
    }
  }

  function selectDraft(draftId: string) {
    if (draftSelection.manageMode) {
      draftSelection.toggleSelectedId(draftId);
      return;
    }
    setSelectedId(draftId);
  }

  async function handleDeleteSelectedDrafts() {
    if (!draftSelection.selectedIds.length) return;
    setBusy("draft-delete");
    setMessage("");
    try {
      const result = await deleteDrafts(draftSelection.selectedIds);
      if (selectedDraft && draftSelection.selectedIds.includes(selectedDraft.id)) {
        setSelectedId("");
      }
      draftSelection.clearSelection();
      setDeleteConfirmOpen(false);
      setMessage(`已删除 ${result.deleted.length} 个草稿。`);
      setFullDrafts((current) => current?.filter((draft) => !result.deleted.includes(draft.id)) || current);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除草稿失败");
    } finally {
      setBusy("");
    }
  }

  if (!draftsLoading && !drafts.length) {
    return (
      <div className="page drafts-page">
        <DraftsHeader />
        <EmptyState title="还没有草稿" body="在对话写作页生成结果后，内容会自动写入对应账号或项目的 drafts 目录。" action={{ href: "/writer", label: "去写作台" }} />
      </div>
    );
  }

  return (
    <div className="page drafts-page">
      <DraftsHeader count={drafts.length} showActions onRefresh={handleRefreshDrafts} />
      {error ? <div className="error" role="alert">{error}</div> : null}
      <section className="panel three-pane drafts-workspace">
        <DraftListPane
          busy={busy}
          draftManageMode={draftSelection.manageMode}
          drafts={drafts}
          selectedDraft={selectedDraft}
          selectedDraftIds={draftSelection.selectedIds}
          onDeleteClick={() => setDeleteConfirmOpen(true)}
          onManageModeChange={draftSelection.setManageMode}
          onSelectDraft={selectDraft}
        />
        <DraftDetailPane
          publishing={busy === "feishu-draft"}
          selectedDraft={selectedDraft}
          onCopy={handleCopy}
          onPublishFeishu={handlePublishFeishu}
        />
      </section>
      {feishuResult ? (
        <DraftFeishuModal result={feishuResult} onClose={() => setFeishuResult(null)} />
      ) : null}
      {deleteConfirmOpen ? (
        <ConfirmDialog
          title="删除草稿"
          body={`将删除 ${draftSelection.selectedIds.length} 个草稿及对应素材文件，此操作无法撤销。`}
          busy={busy === "draft-delete"}
          confirmLabel="删除草稿"
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={handleDeleteSelectedDrafts}
        />
      ) : null}
    </div>
  );
}
