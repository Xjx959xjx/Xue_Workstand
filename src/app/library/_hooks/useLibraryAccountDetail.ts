"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { cachedGetAccountDetail } from "@/lib/detail-cache";
import type { AccountDetail, AccountListItem } from "@/lib/types";

type ReloadOptions = {
  includeStyle?: boolean;
  force?: boolean;
};

type UseLibraryAccountDetailInput = {
  selectedAccountMeta: AccountListItem | null;
  setStyleDraft: Dispatch<SetStateAction<string>>;
};

export function useLibraryAccountDetail({ selectedAccountMeta, setStyleDraft }: UseLibraryAccountDetailInput) {
  const [accountDetail, setAccountDetail] = useState<AccountDetail | null>(null);
  const [accountDetailLoading, setAccountDetailLoading] = useState(false);
  const [accountDetailError, setAccountDetailError] = useState("");

  const selectedAccountDetailId = selectedAccountMeta?.id || "";
  const selectedAccountDetailPlatform = selectedAccountMeta?.platform;
  const selectedAccountUpdatedAt = selectedAccountMeta?.updatedAt || "";

  const reloadSelectedAccountDetail = useCallback(async (options: ReloadOptions = {}) => {
    if (!selectedAccountDetailId || !selectedAccountDetailPlatform) return null;
    const detail = await cachedGetAccountDetail({
      platform: selectedAccountDetailPlatform,
      accountId: selectedAccountDetailId,
      includeStyle: options.includeStyle,
      version: selectedAccountUpdatedAt,
      force: options.force ?? true
    });
    setAccountDetail((current) => {
      if (!current || current.id !== detail.id || typeof detail.style === "string") return detail;
      if (typeof current.style === "string") return { ...detail, style: current.style };
      return detail;
    });
    if (typeof detail.style === "string") setStyleDraft(detail.style);
    return detail;
  }, [selectedAccountDetailId, selectedAccountDetailPlatform, selectedAccountUpdatedAt, setStyleDraft]);

  useEffect(() => {
    let ignore = false;
    if (!selectedAccountDetailId || !selectedAccountDetailPlatform) {
      setAccountDetail(null);
      setAccountDetailError("");
      setAccountDetailLoading(false);
      return;
    }

    setAccountDetailLoading(true);
    setAccountDetailError("");
    cachedGetAccountDetail({
      platform: selectedAccountDetailPlatform,
      accountId: selectedAccountDetailId,
      includeStyle: true,
      version: selectedAccountUpdatedAt
    })
      .then((detail) => {
        if (ignore) return;
        setAccountDetail(detail);
        setStyleDraft(typeof detail.style === "string" ? detail.style : "");
      })
      .catch((err) => {
        if (ignore) return;
        setAccountDetail(null);
        setAccountDetailError(err instanceof Error ? err.message : "读取账号详情失败");
      })
      .finally(() => {
        if (!ignore) setAccountDetailLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedAccountDetailId, selectedAccountDetailPlatform, selectedAccountUpdatedAt, setStyleDraft]);

  return {
    accountDetail,
    accountDetailError,
    accountDetailLoading,
    reloadSelectedAccountDetail,
    selectedAccountDetailId,
    selectedAccountDetailPlatform,
    setAccountDetail
  };
}
