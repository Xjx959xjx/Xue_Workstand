"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { getTranscript, saveTranscript } from "@/lib/client";
import type { AccountDetail, VideoListItem } from "@/lib/types";
import { canReadTranscript, makePreview } from "../_components/library-view-utils";

type ReloadAccountDetail = (options?: { includeStyle?: boolean; force?: boolean }) => Promise<AccountDetail | null>;

type UseLibraryTranscriptActionsInput = {
  refresh: () => Promise<void>;
  reloadSelectedAccountDetail: ReloadAccountDetail;
  selectedAccount: AccountDetail | null;
  selectedVideo: VideoListItem | null;
  setMessage: Dispatch<SetStateAction<string>>;
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
  const [transcriptVideoId, setTranscriptVideoId] = useState("");
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const selectedVideoHasTranscript = canReadTranscript(selectedVideo);
  const activeTranscript = selectedVideo && transcriptVideoId === selectedVideo.id ? transcript : "";
  const transcriptPreview = useMemo(() => makePreview(activeTranscript), [activeTranscript]);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setTranscriptVideoId("");
  }, []);

  useEffect(() => {
    clearTranscript();
  }, [clearTranscript, selectedVideo?.id]);

  const loadSelectedTranscript = useCallback(async () => {
    if (!selectedAccount || !selectedVideo || !canReadTranscript(selectedVideo)) return false;
    if (transcriptVideoId === selectedVideo.id) return true;

    setTranscriptLoading(true);
    try {
      const result = await getTranscript({
        platform: selectedAccount.platform,
        accountId: selectedAccount.id,
        videoId: selectedVideo.id
      });
      setTranscript(result.transcript);
      setTranscriptVideoId(selectedVideo.id);
      return true;
    } catch (err) {
      clearTranscript();
      setMessage(err instanceof Error ? err.message : "读取转写稿失败");
      return false;
    } finally {
      setTranscriptLoading(false);
    }
  }, [clearTranscript, selectedAccount, selectedVideo, setMessage, transcriptVideoId]);

  useEffect(() => {
    void loadSelectedTranscript();
  }, [loadSelectedTranscript]);

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
        transcript
      });
      setTranscript(result.transcript);
      setTranscriptVideoId(selectedVideo.id);
      setMessage("转写稿已保存。");
      onSaved();
      await refresh();
      await reloadSelectedAccountDetail({ force: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存转写稿失败");
    } finally {
      setBusy("");
    }
  }, [onSaved, refresh, reloadSelectedAccountDetail, selectedAccount, selectedVideo, setMessage, transcript]);

  return {
    activeTranscript,
    clearTranscript,
    handleSaveTranscript,
    openTranscriptModal,
    selectedVideoHasTranscript,
    setTranscript,
    setTranscriptVideoId,
    transcriptLoading,
    transcriptPreview,
    updateTranscriptDraft
  };
}
