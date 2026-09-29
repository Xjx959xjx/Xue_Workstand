"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "@/components/FeedbackProvider";
import { confirmDiscardUnsavedChanges } from "@/components/UnsavedChangesGuard";
import {
  bulkSaveGrossMarginMonitorRecords,
  getGrossMarginLibrary,
  resetGrossMarginReviewTemplate,
  resolveGrossMarginVideoAccount,
  saveGrossMarginMonitorRecord,
  saveGrossMarginPriceTable,
  saveGrossMarginReviewTemplate
} from "@/lib/client";
import {
  GROSS_MARGIN_SERVICE_CONFIGS,
  calculateGrossMargin,
  formatAmountInput,
  getActiveServiceOptions,
  makeDefaultSelections,
  makeEmptyQuantityInputs,
  makePriceInputs,
  toAbsoluteMetricValue,
  toAmount
} from "@/lib/gross-margin-calculator";
import { renderGrossMarginReviewTemplate } from "@/lib/gross-margin-template";
import { detectVideoPlatform, normalizeVideoUrlInput } from "@/lib/platform-links";
import type {
  GrossMarginLibrary,
  GrossMarginPriceTableSaveItem,
  GrossMarginServiceKind
} from "@/lib/types";
import {
  buildEngagementTarget,
  buildGrossMarginTemplateValues,
  buildImportedMaintenanceState,
  countTemplateLines,
  findGrossMarginAccount,
  formatPlatform,
  getGrossMarginAccountPrice,
  getPlatformReviewTemplate,
  normalizeTemplateText,
  type AccountPriceKind,
  type GrossMarginImportedTemplate,
  type PlatformKey
} from "../_lib/gross-margin-workbench-model";

type BusyState = "" | "refresh" | "prices" | "price-editor" | "export" | "template" | "bulk-monitor";
type VideoAccountLookupState = {
  status: "idle" | "loading" | "matched" | "unmatched" | "error";
  message: string;
};

const pricePanelServiceConfigs = GROSS_MARGIN_SERVICE_CONFIGS.filter((config) => config.service !== "douPlus");

export function useGrossMarginWorkbench() {
  const { notify } = useFeedback();
  const [library, setLibrary] = useState<GrossMarginLibrary | null>(null);
  const [platform, setPlatform] = useState<PlatformKey>("douyin");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyState>("");
  const [accountName, setAccountName] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [accountPriceKind, setAccountPriceKind] = useState<AccountPriceKind>("custom");
  const [rebateRate, setRebateRate] = useState("");
  const [discountPrice, setDiscountPrice] = useState("");
  const [quantityInputs, setQuantityInputs] = useState<Record<GrossMarginServiceKind, string>>(
    makeEmptyQuantityInputs
  );
  const [selectedOptions, setSelectedOptions] = useState<Partial<Record<GrossMarginServiceKind, string>>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [bulkMonitorModalOpen, setBulkMonitorModalOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [priceEditorOpen, setPriceEditorOpen] = useState(false);
  const [splitDeliveryEnabled, setSplitDeliveryEnabled] = useState(false);
  const [videoAccountLookup, setVideoAccountLookup] = useState<VideoAccountLookupState>({
    status: "idle",
    message: ""
  });
  const accountNameRef = useRef("");
  const rebateRateRef = useRef("");
  const videoAccountLookupRequestRef = useRef(0);

  const tables = useMemo(() => library?.tables || [], [library]);
  const table = useMemo(
    () => tables.find((item) => item.platform === platform) || tables[0] || null,
    [platform, tables]
  );
  const priceDirty = Boolean(table?.items.some((item) =>
    priceInputs[item.id] !== undefined && priceInputs[item.id] !== String(item.unitPrice)
  ));
  const reviewTemplate = useMemo(() => getPlatformReviewTemplate(library, platform), [library, platform]);
  const platformAccounts = useMemo(
    () => (library?.accounts || []).filter((account) => account.platform === platform),
    [library, platform]
  );
  const matchedAccount = useMemo(
    () => findGrossMarginAccount(platformAccounts, accountName),
    [accountName, platformAccounts]
  );
  const activeServiceConfigs = useMemo(
    () => GROSS_MARGIN_SERVICE_CONFIGS.filter((config) =>
      table ? getActiveServiceOptions(table, config.service).length > 0 : false
    ),
    [table]
  );
  const activePricePanelServiceConfigs = useMemo(
    () => pricePanelServiceConfigs.filter((config) =>
      table ? getActiveServiceOptions(table, config.service).length > 0 : false
    ),
    [table]
  );
  const calculation = useMemo(
    () => calculateGrossMargin({
      discountPrice: toAmount(discountPrice),
      originalPrice: toAmount(originalPrice),
      configs: activeServiceConfigs,
      priceInputs,
      quantityInputs,
      selectedOptions,
      table
    }),
    [activeServiceConfigs, discountPrice, originalPrice, priceInputs, quantityInputs, selectedOptions, table]
  );
  const reviewTemplateValues = useMemo(
    () => buildGrossMarginTemplateValues({
      account: matchedAccount,
      accountName,
      calculation,
      platform,
      splitDeliveryEnabled,
      videoUrl
    }),
    [accountName, calculation, matchedAccount, platform, splitDeliveryEnabled, videoUrl]
  );
  const renderedReviewTemplate = useMemo(() => {
    try {
      return { text: renderGrossMarginReviewTemplate(reviewTemplate.content, reviewTemplateValues), error: "" };
    } catch (error) {
      return { text: "", error: error instanceof Error ? error.message : "文案模板无法渲染" };
    }
  }, [reviewTemplate, reviewTemplateValues]);
  const effectiveReviewTemplate = renderedReviewTemplate.text;
  const reviewTemplateLineCount = countTemplateLines(effectiveReviewTemplate || reviewTemplate.content);
  const configuredPriceCount = table?.items.filter((item) =>
    toAmount(priceInputs[item.id] ?? item.unitPrice) > 0
  ).length || 0;
  const engagementTarget = useMemo(
    () => buildEngagementTarget(calculation.lines, videoUrl),
    [calculation.lines, videoUrl]
  );

  useEffect(() => {
    let ignore = false;
    getGrossMarginLibrary()
      .then((result) => {
        if (ignore) return;
        setLibrary(result);
        applyLibraryTable(result, "douyin");
      })
      .catch((error) => {
        if (!ignore) {
          notify({ tone: "error", message: error instanceof Error ? error.message : "读取毛利单价表失败" });
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [notify]);

  useEffect(() => {
    const nextUrl = normalizeVideoUrlInput(videoUrl);
    if (!library || !nextUrl || !detectVideoPlatform(nextUrl)) {
      setVideoAccountLookup({ status: "idle", message: "" });
      return;
    }

    const requestId = videoAccountLookupRequestRef.current + 1;
    videoAccountLookupRequestRef.current = requestId;
    const accountNameBeforeLookup = accountNameRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setVideoAccountLookup({ status: "loading", message: "正在从视频链接识别账号…" });
      resolveGrossMarginVideoAccount(nextUrl, { signal: controller.signal })
        .then((result) => {
          if (videoAccountLookupRequestRef.current !== requestId) return;
          if (accountNameRef.current !== accountNameBeforeLookup) {
            setVideoAccountLookup({ status: "idle", message: "" });
            return;
          }

          const accounts = (library.accounts || []).filter((account) => account.platform === result.platform);
          const resolvedAccount = findGrossMarginAccount(accounts, result.accountName);
          const resolvedName = resolvedAccount?.name || result.accountName;
          accountNameRef.current = resolvedName;
          setAccountName(resolvedName);
          if (resolvedAccount) {
            const price = getGrossMarginAccountPrice(resolvedAccount, "custom");
            setAccountPriceKind(price.kind);
            setOriginalPrice(String(price.value));
            if (rebateRateRef.current.trim()) {
              setDiscountPrice(formatAmountInput(price.value * (1 - toAmount(rebateRateRef.current) / 100)));
            }
          }
          setVideoAccountLookup({
            status: resolvedAccount ? "matched" : "unmatched",
            message: resolvedAccount
              ? `已识别账号：${resolvedName}`
              : `已识别账号「${resolvedName}」，但报价表未匹配，请手动填写价格。`
          });
        })
        .catch((error) => {
          if (controller.signal.aborted || videoAccountLookupRequestRef.current !== requestId) return;
          setVideoAccountLookup({
            status: "error",
            message: error instanceof Error ? error.message : "视频账号识别失败，请手动填写账号名。"
          });
        });
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [library, videoUrl]);

  function applyLibraryTable(nextLibrary: GrossMarginLibrary, preferredPlatform: PlatformKey) {
    const nextTable = nextLibrary.tables.find((item) => item.platform === preferredPlatform) || nextLibrary.tables[0] || null;
    if (!nextTable) return;
    setPlatform(nextTable.platform);
    setPriceInputs(makePriceInputs(nextTable));
    setSelectedOptions(makeDefaultSelections(nextTable));
  }

  function handlePlatformChange(nextPlatform: PlatformKey) {
    if (nextPlatform === platform) return true;
    const nextTable = tables.find((item) => item.platform === nextPlatform);
    if (!nextTable) return false;
    if (priceDirty && !confirmDiscardUnsavedChanges("单价表有未保存的修改，切换平台会丢失这些修改。是否继续？")) return false;
    setPlatform(nextPlatform);
    setPriceInputs(makePriceInputs(nextTable));
    setSelectedOptions(makeDefaultSelections(nextTable));
    const nextAccount = findGrossMarginAccount(
      (library?.accounts || []).filter((account) => account.platform === nextPlatform),
      accountName
    );
    if (nextAccount) applyAccountPrice(nextAccount, "custom");
    return true;
  }

  function handleAccountNameChange(value: string) {
    accountNameRef.current = value;
    setAccountName(value);
    setVideoAccountLookup({ status: "idle", message: "" });
    const nextAccount = findGrossMarginAccount(platformAccounts, value);
    if (nextAccount) applyAccountPrice(nextAccount, "custom");
  }

  function handleVideoUrlChange(value: string) {
    const nextUrl = normalizeVideoUrlInput(value);
    const nextPlatform = detectVideoPlatform(nextUrl);
    if (nextPlatform && nextPlatform !== platform && !handlePlatformChange(nextPlatform)) return;
    setVideoUrl(nextUrl);
  }

  function updateOriginalPrice(value: string) {
    setOriginalPrice(value);
    if (rebateRate.trim()) {
      setDiscountPrice(formatAmountInput(toAmount(value) * (1 - toAmount(rebateRate) / 100)));
    }
  }

  function handleRebateRateChange(value: string) {
    rebateRateRef.current = value;
    setRebateRate(value);
    if (value.trim()) {
      setDiscountPrice(formatAmountInput(toAmount(originalPrice) * (1 - toAmount(value) / 100)));
    }
  }

  function applyAccountPrice(account: NonNullable<typeof matchedAccount>, preferredKind: AccountPriceKind) {
    const price = getGrossMarginAccountPrice(account, preferredKind);
    setAccountPriceKind(price.kind);
    updateOriginalPrice(String(price.value));
  }

  function handleAccountPriceKindChange(kind: AccountPriceKind) {
    setAccountPriceKind(kind);
    if (matchedAccount) applyAccountPrice(matchedAccount, kind);
  }

  async function handleRefresh() {
    if (priceDirty && !confirmDiscardUnsavedChanges("刷新会丢失尚未保存的单价修改。是否继续？")) return;
    setBusy("refresh");
    try {
      const result = await getGrossMarginLibrary({ fresh: true });
      setLibrary(result);
      applyLibraryTable(result, platform);
      notify({ tone: "success", message: "毛利单价表已刷新" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "刷新失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleSavePriceTable() {
    if (!table) return;
    setBusy("prices");
    try {
      const result = await saveGrossMarginPriceTable({
        platform: table.platform,
        items: table.items.map((item) => ({
          ...item,
          unitPrice: toAmount(priceInputs[item.id] ?? item.unitPrice)
        }))
      });
      setLibrary(result.library);
      setPriceInputs(makePriceInputs(result.table));
      notify({ tone: "success", message: `${formatPlatform(table.platform)}单价表已保存` });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "保存单价表失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleSaveFullPriceTable(items: GrossMarginPriceTableSaveItem[]) {
    if (!table) return;
    setBusy("price-editor");
    try {
      const result = await saveGrossMarginPriceTable({ platform: table.platform, items });
      setLibrary(result.library);
      setPriceInputs(makePriceInputs(result.table));
      setSelectedOptions(makeDefaultSelections(result.table));
      setPriceEditorOpen(false);
      notify({ tone: "success", message: `${formatPlatform(table.platform)}单价表已保存` });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "保存单价表失败" });
      throw error;
    } finally {
      setBusy("");
    }
  }

  async function handleExportReview() {
    if (busy) return;
    if (!videoUrl.trim()) {
      notify({ tone: "error", message: "请先补视频链接，再导出文案" });
      return;
    }
    if (renderedReviewTemplate.error) {
      notify({ tone: "error", message: renderedReviewTemplate.error });
      return;
    }
    setBusy("export");
    try {
      await navigator.clipboard.writeText(effectiveReviewTemplate);
      const result = await saveGrossMarginMonitorRecord({
        platform,
        accountName: matchedAccount?.name || accountName,
        videoUrl,
        sourceText: effectiveReviewTemplate,
        targetStats: Object.fromEntries(
          calculation.lines
            .filter((line) => line.quantity > 0)
            .map((line) => [line.service, toAbsoluteMetricValue(line)])
        )
      });
      setLibrary(result.library);
      notify({ tone: "success", message: "文案已复制，监控目标已保存" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "复制或保存监控目标失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleSaveReviewTemplate(value: string) {
    setBusy("template");
    try {
      const result = await saveGrossMarginReviewTemplate({ platform, content: normalizeTemplateText(value) });
      setLibrary(result.library);
      setTemplateModalOpen(false);
      notify({ tone: "success", message: `${formatPlatform(platform)}文案模板已永久保存` });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "保存文案模板失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleResetReviewTemplate() {
    setBusy("template");
    try {
      const result = await resetGrossMarginReviewTemplate(platform);
      setLibrary(result.library);
      setTemplateModalOpen(false);
      notify({ tone: "success", message: `${formatPlatform(platform)}文案模板已恢复系统默认` });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "恢复默认模板失败" });
    } finally {
      setBusy("");
    }
  }

  async function handleBulkMonitorSubmit(input: { template: string; createProject: boolean; projectName: string }) {
    setBusy("bulk-monitor");
    try {
      const result = await bulkSaveGrossMarginMonitorRecords(input);
      setLibrary(result.library);
      setBulkMonitorModalOpen(false);
      notify({
        tone: "success",
        message: result.project
          ? `已添加 ${result.records.length} 条监控，并创建项目「${result.project.name}」`
          : `已添加 ${result.records.length} 条监控`
      });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "添加监控失败" });
    } finally {
      setBusy("");
    }
  }

  function handleImportTemplate(template: GrossMarginImportedTemplate) {
    const imported = buildImportedMaintenanceState({
      accountName,
      accounts: library?.accounts || [],
      currentPlatform: platform,
      currentPriceInputs: priceInputs,
      currentTable: table,
      currentVideoUrl: videoUrl,
      tables,
      template
    });
    setPlatform(imported.platform);
    setPriceInputs(imported.priceInputs);
    setSelectedOptions(imported.selectedOptions);
    setQuantityInputs(imported.quantityInputs);
    accountNameRef.current = imported.accountName;
    setAccountName(imported.accountName);
    setVideoUrl(imported.videoUrl);
    if (imported.matchedAccount) applyAccountPrice(imported.matchedAccount, "custom");
    setImportModalOpen(false);
    notify({
      tone: "success",
      message: `已导入${template.metrics.length}个维护项${template.videoUrl ? "，链接已填" : ""}`
    });
  }

  return {
    accountName,
    accountPriceKind,
    activePricePanelServiceConfigs,
    activeServiceConfigs,
    bulkMonitorModalOpen,
    busy,
    calculation,
    configuredPriceCount,
    discountPrice,
    rebateRate,
    engagementTarget,
    importModalOpen,
    library,
    loading,
    matchedAccount,
    originalPrice,
    platform,
    platformAccounts,
    priceEditorOpen,
    priceInputs,
    priceDirty,
    quantityInputs,
    reviewTemplate,
    reviewTemplateLineCount,
    reviewTemplateValues,
    selectedOptions,
    splitDeliveryEnabled,
    table,
    templateModalOpen,
    videoUrl,
    videoAccountLookup,
    closeBulkMonitorModal: () => setBulkMonitorModalOpen(false),
    closeImportModal: () => setImportModalOpen(false),
    closePriceEditor: () => setPriceEditorOpen(false),
    closeTemplateModal: () => setTemplateModalOpen(false),
    handleAccountNameChange,
    handleBulkMonitorSubmit,
    handleAccountPriceKindChange,
    handleRebateRateChange,
    handleExportReview,
    handleImportTemplate,
    handlePlatformChange,
    handleRefresh,
    handleResetReviewTemplate,
    handleSaveFullPriceTable,
    handleSavePriceTable,
    handleSaveReviewTemplate,
    handleVideoUrlChange,
    openBulkMonitorModal: () => setBulkMonitorModalOpen(true),
    openImportModal: () => setImportModalOpen(true),
    openPriceEditor: () => setPriceEditorOpen(true),
    openTemplateModal: () => setTemplateModalOpen(true),
    setDiscountPrice,
    setPriceInput: (id: string, value: string) => setPriceInputs((current) => ({ ...current, [id]: value })),
    setQuantityInput: (service: GrossMarginServiceKind, value: string) =>
      setQuantityInputs((current) => ({ ...current, [service]: value })),
    setSelectedOption: (service: GrossMarginServiceKind, optionId: string) =>
      setSelectedOptions((current) => ({ ...current, [service]: optionId })),
    setSplitDeliveryEnabled,
    updateOriginalPrice
  };
}

export type GrossMarginWorkbenchController = ReturnType<typeof useGrossMarginWorkbench>;
