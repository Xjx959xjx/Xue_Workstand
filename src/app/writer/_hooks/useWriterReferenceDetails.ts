"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { formatPlatform } from "@/components/Formatters";
import { cachedGetAccountDetail, cachedGetProjectDetail, getCachedAccountDetail, getCachedProjectDetail } from "@/lib/detail-cache";
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
  const [accountDetail, setAccountDetail] = useState<AccountDetail | null>(() =>
    selectedAccount
      ? getCachedAccountDetail({
          platform: selectedAccount.platform,
          accountId: selectedAccount.id,
          includeStyle: true,
          version: selectedAccount.updatedAt
        })
      : null
  );
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(() =>
    selectedProject
      ? getCachedProjectDetail(selectedProject.id, {
          includeStyle: true,
          version: selectedProject.updatedAt
        })
      : null
  );
  const [accountDetailLoading, setAccountDetailLoading] = useState(false);
  const [projectDetailLoading, setProjectDetailLoading] = useState(false);
  const [failedAccountDetailId, setFailedAccountDetailId] = useState("");
  const [failedProjectDetailId, setFailedProjectDetailId] = useState("");

  const selectedAccountDetail = accountDetail?.id === selectedAccount?.id ? accountDetail : null;
  const selectedProjectDetail = projectDetail?.id === selectedProject?.id ? projectDetail : null;
  const selectedAccountDetailId = selectedAccount?.id || "";
  const selectedAccountDetailPlatform = selectedAccount?.platform;
  const selectedAccountUpdatedAt = selectedAccount?.updatedAt || "";
  const selectedProjectDetailId = selectedProject?.id || "";
  const selectedProjectUpdatedAt = selectedProject?.updatedAt || "";
  const activeStyle = targetType === "project" ? selectedProjectDetail?.style : selectedAccountDetail?.style;
  const activeStyleLoading =
    targetType === "project"
      ? projectDetailLoading || Boolean(selectedProjectDetailId && !selectedProjectDetail && failedProjectDetailId !== selectedProjectDetailId)
      : accountDetailLoading || Boolean(selectedAccountDetailId && !selectedAccountDetail && failedAccountDetailId !== selectedAccountDetailId);
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
      setAccountDetailLoading(false);
      return;
    }

    const detailInput = {
      platform: selectedAccountDetailPlatform,
      accountId: selectedAccountDetailId,
      includeStyle: true,
      version: selectedAccountUpdatedAt
    };
    const cachedDetail = getCachedAccountDetail(detailInput);
    if (cachedDetail) {
      setFailedAccountDetailId("");
      setAccountDetail(cachedDetail);
      setAccountDetailLoading(false);
      return;
    }

    setFailedAccountDetailId("");
    setAccountDetailLoading(true);
    cachedGetAccountDetail(detailInput)
      .then((detail) => {
        if (!ignore) setAccountDetail(detail);
      })
      .catch((err) => {
        if (!ignore) {
          setAccountDetail(null);
          setFailedAccountDetailId(selectedAccountDetailId);
          setNotice(err instanceof Error ? err.message : "读取账号风格失败");
        }
      })
      .finally(() => {
        if (!ignore) setAccountDetailLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedAccountDetailId, selectedAccountDetailPlatform, selectedAccountUpdatedAt, setNotice, targetType]);

  useEffect(() => {
    let ignore = false;
    if (targetType !== "project" || !selectedProjectDetailId) {
      setProjectDetail(null);
      setProjectDetailLoading(false);
      return;
    }

    const detailOptions = {
      includeStyle: true,
      version: selectedProjectUpdatedAt
    };
    const cachedDetail = getCachedProjectDetail(selectedProjectDetailId, detailOptions);
    if (cachedDetail) {
      setFailedProjectDetailId("");
      setProjectDetail(cachedDetail);
      setProjectDetailLoading(false);
      return;
    }

    setFailedProjectDetailId("");
    setProjectDetailLoading(true);
    cachedGetProjectDetail(selectedProjectDetailId, detailOptions)
      .then((detail) => {
        if (!ignore) setProjectDetail(detail);
      })
      .catch((err) => {
        if (!ignore) {
          setProjectDetail(null);
          setFailedProjectDetailId(selectedProjectDetailId);
          setNotice(err instanceof Error ? err.message : "读取项目风格失败");
        }
      })
      .finally(() => {
        if (!ignore) setProjectDetailLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedProjectDetailId, selectedProjectUpdatedAt, setNotice, targetType]);

  return useMemo(
    () => ({
      activeStyle,
      activeStyleLoading,
      activeSubtitle,
      activeTitle,
      selectedAccountDetail,
      selectedProjectDetail
    }),
    [activeStyle, activeStyleLoading, activeSubtitle, activeTitle, selectedAccountDetail, selectedProjectDetail]
  );
}
