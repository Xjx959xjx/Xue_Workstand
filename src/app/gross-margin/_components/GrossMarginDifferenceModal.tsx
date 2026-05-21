"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { Copy, Search, X } from "lucide-react";
import { isBackdropEvent } from "@/components/dialog-events";
import { useFeedback } from "@/components/FeedbackProvider";
import { queryGrossMarginDifference } from "@/lib/client";
import { detectVideoPlatform, extractVideoUrl, getVideoComparableKey, normalizeVideoUrlInput } from "@/lib/video-links";
import type { GrossMarginDifferenceQueryResult, GrossMarginPriceTable, GrossMarginServiceKind } from "@/lib/types";

type PlatformKey = GrossMarginPriceTable["platform"];

const serviceLabels: Array<{ service: GrossMarginServiceKind; label: string; platforms: PlatformKey[] }> = [
  { service: "play", label: "播放量", platforms: ["bilibili"] },
  { service: "like", label: "点赞", platforms: ["bilibili", "douyin"] },
  { service: "coin", label: "投币", platforms: ["bilibili"] },
  { service: "favorite", label: "收藏", platforms: ["bilibili", "douyin"] },
  { service: "comment", label: "评论", platforms: ["bilibili", "douyin"] },
  { service: "share", label: "分享/转发", platforms: ["bilibili", "douyin"] },
  { service: "danmaku", label: "弹幕", platforms: ["bilibili"] },
  { service: "blueLink", label: "蓝链点击", platforms: ["bilibili"] }
];

export function GrossMarginDifferenceModal({
  platform,
  onClose
}: {
  platform: PlatformKey;
  onClose: () => void;
}) {
  const { notify } = useFeedback();
  const panelRef = useRef<HTMLDivElement>(null);
  const [template, setTemplate] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [manualStats, setManualStats] = useState<Partial<Record<GrossMarginServiceKind, string>>>({});
  const [detectedPlatform, setDetectedPlatform] = useState<PlatformKey>(platform);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GrossMarginDifferenceQueryResult | null>(null);
  const templateUrl = useMemo(() => extractTemplateUrl(template), [template]);
  const normalizedTemplateUrl = useMemo(() => normalizeVideoUrlInput(templateUrl), [templateUrl]);
  const normalizedVideoUrl = useMemo(() => normalizeVideoUrlInput(videoUrl), [videoUrl]);
  const effectiveUrl = normalizedTemplateUrl || normalizedVideoUrl;
  const linkMismatch = Boolean(
    normalizedTemplateUrl &&
      normalizedVideoUrl &&
      getVideoComparableKey(normalizedTemplateUrl) !== getVideoComparableKey(normalizedVideoUrl)
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  const activeServiceLabels = useMemo(
    () => serviceLabels.filter((item) => item.platforms.includes(detectedPlatform)),
    [detectedPlatform]
  );
  const canSubmit = Boolean(template.trim()) && Boolean(effectiveUrl) && !linkMismatch;

  function handleTemplateChange(value: string) {
    setTemplate(value);
    setResult(null);

    const extractedUrl = extractTemplateUrl(value);
    if (extractedUrl) {
      setVideoUrl(normalizeVideoUrlInput(extractedUrl));
    }

    const nextPlatform = detectPlatform(extractedUrl || videoUrl, value);
    if (nextPlatform) setDetectedPlatform(nextPlatform);
  }

  function handleVideoUrlChange(value: string) {
    const nextUrl = normalizeVideoUrlInput(value);
    setVideoUrl(nextUrl);
    setResult(null);
    const nextPlatform = detectPlatform(nextUrl, template);
    if (nextPlatform) setDetectedPlatform(nextPlatform);
  }

  function handleVideoUrlPaste(event: ClipboardEvent<HTMLInputElement>) {
    const extractedUrl = extractVideoUrl(event.clipboardData.getData("text"));
    if (!extractedUrl) return;
    event.preventDefault();
    handleVideoUrlChange(extractedUrl);
  }

  async function handleSubmit() {
    if (!template.trim()) {
      notify({ tone: "error", message: "请先粘贴维护模板" });
      return;
    }
    if (!effectiveUrl) {
      notify({ tone: "error", message: "没有从模板里识别到视频链接，请补充链接" });
      return;
    }
    if (linkMismatch) {
      notify({ tone: "error", message: "模板里的视频链接和下方视频链接不一致，请先确认要查询哪一条。" });
      return;
    }

    setBusy(true);
    try {
      const response = await queryGrossMarginDifference({
        template,
        platformHint: detectedPlatform,
        videoUrl: effectiveUrl,
        manualCurrentStats: Object.fromEntries(
          Object.entries(manualStats)
            .filter((entry): entry is [GrossMarginServiceKind, string] => Boolean(entry[1]?.trim()))
            .map(([service, value]) => [service, Number(value)])
        )
      });
      setResult(response);
      setDetectedPlatform(response.platform);
      await navigator.clipboard.writeText(response.result);
      notify({ tone: "success", message: "差额文案已生成并复制" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "查询差额失败" });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!result?.result) return;
    try {
      await navigator.clipboard.writeText(result.result);
      notify({ tone: "success", message: "差额文案已复制" });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "复制失败" });
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (isBackdropEvent(event) && !busy) onClose();
      }}
    >
      <div
        aria-labelledby="gross-difference-modal-title"
        aria-modal="true"
        className="modal-panel gross-difference-modal"
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="gross-difference-header">
          <div>
            <h2 id="gross-difference-modal-title">查询差额</h2>
            <p className="subtle">粘贴维护模板后自动识别链接，抓当前数据并生成差额文案。</p>
          </div>
          <button aria-label="关闭差额弹窗" className="btn icon-btn icon-only" disabled={busy} onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="gross-difference-status">
          <span>{detectedPlatform === "bilibili" ? "B站" : "抖音"}</span>
          <strong>{effectiveUrl ? "已识别链接" : "等待模板"}</strong>
          {detectedPlatform === "douyin" ? <small>不抓播放量</small> : null}
          {linkMismatch ? <small className="warning">模板链接和输入框链接不一致</small> : null}
          {busy ? <em>抓取中...</em> : null}
        </div>

        <div className="gross-difference-layout">
          <section className="gross-difference-inputs">
            <label className="field">
              <span>维护模板</span>
              <textarea
                rows={8}
                value={template}
                onChange={(event) => handleTemplateChange(event.target.value)}
                placeholder="粘贴之前导出的维护模板"
              />
            </label>

            <label className="field gross-difference-url-field">
              <span>视频链接</span>
              <input
                type="url"
                value={videoUrl}
                onBlur={() => handleVideoUrlChange(videoUrl)}
                onChange={(event) => handleVideoUrlChange(event.target.value)}
                onPaste={handleVideoUrlPaste}
                placeholder="会从模板自动提取，也可以手动补充"
              />
              {linkMismatch ? (
                <small className="field-hint warning">模板里是 {normalizedTemplateUrl}，请清空或改成同一个视频链接后再查。</small>
              ) : null}
            </label>

            <details className="gross-difference-manual">
              <summary>手动补充当前数据</summary>
              <div className="gross-difference-manual-grid">
                {activeServiceLabels.map((item) => (
                  <label className="field" key={item.service}>
                    <span>{item.label}</span>
                    <input
                      inputMode="numeric"
                      min={0}
                      type="number"
                      value={manualStats[item.service] || ""}
                      onChange={(event) =>
                        setManualStats((current) => ({
                          ...current,
                          [item.service]: event.target.value
                        }))
                      }
                      placeholder={item.service === "blueLink" ? "建议手填" : "可选"}
                    />
                  </label>
                ))}
              </div>
            </details>
          </section>

          <section className="gross-difference-result">
            <div className="gross-difference-result-header">
              <div>
                <h3>差额文案</h3>
                {result?.title ? <p className="subtle">{result.title}</p> : <p className="subtle">查询后会自动复制到剪贴板。</p>}
              </div>
              <button className="btn" disabled={!result} onClick={() => void handleCopy()} type="button">
                <Copy aria-hidden="true" size={15} />
                复制
              </button>
            </div>
            <textarea
              readOnly
              rows={12}
              value={result?.result || "@罗月琴 目前差额：\n\n播放量：\n点赞："}
            />
            {result?.warnings.length ? (
              <div className="gross-difference-warnings">
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="button-row gross-difference-actions">
          <button className="btn" disabled={busy} onClick={onClose} type="button">
            关闭
          </button>
          <button className="btn primary" disabled={busy || !canSubmit} onClick={() => void handleSubmit()} type="button">
            <Search aria-hidden="true" size={15} />
            {busy ? "查询中" : "查询差额"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function detectPlatform(url: string, template: string): PlatformKey | null {
  const platform = detectVideoPlatform(url);
  if (platform) return platform;
  if (template.includes("【B站】") || /投币|弹幕|蓝链点击/.test(template)) return "bilibili";
  if (template.includes("【抖音】") || /合作码|抖音ID|抖加|转发/.test(template)) return "douyin";
  return null;
}

function extractTemplateUrl(template: string) {
  return extractVideoUrl(template);
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
