"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClipboardEvent } from "react";
import Link from "next/link";
import { Activity, Calculator, Copy, RefreshCw, Save, Search, Upload } from "lucide-react";
import { useFeedback } from "@/components/FeedbackProvider";
import { getGrossMarginLibrary, saveGrossMarginMonitorRecord, saveGrossMarginPriceTable } from "@/lib/client";
import { detectVideoPlatform, extractVideoUrl, normalizeVideoUrlInput } from "@/lib/video-links";
import { GrossMarginDifferenceModal } from "./_components/GrossMarginDifferenceModal";
import { GrossMarginImportModal, type GrossMarginImportedTemplate } from "./_components/GrossMarginImportModal";
import type {
  GrossMarginCalculationLine,
  GrossMarginCalculationResult,
  GrossMarginAccountPrice,
  GrossMarginLibrary,
  GrossMarginPriceOption,
  GrossMarginPriceTable,
  GrossMarginServiceKind
} from "@/lib/types";

type PlatformKey = GrossMarginPriceTable["platform"];

type ServiceConfig = {
  service: GrossMarginServiceKind;
  label: string;
};

const platformOptions: Array<{ value: PlatformKey; label: string }> = [
  { value: "douyin", label: "抖音" },
  { value: "bilibili", label: "B站" }
];

const serviceConfigs: ServiceConfig[] = [
  { service: "play", label: "播放" },
  { service: "like", label: "点赞" },
  { service: "favorite", label: "收藏" },
  { service: "share", label: "转发" },
  { service: "comment", label: "评论" },
  { service: "danmaku", label: "弹幕" },
  { service: "douPlus", label: "dou+" },
  { service: "coin", label: "投币" },
  { service: "blueLink", label: "蓝链点击" }
];

const pricePanelServiceConfigs = serviceConfigs.filter((config) => config.service !== "douPlus");

export default function GrossMarginPage() {
  const { notify } = useFeedback();
  const [library, setLibrary] = useState<GrossMarginLibrary | null>(null);
  const [platform, setPlatform] = useState<PlatformKey>("douyin");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [accountName, setAccountName] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [discountRate, setDiscountRate] = useState("");
  const [discountPrice, setDiscountPrice] = useState("");
  const [quantityInputs, setQuantityInputs] = useState<Record<GrossMarginServiceKind, string>>({
    play: "",
    like: "",
    douPlus: "",
    coin: "",
    comment: "",
    share: "",
    favorite: "",
    danmaku: "",
    blueLink: ""
  });
  const [selectedOptions, setSelectedOptions] = useState<Partial<Record<GrossMarginServiceKind, string>>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [differenceModalOpen, setDifferenceModalOpen] = useState(false);
  const [splitDeliveryEnabled, setSplitDeliveryEnabled] = useState(false);
  const tables = useMemo(() => library?.tables || [], [library]);
  const table = useMemo(
    () => tables.find((item) => item.platform === platform) || tables[0] || null,
    [platform, tables]
  );
  const platformAccounts = useMemo(
    () => (library?.accounts || []).filter((account) => account.platform === platform),
    [library, platform]
  );
  const matchedAccount = useMemo(
    () => findGrossMarginAccount(platformAccounts, accountName),
    [accountName, platformAccounts]
  );
  const activeServiceConfigs = useMemo(
    () => serviceConfigs.filter((config) => (table ? getServiceOptions(table, config.service).length > 0 : false)),
    [table]
  );
  const activePricePanelServiceConfigs = useMemo(
    () => pricePanelServiceConfigs.filter((config) => (table ? getServiceOptions(table, config.service).length > 0 : false)),
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
  const reviewDraft = useMemo(
    () => buildGrossMarginReview({
      account: matchedAccount,
      accountName,
      calculation,
      platform,
      splitDeliveryEnabled,
      videoUrl
    }),
    [accountName, calculation, matchedAccount, platform, splitDeliveryEnabled, videoUrl]
  );
  const configuredPriceCount = table?.items.filter((item) => toAmount(priceInputs[item.id] ?? item.unitPrice) > 0).length || 0;

  useEffect(() => {
    let ignore = false;
    getGrossMarginLibrary()
      .then((result) => {
        if (ignore) return;
        setLibrary(result);
        const nextTable = result.tables.find((item) => item.platform === "douyin") || result.tables[0] || null;
        if (nextTable) {
          setPlatform(nextTable.platform);
          setPriceInputs(makePriceInputs(nextTable));
          setSelectedOptions(makeDefaultSelections(nextTable));
        }
      })
      .catch((error) => {
        if (!ignore) notify({ tone: "error", message: error instanceof Error ? error.message : "读取毛利单价表失败" });
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [notify]);

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
    if (nextPlatform && nextPlatform !== platform) {
      handlePlatformChange(nextPlatform);
    }
  }

  function handleVideoUrlPaste(event: ClipboardEvent<HTMLInputElement>) {
    const extractedUrl = extractVideoUrl(event.clipboardData.getData("text"));
    if (!extractedUrl) return;
    event.preventDefault();
    handleVideoUrlChange(extractedUrl);
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
      const result = await getGrossMarginLibrary();
      setLibrary(result);
      const nextTable = result.tables.find((item) => item.platform === platform) || result.tables[0] || null;
      if (nextTable) {
        setPlatform(nextTable.platform);
        setPriceInputs(makePriceInputs(nextTable));
        setSelectedOptions(makeDefaultSelections(nextTable));
      }
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

  async function handleExportReview() {
    if (!videoUrl.trim()) {
      notify({ tone: "error", message: "请先补视频链接，再导出审核文案" });
      return;
    }
    try {
      await navigator.clipboard.writeText(reviewDraft);
      if (platform !== "bilibili") {
        notify({ tone: "success", message: "审核文案已复制" });
        return;
      }
      const result = await saveGrossMarginMonitorRecord({
        platform,
        accountName: matchedAccount?.name || accountName,
        videoUrl,
        sourceText: reviewDraft,
        targetStats: Object.fromEntries(
          calculation.lines
            .filter((line) => line.quantity > 0)
            .map((line) => [line.service, toAbsoluteMetricValue(line)])
        )
      });
      setLibrary(result.library);
      notify({ tone: "success", message: "审核文案已复制，监控目标已保存" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "复制或保存监控目标失败" });
    }
  }

  function handleImportTemplate(template: GrossMarginImportedTemplate) {
    const nextPlatform = template.platform || platform;
    const nextTable = tables.find((item) => item.platform === nextPlatform) || table;
    const defaultSelections = nextTable ? makeDefaultSelections(nextTable) : {};
    const nextSelectedOptions: Partial<Record<GrossMarginServiceKind, string>> = { ...defaultSelections };
    const nextQuantityInputs = makeEmptyQuantityInputs();

    if (nextTable) {
      for (const metric of template.metrics) {
        const options = getServiceOptions(nextTable, metric.service);
        const option = findImportedOption(options, metric);
        if (option) nextSelectedOptions[metric.service] = option.id;
        const selectedOption = option || getSelectedOption(options, nextSelectedOptions[metric.service]);
        if (selectedOption) {
          nextQuantityInputs[metric.service] = formatImportedQuantity(metric.rawValue, selectedOption.quantityUnit);
        }
      }
    }

    setPlatform(nextPlatform);
    if (nextTable) {
      setPriceInputs(makePriceInputs(nextTable));
    }
    setSelectedOptions(nextSelectedOptions);
    setQuantityInputs(nextQuantityInputs);
    const nextAccountName = template.accountName || accountName;
    setAccountName(nextAccountName);
    if (template.videoUrl) setVideoUrl(template.videoUrl);

    const importedAccounts = (library?.accounts || []).filter((account) => account.platform === nextPlatform);
    const nextAccount = findGrossMarginAccount(importedAccounts, nextAccountName);
    if (nextAccount) {
      updateOriginalPrice(String(nextAccount.defaultPrice));
    }

    setImportModalOpen(false);
    notify({
      tone: "success",
      message: `已导入${template.metrics.length}个维护项${template.videoUrl ? "，链接已填" : ""}`
    });
  }

  return (
    <div className="page gross-margin-page">
      <header className="page-header">
        <div>
          <h1 className="title-with-emoji">
            <span aria-hidden="true" className="title-emoji">
              🧮
            </span>
            <span>数据维护</span>
          </h1>
          <p className="subtle">左边改报价，中间填本次数量，右边自动算维护成本和毛利率。</p>
        </div>
        <div className="button-row">
          <span className="stat-pill">2 个平台</span>
          <span className="stat-pill">{configuredPriceCount} 个单价已填</span>
          <button className="btn" disabled={busy === "refresh"} onClick={() => void handleRefresh()} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            {busy === "refresh" ? "刷新中" : "刷新"}
          </button>
        </div>
      </header>

      <section className="panel three-pane gross-margin-workspace" aria-label="数据维护工作区">
        <aside className="pane gross-price-pane">
          <div className="pane-header">
            <div>
              <h2>平台单价表</h2>
              <p className="pane-subtitle">这里只改默认单价</p>
            </div>
          </div>
          <div className="pane-body">
            <div className="source-tabs gross-platform-tabs" role="group" aria-label="选择平台">
              {platformOptions.map((option) => (
                <button
                  aria-pressed={platform === option.value}
                  className={platform === option.value ? "active" : ""}
                  key={option.value}
                  onClick={() => handlePlatformChange(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="empty-state-panel panel">
                <div className="panel-inner">
                  <span className="empty-state-mark">
                    <RefreshCw aria-hidden="true" size={17} />
                  </span>
                  <p className="subtle">正在读取本地毛利单价表。</p>
                </div>
              </div>
            ) : table ? (
              <>
                <div className="gross-price-groups">
                  {activePricePanelServiceConfigs.map((config) => (
                    <PriceGroup
                      config={config}
                      items={getServiceOptions(table, config.service)}
                      key={config.service}
                      priceInputs={priceInputs}
                      onPriceChange={(id, value) => setPriceInputs((current) => ({ ...current, [id]: value }))}
                    />
                  ))}
                </div>
                <button className="btn primary" disabled={busy === "prices"} onClick={() => void handleSavePriceTable()} type="button">
                  <Save aria-hidden="true" size={15} />
                  {busy === "prices" ? "保存中" : "保存单价表"}
                </button>
              </>
            ) : (
              <div className="empty-state-panel panel">
                <div className="panel-inner">
                  <span className="empty-state-mark">
                    <Calculator aria-hidden="true" size={17} />
                  </span>
                  <p className="subtle">单价表还没有初始化，请刷新后重试。</p>
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="pane gross-maintenance-pane">
          <div className="pane-header">
            <div>
              <h2>{formatPlatform(platform)}本次维护</h2>
              <p className="pane-subtitle">折前价格、折后价格和每项数量都填在这里</p>
            </div>
          </div>
          <div className="pane-body">
            <div className="detail-section gross-price-summary-form">
              <div className="gross-account-row">
                <div className="field">
                  <label htmlFor="gross-account-name">账号名</label>
                  <input
                    autoComplete="off"
                    id="gross-account-name"
                    list="gross-account-options"
                    type="text"
                    value={accountName}
                    onChange={(event) => handleAccountNameChange(event.target.value)}
                    placeholder="输入账号名自动带价格"
                  />
                  <datalist id="gross-account-options">
                    {platformAccounts.map((account) => (
                      <option key={`${account.platform}-${account.name}`} value={account.name} />
                    ))}
                  </datalist>
                  {matchedAccount ? (
                    <span className="field-hint">
                      已匹配{matchedAccount.priceLabel}：{formatMoney(matchedAccount.defaultPrice)}
                    </span>
                  ) : accountName.trim() ? (
                    <span className="field-hint warning">未匹配账号，价格可手填</span>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="gross-video-url">视频链接</label>
                  <input
                    autoComplete="off"
                    id="gross-video-url"
                    type="url"
                    value={videoUrl}
                    onBlur={() => handleVideoUrlChange(videoUrl)}
                    onChange={(event) => handleVideoUrlChange(event.target.value)}
                    onPaste={handleVideoUrlPaste}
                    placeholder="粘贴视频链接，导出时会带上"
                  />
                </div>
              </div>
              <div className="gross-price-summary-grid">
                <div className="field">
                  <label htmlFor="gross-original-price">折前价格</label>
                  <input
                    id="gross-original-price"
                    inputMode="decimal"
                    min={0}
                    type="number"
                    value={originalPrice}
                    onChange={(event) => updateOriginalPrice(event.target.value)}
                    placeholder="原档位价格"
                  />
                </div>
                <div className="field">
                  <label htmlFor="gross-discount-rate">折扣率</label>
                  <span className="gross-rate-input">
                    <input
                      id="gross-discount-rate"
                      inputMode="decimal"
                      min={0}
                      type="number"
                      value={discountRate}
                      onChange={(event) => handleDiscountRateChange(event.target.value)}
                      placeholder="可不填"
                    />
                    <small>%</small>
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="gross-discount-price">折后价格</label>
                  <input
                    id="gross-discount-price"
                    inputMode="decimal"
                    min={0}
                    type="number"
                    value={discountPrice}
                    onChange={(event) => setDiscountPrice(event.target.value)}
                    placeholder="实际报价"
                  />
                </div>
              </div>
            </div>

            <div className="gross-maintenance-table-wrap">
              <table className="gross-maintenance-table">
                <thead>
                  <tr>
                    <th>维护项</th>
                    <th>类型</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>小计</th>
                  </tr>
                </thead>
                <tbody>
                  {activeServiceConfigs.map((config) => {
                    const options = table ? getServiceOptions(table, config.service) : [];
                    const selectedOption = getSelectedOption(options, selectedOptions[config.service]);
                    const unitPrice = selectedOption ? toAmount(priceInputs[selectedOption.id] ?? selectedOption.unitPrice) : 0;
                    const quantity = toAmount(quantityInputs[config.service]);
                    const minimumWarning = getMinimumQuantityWarning(
                      selectedOption,
                      quantityInputs[config.service],
                      quantity
                    );
                    return (
                      <tr key={config.service}>
                        <td>
                          <strong>{config.label}</strong>
                          <span>{describeQuantityInput(selectedOption?.quantityUnit)}</span>
                        </td>
                        <td>
                          <select
                            aria-label={`${config.label}类型`}
                            value={selectedOption?.id || ""}
                            onChange={(event) =>
                              setSelectedOptions((current) => ({
                                ...current,
                                [config.service]: event.target.value
                              }))
                            }
                          >
                            {options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {formatTypeOptionName(option.name)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="gross-quantity-cell">
                            <span className={`gross-quantity-input${minimumWarning ? " gross-input-warning" : ""}`}>
                              <input
                                aria-label={`${config.label}数量`}
                                inputMode="decimal"
                                min={0}
                                type="number"
                                value={quantityInputs[config.service]}
                                onChange={(event) =>
                                  setQuantityInputs((current) => ({
                                    ...current,
                                    [config.service]: event.target.value
                                  }))
                                }
                              />
                              <small>{selectedOption?.quantityUnit || "个"}</small>
                            </span>
                            {minimumWarning ? <small className="gross-quantity-warning">{minimumWarning}</small> : null}
                          </div>
                        </td>
                        <td>{formatUnitPrice(unitPrice)}</td>
                        <td>{formatMoney(quantity * unitPrice)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="pane gross-result-pane">
          <div className="pane-header">
            <div>
              <h2>结果</h2>
              <p className="pane-subtitle">毛利率 = （折后价格 - 维护成本） / 折前价格</p>
            </div>
          </div>
          <div className="pane-body">
            <div className="gross-result-panel maintenance">
              <span>维护成本</span>
              <strong>{formatMoney(calculation.maintenanceCost)}</strong>
              <small>{calculation.lines.filter((line) => line.quantity > 0).length} 个项目已录入数量</small>
            </div>

            <div className={`gross-result-panel ${getGrossTone(calculation.grossMarginRate)}`}>
              <span>毛利率</span>
              <strong>{formatPercent(calculation.grossMarginRate)}</strong>
              <small>{formatMoney(calculation.grossProfit)} 毛利额</small>
            </div>

            <div className="gross-result-grid">
              <MetricItem label="折前价格" value={formatMoney(calculation.originalPrice)} />
              <MetricItem label="折后价格" value={formatMoney(calculation.discountPrice)} />
              <MetricItem label="折扣率" value={formatPercent(calculation.discountRate)} />
              <MetricItem label="维护成本占折前" value={formatPercent(calculation.originalPrice ? calculation.maintenanceCost / calculation.originalPrice : 0)} />
            </div>

            <label className={`gross-export-option${splitDeliveryEnabled ? " active" : ""}`}>
              <input
                checked={splitDeliveryEnabled}
                onChange={(event) => setSplitDeliveryEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>分两轮投放</strong>
                <small>第一轮 60%，第二轮 40%，导出时会追加首轮维护目标</small>
              </span>
            </label>

            <div className="button-row gross-export-row">
              <button aria-label="导入维护模板" className="btn" onClick={() => setImportModalOpen(true)} type="button">
                <Upload aria-hidden="true" size={15} />
                导入
              </button>
            </div>

            <div className="button-row gross-export-row">
              <button aria-label="导出审核文案" className="btn primary" onClick={() => void handleExportReview()} type="button">
                <Copy aria-hidden="true" size={15} />
                导出
              </button>
            </div>

            <div className="button-row gross-export-row secondary">
              <Link className="btn" href="/gross-margin/monitor">
                <Activity aria-hidden="true" size={15} />
                打开监控板
              </Link>
              <button className="btn" onClick={() => setDifferenceModalOpen(true)} type="button">
                <Search aria-hidden="true" size={15} />
                查询差额
              </button>
            </div>

          </div>
        </aside>
      </section>

      {importModalOpen ? (
        <GrossMarginImportModal
          initialPlatform={platform}
          onClose={() => setImportModalOpen(false)}
          onImport={handleImportTemplate}
        />
      ) : null}
      {differenceModalOpen ? <GrossMarginDifferenceModal platform={platform} onClose={() => setDifferenceModalOpen(false)} /> : null}
    </div>
  );
}

function PriceGroup({
  config,
  items,
  priceInputs,
  onPriceChange
}: {
  config: ServiceConfig;
  items: GrossMarginPriceOption[];
  priceInputs: Record<string, string>;
  onPriceChange: (id: string, value: string) => void;
}) {
  if (items.length === 1) {
    const item = items[0];
    return (
      <section className="gross-price-group gross-price-group-compact">
        <label className="gross-price-option gross-price-option-single" key={item.id}>
          <h3>{config.label}</h3>
          <span className="gross-price-input">
            <input
              inputMode="decimal"
              min={0}
              type="number"
              value={priceInputs[item.id] ?? String(item.unitPrice)}
              onChange={(event) => onPriceChange(item.id, event.target.value)}
              placeholder="0.00"
            />
            <small>{`元/${item.quantityUnit}`}</small>
          </span>
        </label>
      </section>
    );
  }

  return (
    <section className="gross-price-group">
      <div>
        <h3>{config.label}</h3>
      </div>
      <div className="gross-price-option-list">
        {items.map((item) => (
          <label className="gross-price-option" key={item.id}>
            <span>{item.name}</span>
            <span className="gross-price-input">
              <input
                inputMode="decimal"
                min={0}
                type="number"
                value={priceInputs[item.id] ?? String(item.unitPrice)}
                onChange={(event) => onPriceChange(item.id, event.target.value)}
                placeholder="0.00"
              />
              <small>{`元/${item.quantityUnit}`}</small>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="metric-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function calculateGrossMargin({
  configs,
  discountPrice,
  originalPrice,
  priceInputs,
  quantityInputs,
  selectedOptions,
  table
}: {
  configs: ServiceConfig[];
  discountPrice: number;
  originalPrice: number;
  priceInputs: Record<string, string>;
  quantityInputs: Record<GrossMarginServiceKind, string>;
  selectedOptions: Partial<Record<GrossMarginServiceKind, string>>;
  table: GrossMarginPriceTable | null;
}): GrossMarginCalculationResult {
  const lines: GrossMarginCalculationLine[] = configs.map((config) => {
    const options = table ? getServiceOptions(table, config.service) : [];
    const option = getSelectedOption(options, selectedOptions[config.service]);
    const unitPrice = option ? toAmount(priceInputs[option.id] ?? option.unitPrice) : 0;
    const quantity = toAmount(quantityInputs[config.service]);
    return {
      service: config.service,
      label: config.label,
      optionId: option?.id || "",
      optionName: option?.name || "",
      quantity,
      unitPrice,
      quantityUnit: option?.quantityUnit || "个",
      total: quantity * unitPrice
    };
  });
  const maintenanceCost = lines.reduce((sum, line) => sum + line.total, 0);
  const grossProfit = discountPrice - maintenanceCost;

  return {
    originalPrice,
    discountPrice,
    maintenanceCost,
    grossProfit,
    grossMarginRate: originalPrice > 0 ? grossProfit / originalPrice : 0,
    discountRate: originalPrice > 0 ? discountPrice / originalPrice : 0,
    lines
  };
}

function makePriceInputs(table: GrossMarginPriceTable) {
  return Object.fromEntries(table.items.map((item) => [item.id, String(item.unitPrice)]));
}

function makeEmptyQuantityInputs(): Record<GrossMarginServiceKind, string> {
  return {
    play: "",
    like: "",
    douPlus: "",
    coin: "",
    comment: "",
    share: "",
    favorite: "",
    danmaku: "",
    blueLink: ""
  };
}

function makeDefaultSelections(table: GrossMarginPriceTable) {
  return Object.fromEntries(
    serviceConfigs.map((config) => [config.service, getServiceOptions(table, config.service)[0]?.id || ""])
  ) as Partial<Record<GrossMarginServiceKind, string>>;
}

function getServiceOptions(table: GrossMarginPriceTable, service: GrossMarginServiceKind) {
  return table.items.filter((item) => item.service === service);
}

function getSelectedOption(options: GrossMarginPriceOption[], selectedId?: string) {
  return options.find((option) => option.id === selectedId) || options[0] || null;
}

function findImportedOption(options: GrossMarginPriceOption[], metric: GrossMarginImportedTemplate["metrics"][number]) {
  const hint = normalizeOptionHint(metric.optionHint);
  if (!hint) return options[0] || null;
  if (metric.service === "play" && /快速|高速|快/.test(hint)) {
    return options.find((option) => option.id.includes("play-fast") || /快速|高速|快/.test(option.name)) || options[0] || null;
  }
  if (metric.service === "play" && /正常|普通|默认/.test(hint)) {
    return options.find((option) => !option.id.includes("play-fast") && /正常|普通|默认/.test(option.name)) || options[0] || null;
  }
  return (
    options.find((option) => normalizeOptionHint(formatTypeOptionName(option.name)) === hint) ||
    options.find((option) => {
      const optionName = normalizeOptionHint(formatTypeOptionName(option.name));
      return optionName.includes(hint) || hint.includes(optionName);
    }) ||
    options[0] ||
    null
  );
}

function normalizeOptionHint(value: string) {
  return value
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function formatImportedQuantity(rawValue: string, quantityUnit: string) {
  const metricValue = parseMetricValue(rawValue);
  if (!metricValue) return "";
  let quantity = metricValue.value;
  if (quantityUnit === "万") {
    quantity = metricValue.unit === "万" ? metricValue.value : metricValue.value / 10000;
  } else if (quantityUnit === "千") {
    quantity = metricValue.unit === "万" ? metricValue.value * 10 : metricValue.value / 1000;
  }
  return formatAmountInput(quantity);
}

function parseMetricValue(rawValue: string) {
  const value = rawValue.trim().replace(/,/g, "");
  const match = value.match(/([\d.]+)/);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = /[wW万]/.test(value) ? "万" : "";
  return { value: number, unit };
}

function findGrossMarginAccount(accounts: GrossMarginAccountPrice[], rawName: string) {
  const name = normalizeAccountName(rawName);
  if (!name) return null;
  return (
    accounts.find((account) => normalizeAccountName(account.name) === name) ||
    accounts.find((account) => normalizeAccountName(account.name).includes(name) || name.includes(normalizeAccountName(account.name))) ||
    null
  );
}

function normalizeAccountName(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function formatTypeOptionName(name: string) {
  return name.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function getMinimumQuantityWarning(option: GrossMarginPriceOption | null, rawQuantity: string, quantity: number) {
  if (!option?.minimumQuantity) return "";
  if (!rawQuantity.trim()) return "";
  if (quantity >= option.minimumQuantity) return "";
  return `未达起量，至少 ${formatThreshold(option.minimumQuantity)}${option.quantityUnit}`;
}

function formatThreshold(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  });
}

function buildGrossMarginReview({
  account,
  accountName,
  calculation,
  platform,
  splitDeliveryEnabled,
  videoUrl
}: {
  account: GrossMarginAccountPrice | null;
  accountName: string;
  calculation: GrossMarginCalculationResult;
  platform: PlatformKey;
  splitDeliveryEnabled: boolean;
  videoUrl: string;
}) {
  const lines = new Map(calculation.lines.map((line) => [line.service, line]));
  const displayName = account?.name || accountName.trim();
  const displayVideoUrl = videoUrl.trim();
  const reviewFooter = "@罗娜 @姚琳琳(Lin.) @罗雪莲 @翁林湑(空白) @罗月琴 辛苦审核";
  const splitRoundLine = splitDeliveryEnabled ? buildSplitRoundLine(lines, platform) : "";

  if (platform === "bilibili") {
    const blueLinkLine = lines.get("blueLink");
    return [
      "【B站】",
      `账号：${displayName}`,
      `视频链接：${displayVideoUrl}`,
      `播放量（${formatBilibiliPlayChannel(lines.get("play"))}）：${formatReviewMetricValue(lines.get("play"), platform)}`,
      `点赞：${formatReviewMetricValue(lines.get("like"), platform)}`,
      `投币：${formatReviewMetricValue(lines.get("coin"), platform)}`,
      `收藏：${formatReviewMetricValue(lines.get("favorite"), platform)}`,
      `评论：${formatReviewMetricValue(lines.get("comment"), platform)}`,
      `分享：${formatReviewMetricValue(lines.get("share"), platform)}`,
      `弹幕：${formatReviewMetricValue(lines.get("danmaku"), platform)}`,
      ...(blueLinkLine && blueLinkLine.quantity > 0 ? [`蓝链点击：${formatReviewMetricValue(blueLinkLine, platform)}`] : []),
      `维护成本：${formatReviewMoney(calculation.maintenanceCost)}元，维护后毛利率${formatReviewPercent(calculation.grossMarginRate)}`,
      ...(splitRoundLine ? [splitRoundLine] : []),
      reviewFooter
    ].join("\n");
  }

  return [
    "【抖音】",
    `账号：${displayName}`,
    `抖音ID：${account?.douyinId || ""}`,
    `合作码：${account?.cooperationCode || ""}`,
    `视频链接：${displayVideoUrl}`,
    `播放量${formatReviewLabelSuffix(lines.get("play"))}：${formatReviewMetricValue(lines.get("play"), platform)}`,
    `点赞${formatReviewLabelSuffix(lines.get("like"))}：${formatReviewMetricValue(lines.get("like"), platform)}`,
    `评论${formatReviewLabelSuffix(lines.get("comment"))}：${formatReviewMetricValue(lines.get("comment"), platform)}`,
    `收藏：${formatReviewMetricValue(lines.get("favorite"), platform)}`,
    `转发：${formatReviewMetricValue(lines.get("share"), platform)}`,
    `抖加：${formatReviewMetricValue(lines.get("douPlus"), platform)}`,
    `维护成本预计：${formatReviewMoney(calculation.maintenanceCost)}元，维护后毛利率${formatReviewPercent(calculation.grossMarginRate)}`,
    ...(splitRoundLine ? [splitRoundLine] : []),
    reviewFooter
  ].join("\n");
}

function formatReviewLabelSuffix(line?: GrossMarginCalculationLine) {
  const name = formatTypeOptionName(line?.optionName || "");
  return name ? `（${name}）` : "";
}

function buildSplitRoundLine(
  lines: Map<GrossMarginServiceKind, GrossMarginCalculationLine>,
  platform: PlatformKey
) {
  const metrics: Array<{ service: GrossMarginServiceKind; label: string }> =
    platform === "bilibili"
      ? [
          { service: "play", label: "播放" },
          { service: "like", label: "点赞" },
          { service: "coin", label: "投币" },
          { service: "favorite", label: "收藏" },
          { service: "comment", label: "评论" },
          { service: "share", label: "分享" },
          { service: "danmaku", label: "弹幕" },
          { service: "blueLink", label: "蓝链点击" }
        ]
      : [
          { service: "play", label: "播放" },
          { service: "like", label: "点赞" },
          { service: "comment", label: "评论" },
          { service: "favorite", label: "收藏" },
          { service: "share", label: "转发" },
          { service: "douPlus", label: "抖加" }
        ];
  const summary = metrics
    .map(({ label, service }) => {
      const target = formatSplitRoundMetricValue(lines.get(service), 0.6);
      return target ? `${label}${target}` : "";
    })
    .filter(Boolean)
    .join("，");

  if (!summary) return "分两轮维护：第一轮";
  return `分两轮维护：第一轮，${summary}`;
}

function formatSplitRoundMetricValue(line: GrossMarginCalculationLine | undefined, ratio: number) {
  if (!line || line.quantity <= 0) return "";
  if (line.service === "douPlus") return `${formatReviewMoney(roundUpToStep(line.quantity * ratio, 1))}元`;
  const absoluteValue = toAbsoluteMetricValue(line);
  const roundedValue = roundUpToStep(absoluteValue * ratio, getSplitRoundStep(line.service));
  return formatSplitRoundCount(line.service, roundedValue);
}

function toAbsoluteMetricValue(line: GrossMarginCalculationLine) {
  if (line.quantityUnit === "万") return line.quantity * 10000;
  if (line.quantityUnit === "千") return line.quantity * 1000;
  return line.quantity;
}

function getSplitRoundStep(service: GrossMarginServiceKind) {
  if (service === "play") return 10000;
  if (service === "like") return 1000;
  if (service === "comment" || service === "favorite" || service === "share") return 10;
  return 1;
}

function roundUpToStep(value: number, step: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / step) * step;
}

function formatSplitRoundCount(service: GrossMarginServiceKind, value: number) {
  if (value <= 0) return "";
  if (service === "play") return `${formatReviewNumber(value / 10000)}万`;
  if (service === "like" && value >= 10000) {
    return `${formatReviewNumber(Number((value / 10000).toFixed(1)))}w`;
  }
  return formatReviewNumber(value);
}

function formatBilibiliPlayChannel(line?: GrossMarginCalculationLine) {
  if (!line?.optionId) return "正常通道";
  if (line.optionId.includes("play-fast")) return "快速通道";
  return "正常通道";
}

function formatReviewMetricValue(line: GrossMarginCalculationLine | undefined, platform: PlatformKey) {
  if (!line || line.quantity <= 0) return "/";
  if (line.service === "douPlus") return `${formatReviewMoney(line.quantity)}元`;
  if (line.quantityUnit === "万") {
    return `${formatThreshold(line.quantity)}${platform === "bilibili" ? "W" : "万"}`;
  }
  if (line.quantityUnit === "千") {
    return formatReviewNumber(line.quantity * 1000);
  }
  return formatReviewNumber(line.quantity);
}

function formatReviewNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function formatReviewMoney(value: number) {
  if (Math.abs(value - Math.round(value)) < 0.000001) {
    return String(Math.round(value));
  }
  return value.toFixed(2);
}

function formatReviewPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function toAmount(value: string | number | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmountInput(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 0.000001) return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

function formatMoney(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `¥${safeValue.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatUnitPrice(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `¥${safeValue.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPercent(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${(safeValue * 100).toFixed(2)}%`;
}

function formatPlatform(value: PlatformKey) {
  return value === "douyin" ? "抖音" : "B站";
}

function getGrossTone(value: number) {
  if (value < 0) return "negative";
  if (value < 0.15) return "warning";
  return "positive";
}

function describeQuantityInput(quantityUnit?: string) {
  if (quantityUnit === "万") return "数量直接填万，不用自己换算";
  if (quantityUnit === "千") return "数量直接填千，不用自己换算";
  return "数量直接填个数";
}
