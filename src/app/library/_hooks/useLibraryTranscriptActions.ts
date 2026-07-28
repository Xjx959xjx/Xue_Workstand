"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getTranscript, restoreTranscriptVersion, saveTranscript } from "@/lib/client";
import type { AccountDetail, TranscriptVersion, VideoListItem } from "@/lib/types";
import { canReadTranscript, makePreview, type LibraryMessageSetter } from "../_components/library-view-utils";

type ReloadAccountDetail = (options?: { includeStyle?: boolean; force?: boolean }) => Promise<AccountDetail | null>;

type UseLibraryTranscriptActionsInput = {
  refresh: () => Promise<void>;
  reloadSelectedAccountDetail: ReloadAccountDetail;
  selectedAccount: AccountDetail | null;
  selectedVideo: VideoListItem | null;
  setMessage: LibraryMessageSetter;
  onOpenEditor: () => void;
  onSaved: () => void;
};

export function useLibraryTranscriptActions({
  refresh,
  reloadSelectedAccountDetail,
  selectedAccount,
  selectedVideo,
  setMessage,
  onOpenEditor,
  onSaved
}: UseLibraryTranscriptActionsInput) {
  const [transcript, setTranscript] = useState("");
  const [transcriptRevision, setTranscriptRevision] = useState<string | null>(null);
  const [transcriptVersions, setTranscriptVersions] = useState<TranscriptVersion[]>([]);
  const [transcriptVideoId, setTranscriptVideoId] = useState("");
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptRestoring, setTranscriptRestoring] = useState(false);
  const [transcriptStale, setTranscriptStale] = useState(false);

  const selectedVideoHasTranscript = canReadTranscript(selectedVideo);
  const activeTranscript = selectedVideo && transcriptVideoId === selectedVideo.id ? transcript : "";
  const transcriptPreview = useMemo(() => makePreview(activeTranscript), [activeTranscript]);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setTranscriptRevision(null);
    setTranscriptVersions([]);
    setTranscriptVideoId("");
    setTranscriptStale(false);
  }, []);

  const invalidateTranscript = useCallback(() => {
    setTranscriptStale(true);
  }, []);

  useEffect(() => {
    clearTranscript();
  }, [clearTranscript, selectedVideo?.id]);

  const loadSelectedTranscript = useCallback(async () => {
    if (!selectedAccount || !selectedVideo || !canReadTranscript(selectedVideo)) return false;
    if (transcriptVideoId === selectedVideo.id && !transcriptStale) return true;

    setTranscriptLoading(true);
    try {
      const result = await getTranscript({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoId: selectedVideo.id
      });
      setTranscript(result.transcript);
      setTranscriptRevision(result.revision);
      setTranscriptVersions(result.versions);
      setTranscriptVideoId(selectedVideo.id);
      setTranscriptStale(false);
      return true;
    } catch (err) {
      clearTranscript();
      setMessage(err instanceof Error ? err.message : "读取转写稿失败", "error");
      return false;
    } finally {
      setTranscriptLoading(false);
    }
  }, [clearTranscript, selectedAccount, selectedVideo, setMessage, transcriptStale, transcriptVideoId]);

  const openTranscriptModal = useCallback(async () => {
    if (!selectedVideo) return;
    if (selectedVideoHasTranscript) {
      const loaded = await loadSelectedTranscript();
      if (!loaded) return;
    }
    onOpenEditor();
  }, [loadSelectedTranscript, onOpenEditor, selectedVideo, selectedVideoHasTranscript]);

  const updateTranscriptDraft = useCallback((value: string) => {
    setTranscript(value);
    setTranscriptVideoId(selectedVideo?.id || "");
  }, [selectedVideo?.id]);

  const handleSaveTranscript = useCallback(async (setBusy: (value: string) => void) => {
    if (!selectedAccount || !selectedVideo) return;
    setBusy("save-transcript");
    setMessage("");
    try {
      const result = await saveTranscript({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoId: selectedVideo.id,
        transcript,
        expectedRevision: transcriptRevision
      });
      setTranscript(result.transcript);
      setTranscriptRevision(result.revision);
      setTranscriptVersions(result.versions);
      setTranscriptVideoId(selectedVideo.id);
      setTranscriptStale(false);
      setMessage(result.previousVersionCreated ? "转写稿已保存，旧稿已归档到历史版本。" : "转写稿已保存。", "success");
      onSaved();
      await refresh();
      await reloadSelectedAccountDetail({ force: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存转写稿失败", "error");
    } finally {
      setBusy("");
    }
  }, [onSaved, refresh, reloadSelectedAccountDetail, selectedAccount, selectedVideo, setMessage, transcript, transcriptRevision]);

  const handleRestoreTranscript = useCallback(async (versionId: string) => {
    if (!selectedAccount || !selectedVideo || !versionId) return;
    setTranscriptRestoring(true);
    setMessage("");
    try {
      const result = await restoreTranscriptVersion({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoId: selectedVideo.id,
        versionId,
        expectedRevision: transcriptRevision
      });
      setTranscript(result.transcript);
      setTranscriptRevision(result.revision);
      setTranscriptVersions(result.versions);
      setTranscriptVideoId(selectedVideo.id);
      setTranscriptStale(false);
      setMessage("已恢复转写历史版本。", "success");
      await refresh();
      await reloadSelectedAccountDetail({ force: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "恢复转写历史版本失败", "error");
    } finally {
      setTranscriptRestoring(false);
    }
  }, [refresh, reloadSelectedAccountDetail, selectedAccount, selectedVideo, setMessage, transcriptRevision]);

  return {
    activeTranscript,
    clearTranscript,
    handleSaveTranscript,
    handleRestoreTranscript,
    invalidateTranscript,
    openTranscriptModal,
    selectedVideoHasTranscript,
    transcriptLoading,
    transcriptRestoring,
    transcriptPreview,
    transcriptVersions,
    updateTranscriptDraft
  };
}
