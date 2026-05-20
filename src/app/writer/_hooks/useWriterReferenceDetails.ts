"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { formatPlatform } from "@/components/Formatters";
import { cachedGetAccountDetail, cachedGetProjectDetail } from "@/lib/detail-cache";
import type { AccountDetail, AccountListItem, ProjectDetail, ProjectListItem } from "@/lib/types";

type UseWriterReferenceDetailsInput = {
  selectedAccount: AccountListItem | null;
  selectedProject: ProjectListItem | null;
  setNotice: Dispatch<SetStateAction<string>>;
  targetType: "account" | "project";
};

export function useWriterReferenceDetails({
  selectedAccount,
  selectedProject,
  setNotice,
  targetType
}: UseWriterReferenceDetailsInput) {
  const [accountDetail, setAccountDetail] = useState<AccountDetail | null>(null);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);

  const selectedAccountDetail = accountDetail?.id === selectedAccount?.id ? accountDetail : null;
  const selectedProjectDetail = projectDetail?.id === selectedProject?.id ? projectDetail : null;
  const selectedAccountDetailId = selectedAccount?.id || "";
  const selectedAccountDetailPlatform = selectedAccount?.platform;
  const selectedAccountUpdatedAt = selectedAccount?.updatedAt || "";
  const selectedProjectDetailId = selectedProject?.id || "";
  const selectedProjectUpdatedAt = selectedProject?.updatedAt || "";
  const activeStyle = targetType === "project" ? selectedProjectDetail?.style : selectedAccountDetail?.style;
  const activeTitle = targetType === "project" ? selectedProject?.name : selectedAccount?.name;
  const activeSubtitle =
    targetType === "project"
      ? `${selectedProject?.sourceAccounts.length || 0} 个参考账号`
      : selectedAccount
        ? formatPlatform(selectedAccount.platform)
        : "";

  useEffect(() => {
    let ignore = false;
    if (targetType !== "account" || !selectedAccountDetailId || !selectedAccountDetailPlatform) {
      setAccountDetail(null);
      return;
    }

    cachedGetAccountDetail({
      platform: selectedAccountDetailPlatform,
      accountId: selectedAccountDetailId,
      includeStyle: true,
      version: selectedAccountUpdatedAt
    })
      .then((detail) => {
        if (!ignore) setAccountDetail(detail);
      })
      .catch((err) => {
        if (!ignore) {
          setAccountDetail(null);
          setNotice(err instanceof Error ? err.message : "读取账号风格失败");
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedAccountDetailId, selectedAccountDetailPlatform, selectedAccountUpdatedAt, setNotice, targetType]);

  useEffect(() => {
    let ignore = false;
    if (targetType !== "project" || !selectedProjectDetailId) {
      setProjectDetail(null);
      return;
    }

    cachedGetProjectDetail(selectedProjectDetailId, {
      includeStyle: true,
      version: selectedProjectUpdatedAt
    })
      .then((detail) => {
        if (!ignore) setProjectDetail(detail);
      })
      .catch((err) => {
        if (!ignore) {
          setProjectDetail(null);
          setNotice(err instanceof Error ? err.message : "读取项目风格失败");
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedProjectDetailId, selectedProjectUpdatedAt, setNotice, targetType]);

  return useMemo(
    () => ({
      activeStyle,
      activeSubtitle,
      activeTitle,
      selectedAccountDetail,
      selectedProjectDetail
    }),
    [activeStyle, activeSubtitle, activeTitle, selectedAccountDetail, selectedProjectDetail]
  );
}
