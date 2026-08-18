"use client";

import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "@/components/FeedbackProvider";
import {
  bulkSaveGrossMarginMonitorRecords,
  getGrossMarginLibrary,
  resetGrossMarginReviewTemplate,
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
  getPlatformReviewTemplate,
  normalizeTemplateText,
  type GrossMarginImportedTemplate,
  type PlatformKey
} from "../_lib/gross-margin-workbench-model";

type BusyState = "" | "refresh" | "prices" | "price-editor" | "export" | "template" | "bulk-monitor";

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
  const [discountRate, setDiscountRate] = useState("");
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

  const tables = useMemo(() => library?.tables || [], [library]);
  const table = useMemo(
    () => tables.find((item) => item.platform === platform) || tables[0] || null,
    [platform, tables]
  );
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

  function applyLibraryTable(nextLibrary: GrossMarginLibrary, preferredPlatform: PlatformKey) {
    const nextTable = nextLibrary.tables.find((item) => item.platform === preferredPlatform) || nextLibrary.tables[0] || null;
    if (!nextTable) return;
    setPlatform(nextTable.platform);
    setPriceInputs(makePriceInputs(nextTable));
    setSelectedOptions(makeDefaultSelections(nextTable));
  }

  function handlePlatformChange(nextPlatform: PlatformKey) {
    setPlatform(nextPlatform);
    const nextTable = tables.find((item) => item.platform === nextPlatform) || null;
    if (!nextTable) return;
    setPriceInputs(makePriceInputs(nextTable));
    setSelectedOptions(makeDefaultSelections(nextTable));
    const nextAccount = findGrossMarginAccount(
      (library?.accounts || []).filter((account) => account.platform === nextPlatform),
      accountName
    );
    if (nextAccount) updateOriginalPrice(String(nextAccount.defaultPrice));
  }

  function handleAccountNameChange(value: string) {
    setAccountName(value);
    const nextAccount = findGrossMarginAccount(platformAccounts, value);
    if (nextAccount) updateOriginalPrice(String(nextAccount.defaultPrice));
  }

  function handleVideoUrlChange(value: string) {
    const nextUrl = normalizeVideoUrlInput(value);
    setVideoUrl(nextUrl);
    const nextPlatform = detectVideoPlatform(nextUrl);
    if (nextPlatform && nextPlatform !== platform) handlePlatformChange(nextPlatform);
  }

  function updateOriginalPrice(value: string) {
    setOriginalPrice(value);
    if (discountRate.trim()) {
      setDiscountPrice(formatAmountInput(toAmount(value) * toAmount(discountRate) / 100));
    }
  }

  function handleDiscountRateChange(value: string) {
    setDiscountRate(value);
    if (value.trim()) {
      setDiscountPrice(formatAmountInput(toAmount(originalPrice) * toAmount(value) / 100));
    }
  }

  async function handleRefresh() {
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
    setAccountName(imported.accountName);
    setVideoUrl(imported.videoUrl);
    if (imported.matchedAccount) updateOriginalPrice(String(imported.matchedAccount.defaultPrice));
    setImportModalOpen(false);
    notify({
      tone: "success",
      message: `已导入${template.metrics.length}个维护项${template.videoUrl ? "，链接已填" : ""}`
    });
  }

  return {
    accountName,
    activePricePanelServiceConfigs,
    activeServiceConfigs,
    bulkMonitorModalOpen,
    busy,
    calculation,
    configuredPriceCount,
    discountPrice,
    discountRate,
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
    quantityInputs,
    reviewTemplate,
    reviewTemplateLineCount,
    reviewTemplateValues,
    selectedOptions,
    splitDeliveryEnabled,
    table,
    templateModalOpen,
    videoUrl,
    closeBulkMonitorModal: () => setBulkMonitorModalOpen(false),
    closeImportModal: () => setImportModalOpen(false),
    closePriceEditor: () => setPriceEditorOpen(false),
    closeTemplateModal: () => setTemplateModalOpen(false),
    handleAccountNameChange,
    handleBulkMonitorSubmit,
    handleDiscountRateChange,
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
