"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getActiveServiceOptions,
  getMinimumQuantityWarning,
  getSelectedOption,
  toAmount
} from "@/lib/gross-margin-calculator";
import type { GrossMarginAccountPrice } from "@/lib/types";
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

type GrossMarginAccountComboboxProps = {
  accounts: GrossMarginAccountPrice[];
  busy: boolean;
  onChange: (value: string) => void;
  value: string;
};

function normalizeAccountQuery(value: string) {
  return value.trim().replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

function GrossMarginAccountCombobox({ accounts, busy, onChange, value }: GrossMarginAccountComboboxProps) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const query = normalizeAccountQuery(value);
  const visibleAccounts = useMemo(() => {
    if (showAll || !query) return accounts;
    return accounts.filter((account) => normalizeAccountQuery(account.name).includes(query));
  }, [accounts, query, showAll]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (activeIndex < visibleAccounts.length) return;
    setActiveIndex(Math.max(visibleAccounts.length - 1, 0));
  }, [activeIndex, visibleAccounts.length]);

  useEffect(() => {
    if (!open || !visibleAccounts.length) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId, open, visibleAccounts.length]);

  function openAccountList() {
    setShowAll(true);
    setActiveIndex(Math.max(accounts.findIndex((account) => account.name === value), 0));
    setOpen(true);
  }

  function selectAccount(account: GrossMarginAccountPrice) {
    onChange(account.name);
    setOpen(false);
    setShowAll(true);
    inputRef.current?.focus();
  }

  return (
    <div className="gross-account-combobox" ref={rootRef}>
      <div className="gross-account-input-row">
        <input
          aria-activedescendant={open && visibleAccounts[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-busy={busy}
          aria-controls={listboxId}
          aria-expanded={open}
          autoComplete="off"
          id="gross-account-name"
          name="accountName"
          placeholder="输入账号名自动带价格…"
          ref={inputRef}
          role="combobox"
          type="text"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setShowAll(false);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={openAccountList}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) {
                openAccountList();
                return;
              }
              if (!visibleAccounts.length) return;
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex((current) => (current + direction + visibleAccounts.length) % visibleAccounts.length);
              return;
            }
            if (event.key === "Enter" && open && visibleAccounts[activeIndex]) {
              event.preventDefault();
              selectAccount(visibleAccounts[activeIndex]);
              return;
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        <button
          aria-label={open ? "收起账号列表" : "展开账号列表"}
          aria-controls={listboxId}
          aria-expanded={open}
          className="gross-account-toggle"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            openAccountList();
            inputRef.current?.focus();
          }}
        >
          <ChevronDown aria-hidden="true" size={16} />
        </button>
      </div>
      {open && visibleAccounts.length ? (
        <div aria-label="账号列表" className="gross-account-options" id={listboxId} role="listbox">
          {visibleAccounts.map((account, index) => {
            const selected = account.name === value;
            return (
              <button
                aria-selected={selected}
                className={`gross-account-option${index === activeIndex ? " active" : ""}`}
                id={`${listboxId}-option-${index}`}
                key={`${account.platform}-${account.name}`}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectAccount(account)}
              >
                <span>{account.name}</span>
                {selected ? <Check aria-hidden="true" size={15} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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
              <GrossMarginAccountCombobox
                accounts={platformAccounts}
                busy={videoAccountLookup.status === "loading"}
                onChange={handleAccountNameChange}
                value={accountName}
              />
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
