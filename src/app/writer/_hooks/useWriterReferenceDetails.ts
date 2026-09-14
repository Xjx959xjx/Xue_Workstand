"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { formatPlatform } from "@/components/Formatters";
import { cachedGetAccountDetail, cachedGetProjectDetail, getCachedAccountDetail, getCachedProjectDetail } from "@/lib/detail-cache";
import { writeStyleReferenceKey } from "@/lib/write-references";
import type { AccountListItem, ProjectListItem, WriteStyleReferenceInput } from "@/lib/types";

export type WriterStyleCard = {
  key: string;
  title: string;
  subtitle: string;
  style?: string;
  loading: boolean;
  error?: string;
};

type UseWriterReferenceDetailsInput = {
  accounts: AccountListItem[];
  projects: ProjectListItem[];
  references: WriteStyleReferenceInput[];
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useWriterReferenceDetails({
  accounts,
  projects,
  references,
  setNotice
}: UseWriterReferenceDetailsInput) {
  const [styles, setStyles] = useState<Record<string, string | undefined>>({});
  const [loadingKeys, setLoadingKeys] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let ignore = false;
    const cachedStyles: Record<string, string | undefined> = {};
    const missing: Array<{ key: string; load: () => Promise<{ style?: string }> }> = [];

    for (const reference of references) {
      const key = writeStyleReferenceKey(reference);
      if (reference.targetType === "account") {
        const account = accounts.find((item) => item.id === reference.accountId && item.platform === reference.platform);
        if (!account) continue;
        const input = {
          platform: account.platform,
          accountId: account.id,
          includeStyle: true,
          version: account.updatedAt
        };
        const cached = getCachedAccountDetail(input);
        if (cached) cachedStyles[key] = cached.style;
        else missing.push({ key, load: () => cachedGetAccountDetail(input) });
        continue;
      }

      const project = projects.find((item) => item.id === reference.projectId);
      if (!project) continue;
      const options = { includeStyle: true, version: project.updatedAt };
      const cached = getCachedProjectDetail(project.id, options);
      if (cached) cachedStyles[key] = cached.style;
      else missing.push({ key, load: () => cachedGetProjectDetail(project.id, options) });
    }

    setStyles(cachedStyles);
    setErrors({});
    setLoadingKeys(missing.map((item) => item.key));
    if (!missing.length) return;

    missing.forEach(async ({ key, load }) => {
      try {
        const detail = await load();
        if (!ignore) setStyles((current) => ({ ...current, [key]: detail.style }));
      } catch (error) {
        if (ignore) return;
        const message = error instanceof Error ? error.message : "读取参考风格失败，请重试";
        setErrors((current) => ({ ...current, [key]: message }));
        setNotice(message);
      } finally {
        if (!ignore) setLoadingKeys((current) => current.filter((item) => item !== key));
      }
    });

    return () => {
      ignore = true;
    };
  }, [accounts, projects, references, setNotice]);

  return useMemo(() => {
    const styleCards = references.flatMap((reference): WriterStyleCard[] => {
      const key = writeStyleReferenceKey(reference);
      if (reference.targetType === "account") {
        const account = accounts.find((item) => item.id === reference.accountId && item.platform === reference.platform);
        return account ? [{
          key,
          title: account.name,
          subtitle: `账号风格 · ${formatPlatform(account.platform)}`,
          style: styles[key],
          loading: loadingKeys.includes(key),
          error: errors[key]
        }] : [];
      }
      const project = projects.find((item) => item.id === reference.projectId);
      return project ? [{
        key,
        title: project.name,
        subtitle: `项目风格 · ${project.sourceAccounts.length} 个参考账号`,
        style: styles[key],
        loading: loadingKeys.includes(key),
        error: errors[key]
      }] : [];
    });
    const activeStyle = styleCards.map((card) => card.style || "").filter(Boolean).join("\n\n");

    return {
      activeStyle,
      activeStyleLoading: loadingKeys.length > 0,
      activeStyleError: Object.keys(errors).length > 0,
      activeSubtitle: styleCards.length > 1
        ? `${styleCards.length} 个风格 · 将分别生成 ${styleCards.length} 篇`
        : styleCards[0]?.subtitle || "",
      activeTitle: styleCards.length > 1 ? `${styleCards.length} 个并发风格` : styleCards[0]?.title,
      styleCards
    };
  }, [accounts, errors, loadingKeys, projects, references, styles]);
}
