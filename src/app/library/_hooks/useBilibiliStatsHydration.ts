"use client";

import { useEffect, useState } from "react";
import { hydrateVideo } from "@/lib/client";
import type { AccountDetail } from "@/lib/types";

type UseBilibiliStatsHydrationInput = {
  refresh: () => Promise<void>;
  reloadSelectedAccountDetail: (options?: { includeStyle?: boolean; force?: boolean }) => Promise<AccountDetail | null>;
  selectedAccount: AccountDetail | null;
};

export function useBilibiliStatsHydration({
  refresh,
  reloadSelectedAccountDetail,
  selectedAccount
}: UseBilibiliStatsHydrationInput) {
  const [hydratedStatsAccounts, setHydratedStatsAccounts] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedAccount || selectedAccount.platform !== "bilibili") return;
    if (hydratedStatsAccounts.includes(selectedAccount.id)) return;

    const missingStats = selectedAccount.videos
      .filter((video) => video.stats.likes === 0 || video.stats.comments === 0 || video.stats.favorites === 0)
      .slice(0, 10);
    if (!missingStats.length) return;

    let ignore = false;
    setHydratedStatsAccounts((current) => (current.includes(selectedAccount.id) ? current : [...current, selectedAccount.id]));
    Promise.allSettled(
      missingStats.map((video) =>
        hydrateVideo({
          platform: selectedAccount.platform,
          accountId: selectedAccount.id,
          videoId: video.id
        })
      )
    ).then(async () => {
      if (!ignore) {
        await refresh();
        await reloadSelectedAccountDetail({ force: true });
      }
    });

    return () => {
      ignore = true;
    };
  }, [hydratedStatsAccounts, refresh, reloadSelectedAccountDetail, selectedAccount]);
}
