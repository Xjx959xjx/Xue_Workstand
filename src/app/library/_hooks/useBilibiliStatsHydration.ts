"use client";

import { useEffect, useRef, useState } from "react";
import { useFeedback } from "@/components/FeedbackProvider";
import { hydrateVideo } from "@/lib/client";
import type { AccountDetail } from "@/lib/types";

type UseBilibiliStatsHydrationInput = {
  refresh: () => Promise<void>;
  reloadSelectedAccountDetail: (options?: { includeStyle?: boolean; force?: boolean }) => Promise<AccountDetail | null>;
  selectedAccount: AccountDetail | null;
};

type HydrationStatus = "hydrating" | "done" | "failed";
type HydrationState = {
  key: string;
  status: HydrationStatus;
};

export function useBilibiliStatsHydration({
  refresh,
  reloadSelectedAccountDetail,
  selectedAccount
}: UseBilibiliStatsHydrationInput) {
  const { notify } = useFeedback();
  const hydrationByAccountRef = useRef<Record<string, HydrationState>>({});
  const [hydrationRetryVersion, setHydrationRetryVersion] = useState(0);

  useEffect(() => {
    if (!selectedAccount || selectedAccount.platform !== "bilibili") return;

    const missingStats = selectedAccount.videos
      .filter((video) => video.stats.likes === 0 || video.stats.comments === 0 || video.stats.favorites === 0)
      .slice(0, 10);
    if (!missingStats.length) return;

    const accountId = selectedAccount.id;
    const accountName = selectedAccount.name;
    const hydrationKey = missingStats.map((video) => video.id).join("|");
    const hydrationState = hydrationByAccountRef.current[accountId];
    if (hydrationState?.key === hydrationKey) return;

    let ignore = false;
    hydrationByAccountRef.current = {
      ...hydrationByAccountRef.current,
      [accountId]: { key: hydrationKey, status: "hydrating" }
    };
    Promise.allSettled(
      missingStats.map((video) =>
        hydrateVideo({
          platform: selectedAccount.platform,
          accountId,
          videoId: video.id
        })
      )
    ).then(async (results) => {
      if (ignore) {
        hydrationByAccountRef.current = clearHydrationState(hydrationByAccountRef.current, accountId, hydrationKey);
        return;
      }

      const failedResults = results.filter(isRejectedResult);
      const succeededCount = results.length - failedResults.length;
      let refreshError: unknown = null;
      if (succeededCount > 0) {
        try {
          await refresh();
          await reloadSelectedAccountDetail({ force: true });
        } catch (err) {
          refreshError = err;
        }
      }

      if (!ignore) {
        if (!failedResults.length && !refreshError) {
          hydrationByAccountRef.current = {
            ...hydrationByAccountRef.current,
            [accountId]: { key: hydrationKey, status: "done" }
          };
          return;
        }

        hydrationByAccountRef.current = {
          ...hydrationByAccountRef.current,
          [accountId]: { key: hydrationKey, status: "failed" }
        };
        notify({
          tone: succeededCount > 0 ? "warning" : "error",
          title: "B站统计补全失败",
          message: buildHydrationFailureMessage(accountName, succeededCount, failedResults.length, refreshError || failedResults[0]?.reason),
          durationMs: 10000,
          action: {
            label: "重试",
            onClick: () => {
              hydrationByAccountRef.current = clearHydrationState(hydrationByAccountRef.current, accountId, hydrationKey);
              setHydrationRetryVersion((version) => version + 1);
            }
          }
        });
      }
    });

    return () => {
      ignore = true;
    };
  }, [hydrationRetryVersion, notify, refresh, reloadSelectedAccountDetail, selectedAccount]);
}

function clearHydrationState(
  current: Record<string, HydrationState>,
  accountId: string,
  hydrationKey: string
) {
  if (current[accountId]?.key !== hydrationKey) return current;
  const next = { ...current };
  delete next[accountId];
  return next;
}

function isRejectedResult<T>(result: PromiseSettledResult<T>): result is PromiseRejectedResult {
  return result.status === "rejected";
}

function buildHydrationFailureMessage(
  accountName: string,
  succeededCount: number,
  failedCount: number,
  error: unknown
) {
  const reason = error instanceof Error ? error.message : "";
  if (succeededCount > 0 && failedCount === 0) {
    return `「${accountName}」已补全 ${succeededCount} 条，但刷新页面状态失败${reason ? `：${reason}。` : "。"}可稍后重试。`;
  }
  const prefix = succeededCount > 0
    ? `「${accountName}」已补全 ${succeededCount} 条，仍有 ${failedCount} 条失败`
    : `「${accountName}」互动数据未能补全`;
  return `${prefix}${reason ? `：${reason}。` : "。"}可稍后重试。`;
}
