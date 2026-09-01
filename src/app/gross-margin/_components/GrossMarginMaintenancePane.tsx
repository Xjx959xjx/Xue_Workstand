import {
  getActiveServiceOptions,
  getMinimumQuantityWarning,
  getSelectedOption,
  toAmount
} from "@/lib/gross-margin-calculator";
import type { GrossMarginWorkbenchController } from "../_hooks/useGrossMarginWorkbench";
import {
  describeQuantityInput,
  formatMoney,
  formatPlatform,
  formatTypeOptionName,
  getGrossMarginAccountPrice,
  formatUnitPrice
} from "../_lib/gross-margin-workbench-model";

type GrossMarginMaintenancePaneProps = Pick<
  GrossMarginWorkbenchController,
  | "accountName"
  | "accountPriceKind"
  | "activeServiceConfigs"
  | "discountPrice"
  | "handleAccountNameChange"
  | "handleAccountPriceKindChange"
  | "handleRebateRateChange"
  | "handleVideoUrlChange"
  | "matchedAccount"
  | "originalPrice"
  | "platform"
  | "platformAccounts"
  | "priceInputs"
  | "quantityInputs"
  | "rebateRate"
  | "selectedOptions"
  | "setDiscountPrice"
  | "setQuantityInput"
  | "setSelectedOption"
  | "table"
  | "updateOriginalPrice"
  | "videoUrl"
  | "videoAccountLookup"
>;

export function GrossMarginMaintenancePane({
  accountName,
  accountPriceKind,
  activeServiceConfigs,
  discountPrice,
  handleAccountNameChange,
  handleAccountPriceKindChange,
  handleRebateRateChange,
  handleVideoUrlChange,
  matchedAccount,
  originalPrice,
  platform,
  platformAccounts,
  priceInputs,
  quantityInputs,
  rebateRate,
  selectedOptions,
  setDiscountPrice,
  setQuantityInput,
  setSelectedOption,
  table,
  updateOriginalPrice,
  videoUrl,
  videoAccountLookup
}: GrossMarginMaintenancePaneProps) {
  const selectedAccountPrice = matchedAccount
    ? getGrossMarginAccountPrice(matchedAccount, accountPriceKind)
    : null;
  const accountPriceOptions = [
    { kind: "custom" as const, label: "定制" },
    { kind: "implant" as const, label: "植入" }
  ];

  return (
    <section className="pane gross-maintenance-pane">
      <div className="pane-header">
        <div>
          <h2>{formatPlatform(platform)}本次维护</h2>
          <p className="pane-subtitle">价格与数量</p>
        </div>
      </div>
      <div className="pane-body">
        <div className="detail-section gross-price-summary-form">
          <div className="gross-account-row">
            <div className="field">
              <label htmlFor="gross-account-name">账号名</label>
              <input
                aria-busy={videoAccountLookup.status === "loading"}
                autoComplete="off"
                id="gross-account-name"
                list="gross-account-options"
                name="accountName"
                type="text"
                value={accountName}
                onChange={(event) => handleAccountNameChange(event.target.value)}
                placeholder="输入账号名自动带价格…"
              />
              <datalist id="gross-account-options">
                {platformAccounts.map((account) => (
                  <option key={`${account.platform}-${account.name}`} value={account.name} />
                ))}
              </datalist>
              {matchedAccount ? (
                <span className="field-hint">
                  已匹配{selectedAccountPrice?.label}：{formatMoney(selectedAccountPrice?.value || 0)}
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
                name="videoUrl"
                type="url"
                value={videoUrl}
                onBlur={() => handleVideoUrlChange(videoUrl)}
                onChange={(event) => handleVideoUrlChange(event.target.value)}
                placeholder="粘贴视频链接，导出时会带上…"
              />
              {videoAccountLookup.message ? (
                <span
                  aria-live="polite"
                  className={`field-hint${videoAccountLookup.status === "error" || videoAccountLookup.status === "unmatched" ? " warning" : ""}`}
                >
                  {videoAccountLookup.message}
                </span>
              ) : null}
            </div>
          </div>
          <div className="gross-price-summary-grid">
            <div className="field">
              <label htmlFor="gross-original-price">折前价格</label>
              <div className="gross-original-price-control">
                <span aria-label="折前价格类型" className="gross-account-price-kinds" role="group">
                  {accountPriceOptions.map((option) => (
                    <button
                      aria-pressed={accountPriceKind === option.kind}
                      className={accountPriceKind === option.kind ? "active" : ""}
                      disabled={option.kind === "implant" && matchedAccount?.secondaryPrice === undefined}
                      key={option.kind}
                      onClick={() => handleAccountPriceKindChange(option.kind)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </span>
                <input
                  autoComplete="off"
                  id="gross-original-price"
                  inputMode="decimal"
                  min={0}
                  name="originalPrice"
                  type="number"
                  value={originalPrice}
                  onChange={(event) => updateOriginalPrice(event.target.value)}
                  placeholder="原档位价格…"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="gross-rebate-rate">返点</label>
              <span className="gross-rate-input">
                <input
                  autoComplete="off"
                  id="gross-rebate-rate"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  name="rebateRate"
                  type="number"
                  value={rebateRate}
                  onChange={(event) => handleRebateRateChange(event.target.value)}
                  placeholder="可不填…"
                />
                <small>%</small>
              </span>
            </div>
            <div className="field">
              <label htmlFor="gross-discount-price">折后价格</label>
              <input
                autoComplete="off"
                id="gross-discount-price"
                inputMode="decimal"
                min={0}
                name="discountPrice"
                type="number"
                value={discountPrice}
                onChange={(event) => setDiscountPrice(event.target.value)}
                placeholder="实际报价…"
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
                const options = table ? getActiveServiceOptions(table, config.service) : [];
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
                        name={`${config.service}Option`}
                        value={selectedOption?.id || ""}
                        onChange={(event) => setSelectedOption(config.service, event.target.value)}
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
                            autoComplete="off"
                            inputMode="decimal"
                            min={0}
                            name={`${config.service}Quantity`}
                            type="number"
                            value={quantityInputs[config.service]}
                            onChange={(event) => setQuantityInput(config.service, event.target.value)}
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
  );
}
