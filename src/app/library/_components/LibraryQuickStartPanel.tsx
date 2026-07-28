"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Play, RefreshCw, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import type { getHealth } from "@/lib/client";
import type { CollectOrder, Platform } from "@/lib/types";
import { LibraryEditorModal } from "./LibraryEditorModal";
import { timeRangeOptions, type TimeRange } from "./library-collect-utils";

type LibraryQuickStartPanelProps = {
  activeOrderOptions: Array<{ value: CollectOrder; label: string }>;
  busy: string;
  canSubmit: boolean;
  customFromDate: string;
  customToDate: string;
  health: Awaited<ReturnType<typeof getHealth>> | null;
  limit: number;
  name: string;
  order: CollectOrder;
  platform: Platform;
  timeRange: TimeRange;
  onCollect: () => void;
  onCustomFromDateChange: (value: string) => void;
  onCustomToDateChange: (value: string) => void;
  onHealthCheck: () => void;
  onLimitChange: (value: number) => void;
  onNameChange: (value: string) => void;
  onOrderChange: (value: CollectOrder) => void;
  onPlatformChange: (value: Platform) => void;
  onTimeRangeChange: (value: TimeRange) => void;
};

export function LibraryQuickStartPanel({
  activeOrderOptions,
  busy,
  canSubmit,
  customFromDate,
  customToDate,
  health,
  limit,
  name,
  order,
  platform,
  timeRange,
  onCollect,
  onCustomFromDateChange,
  onCustomToDateChange,
  onHealthCheck,
  onLimitChange,
  onNameChange,
  onOrderChange,
  onPlatformChange,
  onTimeRangeChange
}: LibraryQuickStartPanelProps) {
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const environmentPanelRef = useRef<HTMLDivElement>(null);
  const checkedThisOpenRef = useRef(false);

  useEffect(() => {
    if (!environmentOpen || checkedThisOpenRef.current) return;
    checkedThisOpenRef.current = true;
    onHealthCheck();
  }, [environmentOpen, onHealthCheck]);

  function openEnvironmentModal() {
    checkedThisOpenRef.current = false;
    setEnvironmentOpen(true);
  }

  return (
    <>
      <section className={`panel library-quick-start workbench-leading-panel ${advancedOpen ? "advanced-open" : ""}`} aria-label="账号采集">
        <form
          className="library-quick-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onCollect();
          }}
        >
          <div className="library-quick-fields">
            <CollectControls
              advancedOpen={advancedOpen}
              activeOrderOptions={activeOrderOptions}
              customFromDate={customFromDate}
              customToDate={customToDate}
              limit={limit}
              name={name}
              order={order}
              platform={platform}
              timeRange={timeRange}
              onCustomFromDateChange={onCustomFromDateChange}
              onCustomToDateChange={onCustomToDateChange}
              onLimitChange={onLimitChange}
              onNameChange={onNameChange}
              onOrderChange={onOrderChange}
              onPlatformChange={onPlatformChange}
              onTimeRangeChange={onTimeRangeChange}
            />
          </div>
          <div className="library-quick-actions">
            <button className="btn primary library-collect-submit" aria-busy={busy === "collect"} disabled={!canSubmit} type="submit">
              <Play aria-hidden="true" size={16} />
              {busy === "collect" ? "正在采集" : "开始采集"}
            </button>
            <button
              aria-controls="library-collect-advanced"
              aria-expanded={advancedOpen}
              className="btn ghost compact library-advanced-trigger"
              onClick={() => setAdvancedOpen((current) => !current)}
              type="button"
            >
              <SlidersHorizontal aria-hidden="true" size={15} />
              {advancedOpen ? "收起设置" : `${limit} 条 · ${activeOrderOptions.find((option) => option.value === order)?.label || "默认排序"}`}
            </button>
            <button
              aria-label="检查运行环境"
              className="btn ghost icon-btn icon-only library-environment-trigger"
              disabled={busy === "collect"}
              onClick={openEnvironmentModal}
              title="检查运行环境"
              type="button"
            >
              <Settings2 aria-hidden="true" size={16} />
            </button>
          </div>
        </form>
      </section>
      {environmentOpen ? (
        <EnvironmentModal
          busy={busy}
          health={health}
          panelRef={environmentPanelRef}
          onClose={() => setEnvironmentOpen(false)}
          onHealthCheck={onHealthCheck}
        />
      ) : null}
    </>
  );
}

function CollectControls({
  advancedOpen,
  activeOrderOptions,
  customFromDate,
  customToDate,
  limit,
  name,
  order,
  platform,
  timeRange,
  onCustomFromDateChange,
  onCustomToDateChange,
  onLimitChange,
  onNameChange,
  onOrderChange,
  onPlatformChange,
  onTimeRangeChange
}: Pick<
  LibraryQuickStartPanelProps,
  | "activeOrderOptions"
  | "customFromDate"
  | "customToDate"
  | "limit"
  | "name"
  | "order"
  | "platform"
  | "timeRange"
  | "onCustomFromDateChange"
  | "onCustomToDateChange"
  | "onLimitChange"
  | "onNameChange"
  | "onOrderChange"
  | "onPlatformChange"
  | "onTimeRangeChange"
> & { advancedOpen: boolean }) {
  return (
    <>
      <div className="field library-platform-field">
        <span id="collect-platform-label">平台</span>
        <div aria-labelledby="collect-platform-label" className="segmented library-platform-segmented" role="group">
          <button
            aria-pressed={platform === "bilibili"}
            className={platform === "bilibili" ? "active" : ""}
            onClick={() => onPlatformChange("bilibili")}
            type="button"
          >
            B站
          </button>
          <button
            aria-pressed={platform === "douyin"}
            className={platform === "douyin" ? "active" : ""}
            onClick={() => onPlatformChange("douyin")}
            type="button"
          >
            抖音
          </button>
        </div>
      </div>
      <div className="field library-account-name-field">
        <label htmlFor="collect-account-name">账号名 / 主页链接</label>
        <div className="input-with-icon">
          <Search aria-hidden="true" size={16} />
          <input
            autoComplete="off"
            id="collect-account-name"
            name="accountName"
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={platform === "douyin" ? "例如：老青椒、主页链接或 sec_uid…" : "例如：某某UP主、空间链接或 UID…"}
            value={name}
          />
        </div>
      </div>
      {advancedOpen ? (
        <div className="library-quick-advanced" id="library-collect-advanced">
          <div className="field">
            <label htmlFor="collect-limit">数量</label>
            <input autoComplete="off" id="collect-limit" inputMode="numeric" max={50} min={1} name="limit" onChange={(event) => updateBoundedNumber(event.target.value, 1, 50, onLimitChange)} type="number" value={limit} />
          </div>
          <div className="field">
            <label htmlFor="collect-order">采集排序</label>
            <select id="collect-order" name="order" onChange={(event) => onOrderChange(event.target.value as CollectOrder)} value={order}>
              {activeOrderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="collect-time-range">采集时间</label>
            <select id="collect-time-range" name="timeRange" onChange={(event) => onTimeRangeChange(event.target.value as TimeRange)} value={timeRange}>
              {timeRangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {timeRange === "custom" ? (
            <>
              <div className="field">
                <label htmlFor="collect-from-date">开始日期</label>
                <input
                  autoComplete="off"
                  id="collect-from-date"
                  name="fromDate"
                  onChange={(event) => onCustomFromDateChange(event.target.value)}
                  type="date"
                  value={customFromDate}
                />
              </div>
              <div className="field">
                <label htmlFor="collect-to-date">结束日期</label>
                <input
                  autoComplete="off"
                  id="collect-to-date"
                  name="toDate"
                  onChange={(event) => onCustomToDateChange(event.target.value)}
                  type="date"
                  value={customToDate}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function updateBoundedNumber(value: string, min: number, max: number, onChange: (value: number) => void) {
  if (!value.trim()) return;
  const next = Number(value);
  if (!Number.isFinite(next)) return;
  onChange(Math.min(Math.max(Math.trunc(next), min), max));
}

function EnvironmentModal({
  busy,
  health,
  panelRef,
  onClose,
  onHealthCheck
}: {
  busy: string;
  health: LibraryQuickStartPanelProps["health"];
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onHealthCheck: () => void;
}) {
  const healthItems = health?.appMode === "gross-margin"
    ? [
        {
          label: "opencli",
          detail: health.opencli.ok ? `可用 ${health.opencli.version}` : health.opencli.error || "不可用",
          ok: health.opencli.ok
        },
        {
          label: "毛利数据目录",
          detail: health.storage.ok ? health.storage.root : health.storage.error || "不可写",
          ok: health.storage.ok
        }
      ]
    : health
    ? [
        {
          label: "opencli",
          detail: health.opencli.ok ? `可用 ${health.opencli.version}` : "不可用",
          ok: health.opencli.ok
        },
        {
          label: "火山转写",
          detail: health.volcengineAsrConfigured ? "已配置" : "未配置",
          ok: health.volcengineAsrConfigured
        },
        {
          label: "对话模型",
          detail: health.chatReachable
            ? `${health.chatProbe.source === "fallback" ? "备用" : "主"} ${health.chatProbe.model} / ${health.chatProbe.attemptedWireApi || health.chatProbe.wireApi}${health.chat.serviceTier ? ` / ${health.chat.serviceTier}` : ""}${health.chatProbe.latencyMs ? ` / ${health.chatProbe.latencyMs}ms` : ""}`
            : health.chatConfigured
            ? `${health.chat.model} / ${health.chat.wireApi}${health.chat.serviceTier ? ` / ${health.chat.serviceTier}` : ""} / ${health.chatProbe.message || "探针失败"}`
            : `${health.chat.model} / ${health.chat.wireApi} / 未配置`,
          ok: health.chatReachable
        },
        {
          label: "模型代理",
          detail: health.chat.proxyConfigured ? "已配置" : "未配置",
          ok: health.chat.proxyConfigured
        },
        {
          label: "飞书 lark-cli",
          detail: health.feishu.doctor.ok ? "可用" : "需登录/配置",
          ok: health.feishu.doctor.ok
        }
      ]
    : [];

  return (
    <LibraryEditorModal labelledBy="library-environment-modal-title" panelClassName="environment-modal" panelRef={panelRef} onClose={onClose}>
      <div className="modal-header">
        <div>
          <h2 id="library-environment-modal-title">运行环境</h2>
          <p className="subtle">验证采集、转写、模型和飞书发布依赖。</p>
        </div>
        <div className="button-row">
          <button className="btn" disabled={busy === "health"} onClick={onHealthCheck} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            {busy === "health" ? "检查中" : "重新检查"}
          </button>
          <button className="btn icon-btn icon-only" aria-label="关闭环境检查" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      </div>
      <div className="environment-modal-body">
        <div className="environment-check-list">
          {healthItems.length ? (
            healthItems.map((item) => (
              <span className="environment-check-row" key={item.label}>
                {item.ok ? <CheckCircle2 aria-hidden="true" size={16} /> : <CircleAlert aria-hidden="true" size={16} />}
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className={`status-pill ${item.ok ? "done" : "pending"}`}>{item.ok ? "可用" : "待处理"}</span>
              </span>
            ))
          ) : (
            <p className="subtle">{busy === "health" ? "正在检查运行环境…" : "打开后会自动检查运行环境。"}</p>
          )}
        </div>
      </div>
    </LibraryEditorModal>
  );
}
