"use client";

import { Play, Settings2 } from "lucide-react";
import type { getHealth } from "@/lib/client";
import type { CollectOrder, Platform } from "@/lib/types";
import { timeRangeOptions, type TimeRange } from "./home-utils";

export type HomeStats = {
  accountCount: number;
  videoCount: number;
  transcriptCount: number;
  copySourceCount: number;
  projectCount: number;
  draftCount: number;
};

type QuickStartPanelProps = {
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
  stats: HomeStats;
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

export function QuickStartPanel({
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
  stats,
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
}: QuickStartPanelProps) {
  return (
    <section className="panel quick-start">
      <div className="quick-start-main">
        <div className="quick-start-heading">
          <p className="eyebrow">Quick Start</p>
          <h2>快速开工</h2>
          <p className="subtle">输入账号名通过 opencli 搜索并采集爆款；抖音也可粘贴 sec_uid 或主页链接兜底。</p>
        </div>
        <div className="quick-form">
          <CollectControls
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
        <div className="quick-actions">
          <button className="btn primary" disabled={!canSubmit} onClick={onCollect} type="button">
            <Play aria-hidden="true" size={16} />
            {busy === "collect" ? "正在采集" : "开始采集"}
          </button>
          <button className="btn" disabled={busy === "health"} onClick={onHealthCheck} type="button">
            <Settings2 aria-hidden="true" size={16} />
            {busy === "health" ? "正在检查" : "检查环境"}
          </button>
        </div>
      </div>
      <HealthSummary health={health} stats={stats} />
    </section>
  );
}

function CollectControls({
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
  QuickStartPanelProps,
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
>) {
  return (
    <>
      <div className="field platform-field">
        <span id="collect-platform-label">平台</span>
        <div aria-labelledby="collect-platform-label" className="segmented platform-segmented" role="group">
          <button
            className={platform === "bilibili" ? "active" : ""}
            type="button"
            aria-pressed={platform === "bilibili"}
            onClick={() => onPlatformChange("bilibili")}
          >
            B站
          </button>
          <button
            className={platform === "douyin" ? "active" : ""}
            type="button"
            aria-pressed={platform === "douyin"}
            onClick={() => onPlatformChange("douyin")}
          >
            抖音
          </button>
        </div>
      </div>
      <div className="field account-name-field">
        <label htmlFor="collect-account-name">账号名</label>
        <input
          autoComplete="off"
          id="collect-account-name"
          name="accountName"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={platform === "douyin" ? "例如：老青椒…" : "例如：某某UP主…"}
        />
      </div>
      <div className="field">
        <label htmlFor="collect-limit">数量</label>
        <input
          autoComplete="off"
          id="collect-limit"
          inputMode="numeric"
          min={1}
          max={50}
          name="limit"
          type="number"
          value={limit}
          onChange={(event) => onLimitChange(Number(event.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor="collect-order">排序</label>
        <select id="collect-order" name="order" value={order} onChange={(event) => onOrderChange(event.target.value as CollectOrder)}>
          {activeOrderOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="collect-time-range">时间</label>
        <select id="collect-time-range" name="timeRange" value={timeRange} onChange={(event) => onTimeRangeChange(event.target.value as TimeRange)}>
          {timeRangeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
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
              type="date"
              value={customFromDate}
              onChange={(event) => onCustomFromDateChange(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="collect-to-date">结束日期</label>
            <input
              autoComplete="off"
              id="collect-to-date"
              name="toDate"
              type="date"
              value={customToDate}
              onChange={(event) => onCustomToDateChange(event.target.value)}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

function HealthSummary({ health, stats }: { health: QuickStartPanelProps["health"]; stats: HomeStats }) {
  const metricItems = [
    { value: stats.accountCount, label: "账号" },
    { value: stats.projectCount, label: "项目" },
    { value: stats.videoCount, label: "视频" },
    { value: stats.transcriptCount, label: "转写" },
    { value: stats.copySourceCount, label: "文案素材" },
    { value: stats.draftCount, label: "草稿" }
  ];

  return (
    <aside className="quick-status">
      <div className="quick-status-header">
        <h3>当前状态</h3>
        <span className={`status-pill ${health ? "done" : "pending"}`}>{health ? "已检查" : "未检查"}</span>
      </div>
      <div className="quick-metrics" aria-label="素材库状态">
        {metricItems.map((item) => (
          <span className="quick-metric" key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </span>
        ))}
      </div>
      {health ? (
        <div className="health-list">
          <span className={`status-pill ${health.opencli.ok ? "done" : "failed"}`}>
            opencli {health.opencli.ok ? `可用 ${health.opencli.version}` : "不可用"}
          </span>
          <span className={`status-pill ${health.volcengineAsrConfigured ? "done" : "pending"}`}>
            火山转写 {health.volcengineAsrConfigured ? "已配置" : "未配置"}
          </span>
          <span className={`status-pill ${health.chatConfigured ? "done" : "pending"}`}>
            对话模型 {health.chatConfigured ? `${health.chat.model} / ${health.chat.wireApi} / 已配置` : `${health.chat.model} / ${health.chat.wireApi} / 未配置`}
          </span>
          <span className={`status-pill ${health.chat.proxyConfigured ? "done" : "pending"}`}>
            模型代理 {health.chat.proxyConfigured ? "已配置" : "未配置"}
          </span>
          <span className={`status-pill ${health.feishu.doctor.ok ? "done" : "failed"}`}>
            飞书 lark-cli {health.feishu.doctor.ok ? "可用" : "需登录/配置"}
          </span>
        </div>
      ) : (
        <p className="subtle">运行环境检查会验证 opencli、火山转写、对话模型和飞书 lark-cli 是否可用。</p>
      )}
    </aside>
  );
}
