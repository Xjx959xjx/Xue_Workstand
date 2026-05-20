"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ClipboardPaste, X } from "lucide-react";
import { isBackdropEvent } from "@/components/dialog-events";
import { useFeedback } from "@/components/FeedbackProvider";
import type { GrossMarginPriceTable, GrossMarginServiceKind } from "@/lib/types";

type PlatformKey = GrossMarginPriceTable["platform"];

export type GrossMarginImportedMetric = {
  service: GrossMarginServiceKind;
  label: string;
  optionHint: string;
  rawValue: string;
};

export type GrossMarginImportedTemplate = {
  platform: PlatformKey;
  accountName: string;
  videoUrl: string;
  metrics: GrossMarginImportedMetric[];
};

const metricPatterns: Array<{
  service: GrossMarginServiceKind;
  label: string;
  pattern: RegExp;
}> = [
  { service: "play", label: "播放量", pattern: /^播放量(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "like", label: "点赞", pattern: /^点赞(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "coin", label: "投币", pattern: /^投币(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "favorite", label: "收藏", pattern: /^收藏(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "comment", label: "评论", pattern: /^评论(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "share", label: "分享", pattern: /^分享(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "share", label: "转发", pattern: /^转发(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "danmaku", label: "弹幕", pattern: /^弹幕(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "blueLink", label: "蓝链点击", pattern: /^蓝链点击(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "douPlus", label: "抖加", pattern: /^抖加(?:（([^）]+)）)?\s*[：:]\s*(.+)$/ },
  { service: "douPlus", label: "dou+", pattern: /^dou\+(?:（([^）]+)）)?\s*[：:]\s*(.+)$/i }
];

export function GrossMarginImportModal({
  initialPlatform,
  onClose,
  onImport
}: {
  initialPlatform: PlatformKey;
  onClose: () => void;
  onImport: (template: GrossMarginImportedTemplate) => void;
}) {
  const { notify } = useFeedback();
  const panelRef = useRef<HTMLDivElement>(null);
  const [template, setTemplate] = useState("");

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  const parsed = useMemo(() => parseImportTemplate(template, initialPlatform), [initialPlatform, template]);
  const canImport = Boolean(template.trim()) && Boolean(parsed.accountName || parsed.metrics.length || parsed.videoUrl);

  function handleImport() {
    if (!template.trim()) {
      notify({ tone: "error", message: "请先粘贴填好的维护模板" });
      return;
    }
    if (!canImport) {
      notify({ tone: "error", message: "没有识别到账号、链接或维护项，请检查模板内容" });
      return;
    }
    onImport(parsed);
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (isBackdropEvent(event)) onClose();
      }}
    >
      <div
        aria-labelledby="gross-import-modal-title"
        aria-modal="true"
        className="modal-panel gross-import-modal"
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="gross-import-header">
          <div>
            <h2 id="gross-import-modal-title">导入维护模板</h2>
            <p className="subtle">粘贴发出去前的模板，自动反填账号、链接和本次维护数量。</p>
          </div>
          <button aria-label="关闭导入弹窗" className="btn icon-btn icon-only" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="gross-import-layout">
          <label className="field gross-import-input">
            <span>模板内容</span>
            <textarea
              autoFocus
              rows={13}
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              placeholder="把填好的维护模板粘贴到这里"
            />
          </label>

          <aside className="gross-import-preview" aria-label="导入预览">
            <div className="gross-import-preview-head">
              <strong>{parsed.platform === "bilibili" ? "B站" : "抖音"}</strong>
              <span>{parsed.metrics.length} 项</span>
            </div>
            <dl>
              <div>
                <dt>账号</dt>
                <dd>{parsed.accountName || "未识别"}</dd>
              </div>
              <div>
                <dt>链接</dt>
                <dd>{parsed.videoUrl ? "已识别" : "未识别"}</dd>
              </div>
            </dl>
            <div className="gross-import-metrics">
              {parsed.metrics.length ? (
                parsed.metrics.map((metric) => (
                  <span key={`${metric.service}-${metric.label}-${metric.optionHint}`}>
                    {metric.label}
                    {metric.optionHint ? `（${metric.optionHint}）` : ""}：{metric.rawValue}
                  </span>
                ))
              ) : (
                <p>粘贴后会显示识别到的维护项。</p>
              )}
            </div>
          </aside>
        </div>

        <footer className="button-row gross-import-actions">
          <button className="btn" onClick={onClose} type="button">
            取消
          </button>
          <button className="btn primary" disabled={!canImport} onClick={handleImport} type="button">
            {canImport ? <Check aria-hidden="true" size={15} /> : <ClipboardPaste aria-hidden="true" size={15} />}
            导入到本次维护
          </button>
        </footer>
      </div>
    </div>
  );
}

function parseImportTemplate(template: string, fallbackPlatform: PlatformKey): GrossMarginImportedTemplate {
  const lines = template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const accountName = extractLineValue(lines, "账号");
  const videoUrl = extractTemplateUrl(template) || extractLineValue(lines, "视频链接");
  const platform = detectPlatform(template, videoUrl, fallbackPlatform);
  const metrics: GrossMarginImportedMetric[] = [];

  for (const line of lines) {
    for (const metricPattern of metricPatterns) {
      const match = line.match(metricPattern.pattern);
      if (!match) continue;
      const rawValue = cleanMetricValue(match[2] || "");
      if (!rawValue || rawValue === "/") break;
      metrics.push({
        service: metricPattern.service,
        label: metricPattern.label,
        optionHint: (match[1] || "").trim(),
        rawValue
      });
      break;
    }
  }

  return {
    platform,
    accountName,
    videoUrl,
    metrics
  };
}

function extractLineValue(lines: string[], label: string) {
  const pattern = new RegExp(`^${label}\\s*[：:]\\s*(.+)$`);
  return lines.find((line) => pattern.test(line))?.replace(pattern, "$1").trim() || "";
}

function extractTemplateUrl(template: string) {
  return (template.match(/https?:\/\/[^\s，。；;）)]+/i)?.[0] || "").replace(/[，。；;,.)）]+$/g, "");
}

function detectPlatform(template: string, url: string, fallbackPlatform: PlatformKey): PlatformKey {
  if (/BV[0-9A-Za-z]+|bilibili\.com/i.test(url) || template.includes("【B站】") || /投币|弹幕|蓝链点击/.test(template)) {
    return "bilibili";
  }
  if (/douyin\.com\/video\/\d+|aweme/i.test(url) || template.includes("【抖音】") || /合作码|抖音ID|抖加|转发/.test(template)) {
    return "douyin";
  }
  return fallbackPlatform;
}

function cleanMetricValue(value: string) {
  return value.replace(/[，。；;,]?\s*$/g, "").trim();
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );

  if (!focusable.length) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (document.activeElement === event.currentTarget) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
