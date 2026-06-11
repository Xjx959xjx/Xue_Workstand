"use client";

import { useMemo, useState } from "react";
import {
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  Hash,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Music,
  Search,
  Sparkles,
  Video,
  Wrench
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useFeedback } from "@/components/FeedbackProvider";
import {
  downloadSingleVideoAsset,
  generatePublishCopy,
  transcribeSingleVideoLink,
  type SingleVideoAssetKind,
  type SingleVideoTranscribeResult
} from "@/lib/client";
import type { PublishCopyCandidate, PublishCopyResult, PublishCopyTargetPlatform } from "@/lib/publish-copy-types";

type ToolMode = "publish-copy" | "transcribe" | "download";
type BusyState = "" | ToolMode;
type NoticeTone = "success" | "info" | "error";

const toolModes: Array<{
  id: ToolMode;
  label: string;
  eyebrow: string;
  resultTitle: string;
  icon: LucideIcon;
}> = [
  { id: "publish-copy", label: "标题文案", eyebrow: "选题研究", resultTitle: "标题 / 发布文案", icon: Sparkles },
  { id: "transcribe", label: "提取文案", eyebrow: "单条链接", resultTitle: "转写结果", icon: FileText },
  { id: "download", label: "素材下载", eyebrow: "视频资产", resultTitle: "素材信息", icon: Download }
];

const downloadOptions: Array<{
  kind: SingleVideoAssetKind;
  label: string;
  icon: LucideIcon;
}> = [
  { kind: "video", label: "视频", icon: Video },
  { kind: "cover", label: "封面", icon: ImageIcon },
  { kind: "audio", label: "音频", icon: Music }
];

const publishPlatformOptions: Array<{
  value: PublishCopyTargetPlatform;
  label: string;
}> = [
  { value: "both", label: "双平台" },
  { value: "bilibili", label: "B站" },
  { value: "douyin", label: "抖音" }
];

export default function ToolsPage() {
  const { notify } = useFeedback();
  const [activeTool, setActiveTool] = useState<ToolMode>("publish-copy");
  const [url, setUrl] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [result, setResult] = useState<SingleVideoTranscribeResult | null>(null);
  const [downloadKind, setDownloadKind] = useState<SingleVideoAssetKind>("video");
  const [publishSourceText, setPublishSourceText] = useState("");
  const [publishTopicHint, setPublishTopicHint] = useState("");
  const [publishPlatform, setPublishPlatform] = useState<PublishCopyTargetPlatform>("both");
  const [publishResult, setPublishResult] = useState<PublishCopyResult | null>(null);
  const [busy, setBusy] = useState<BusyState>("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("success");

  const cleanUrl = url.trim();
  const cleanPublishSourceText = publishSourceText.trim();
  const canTranscribe = Boolean(cleanUrl) && !busy;
  const canDownload = Boolean(cleanUrl) && !busy;
  const canGeneratePublishCopy = Boolean(cleanPublishSourceText) && !busy;
  const canRunActiveTool =
    activeTool === "publish-copy" ? canGeneratePublishCopy : activeTool === "transcribe" ? canTranscribe : canDownload;
  const noticeIsError = noticeTone === "error";
  const activeMode = toolModes.find((mode) => mode.id === activeTool) || toolModes[0];
  const ActiveIcon = activeMode.icon;
  const activeMeta = useMemo(
    () => makeActiveMeta(activeTool, { publishResult, result, downloadKind, hasUrl: Boolean(cleanUrl) }),
    [activeTool, cleanUrl, downloadKind, publishResult, result]
  );

  async function handleTranscribe() {
    if (!cleanUrl || busy) return;
    setBusy("transcribe");
    setNotice("");
    try {
      const response = await transcribeSingleVideoLink({
        url: cleanUrl,
        titleHint: titleHint.trim() || undefined
      });
      setResult(response.result);
      const message = response.result.fallback
        ? response.result.fallbackReason || "已提取可用文本。"
        : "文案已提取。";
      const tone = response.result.fallback ? "info" : "success";
      setNotice(message);
      setNoticeTone(tone);
      notify({ tone, message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "单条视频文案提取失败";
      setNotice(message);
      setNoticeTone("error");
      notify({ tone: "error", message });
    } finally {
      setBusy("");
    }
  }

  async function handleDownload() {
    if (!cleanUrl || busy) return;
    setBusy("download");
    setNotice("");
    try {
      const response = await downloadSingleVideoAsset({
        url: cleanUrl,
        kind: downloadKind
      });
      const message = `已下载：${response.fileName}`;
      setNotice(message);
      setNoticeTone("success");
      notify({ tone: "success", message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "下载失败";
      setNotice(message);
      setNoticeTone("error");
      notify({ tone: "error", message });
    } finally {
      setBusy("");
    }
  }

  async function handleGeneratePublishCopy() {
    if (!cleanPublishSourceText || busy) return;
    setBusy("publish-copy");
    setNotice("");
    try {
      const response = await generatePublishCopy({
        platform: publishPlatform,
        sourceText: cleanPublishSourceText,
        topicHint: publishTopicHint.trim() || undefined,
        candidateCount: 6
      });
      setPublishResult(response);
      const message = response.fallback
        ? response.fallbackReason || "已生成可编辑标题和发布文案，请检查参考链路。"
        : `已生成 ${response.candidates.length} 组标题和发布文案。`;
      const tone = response.fallback ? "info" : "success";
      setNotice(message);
      setNoticeTone(tone);
      notify({ tone, message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "标题和发布文案生成失败";
      setNotice(message);
      setNoticeTone("error");
      notify({ tone: "error", message });
    } finally {
      setBusy("");
    }
  }

  async function handleRunActiveTool() {
    if (activeTool === "publish-copy") {
      await handleGeneratePublishCopy();
      return;
    }
    if (activeTool === "transcribe") {
      await handleTranscribe();
      return;
    }
    await handleDownload();
  }

  async function copyResultText() {
    if (!result?.text.trim()) return;
    await navigator.clipboard.writeText(result.text);
    notify({ tone: "success", message: "文案已复制。" });
  }

  async function copyPublishCandidate(candidate: PublishCopyCandidate) {
    await navigator.clipboard.writeText(`${candidate.title}\n\n${candidate.caption}`);
    notify({ tone: "success", message: "标题和发布文案已复制。" });
  }

  return (
    <div className="page tools-page">
      <header className="page-header">
        <div className="page-title-group">
          <span className="page-title-eyebrow">内容工具</span>
          <div className="page-title-row">
            <span className="page-title-mark" aria-hidden="true">
              <Wrench size={20} strokeWidth={2.1} />
            </span>
            <div className="page-title-copy">
              <h1>工具台</h1>
              <p className="subtle">选题标题，链接提文案，视频素材下载。</p>
            </div>
          </div>
        </div>
        <div className="page-header-meta">
          <span className="stat-pill">B站 / 抖音</span>
        </div>
      </header>

      <section className="panel tools-hub" aria-busy={Boolean(busy)}>
        <div className="tools-hub-grid">
          <div className="tools-entry">
            <div className="tools-mode-row">
              <span className="tools-label">工具</span>
              <div className="segmented tools-mode-tabs" role="group" aria-label="选择工具">
                {toolModes.map((mode) => {
                  const Icon = mode.icon;
                  const active = mode.id === activeTool;
                  return (
                    <button
                      className={active ? "active" : ""}
                      key={mode.id}
                      type="button"
                      onClick={() => setActiveTool(mode.id)}
                      aria-pressed={active}
                    >
                      <Icon size={15} aria-hidden="true" />
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="tools-active-head">
              <span>{activeMode.eyebrow}</span>
              <strong>{activeMode.resultTitle}</strong>
            </div>

            <div className="tools-entry-body">{renderToolInputs()}</div>

            <div className="tools-run-row">
              <button
                className="btn primary tools-run-submit"
                disabled={!canRunActiveTool}
                type="button"
                onClick={() => void handleRunActiveTool()}
                aria-busy={busy === activeTool}
              >
                {busy === activeTool ? <Loader2 aria-hidden="true" className="tools-spin" size={16} /> : <ActiveIcon aria-hidden="true" size={16} />}
                {getPrimaryActionLabel(activeTool, busy, downloadKind)}
              </button>
            </div>
          </div>

          <div className="tools-preview" aria-live="polite">
            <div className="tools-preview-head">
              <div>
                <h2>{activeMode.resultTitle}</h2>
                <p className="pane-subtitle">{getPreviewSubtitle(activeTool)}</p>
              </div>
              <MetaPills items={activeMeta} />
            </div>
            {renderToolResult()}
          </div>
        </div>
      </section>

      {notice ? <div className={noticeIsError ? "error" : "notice"} role={noticeIsError ? "alert" : "status"}>{notice}</div> : null}

      {publishResult ? (
        <section className="panel tools-research-panel">
          <details className="tools-research-details">
            <summary>
              <span>框架和参考选题</span>
              <small>
                {publishResult.frameworks.length} 个框架 / {publishResult.research.referenceCount} 条参考
              </small>
            </summary>
            <div className="tools-research-grid">
              <div className="tools-framework-list">
                {publishResult.frameworks.map((framework) => (
                  <div className="tools-framework-item" key={framework.name}>
                    <strong>{framework.name}</strong>
                    <span>标题：{framework.titlePattern}</span>
                    <span>发布：{framework.captionPattern}</span>
                    {framework.structure ? <span>结构：{framework.structure}</span> : null}
                  </div>
                ))}
              </div>
              <div className="tools-reference-list">
                {publishResult.research.references.slice(0, 8).map((reference) => (
                  <a href={reference.url} target="_blank" rel="noreferrer" key={`${reference.platform}-${reference.url}`}>
                    <span>{formatPlatformLabel(reference.platform)}｜{reference.title}</span>
                    <small>{formatReferenceMeta(reference)}</small>
                  </a>
                ))}
              </div>
            </div>
          </details>
        </section>
      ) : null}
    </div>
  );

  function renderToolInputs() {
    if (activeTool === "publish-copy") {
      return (
        <>
          <div className="tools-inline-group">
            <span className="tools-label">参考平台</span>
            <div className="segmented tools-platform-tabs" role="group" aria-label="参考平台">
              {publishPlatformOptions.map((option) => {
                const active = publishPlatform === option.value;
                return (
                  <button
                    className={active ? "active" : ""}
                    key={option.value}
                    type="button"
                    onClick={() => setPublishPlatform(option.value)}
                    aria-pressed={active}
                  >
                    <Search size={15} aria-hidden="true" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="field">
            <span>原文案</span>
            <textarea
              autoComplete="off"
              className="tools-source-textarea"
              name="publishSourceText"
              value={publishSourceText}
              onChange={(event) => setPublishSourceText(event.target.value)}
              placeholder="粘贴已有口播稿、发布文案或选题草稿…"
            />
          </label>
          <label className="field">
            <span>相似选题关键词</span>
            <div className="tools-input-shell">
              <Hash size={16} aria-hidden="true" />
              <input
                autoComplete="off"
                name="publishTopicHint"
                value={publishTopicHint}
                onChange={(event) => setPublishTopicHint(event.target.value)}
                placeholder="可留空…"
              />
            </div>
          </label>
        </>
      );
    }

    if (activeTool === "transcribe") {
      return (
        <>
          <VideoLinkField url={url} setUrl={setUrl} />
          <label className="field">
            <span>标题提示</span>
            <input
              autoComplete="off"
              name="titleHint"
              value={titleHint}
              onChange={(event) => setTitleHint(event.target.value)}
              placeholder="可留空…"
            />
          </label>
        </>
      );
    }

    return (
      <>
        <VideoLinkField url={url} setUrl={setUrl} />
        <div className="tools-inline-group">
          <span className="tools-label">下载类型</span>
          <div className="tools-download-options" role="group" aria-label="下载类型">
            {downloadOptions.map((option) => {
              const Icon = option.icon;
              const active = downloadKind === option.kind;
              return (
                <button
                  className={`btn icon-toggle ${active ? "active" : ""}`}
                  key={option.kind}
                  type="button"
                  onClick={() => setDownloadKind(option.kind)}
                  aria-pressed={active}
                >
                  <Icon size={16} aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  function renderToolResult() {
    if (activeTool === "publish-copy") {
      return publishResult?.candidates.length ? (
        <div className="tools-candidate-list">
          {publishResult.candidates.map((candidate, index) => (
            <article className="tools-candidate-card" key={`${candidate.title}-${index}`}>
              <div className="tools-candidate-head">
                <span className="status-pill">{formatTargetPlatformLabel(candidate.platform)}</span>
                <span>{candidate.angle || candidate.frameworkName || `候选 ${index + 1}`}</span>
              </div>
              <h3>{candidate.title}</h3>
              <p>{candidate.caption}</p>
              <button className="btn compact" type="button" onClick={() => void copyPublishCandidate(candidate)}>
                <Clipboard size={15} aria-hidden="true" />
                复制
              </button>
            </article>
          ))}
        </div>
      ) : (
        <ToolEmptyState icon={Sparkles} title="待生成" text="结果会显示在这里。" />
      );
    }

    if (activeTool === "transcribe") {
      return (
        <>
          <div className="tools-result-shell">
            {result?.text ? (
              <textarea aria-label="提取结果文案" autoComplete="off" className="tools-result-text" name="transcribeResult" value={result.text} readOnly />
            ) : (
              <ToolEmptyState icon={FileText} title="还没有提取结果" text="粘贴单条视频链接后，文案会显示在这里。" />
            )}
          </div>
          <div className="tools-result-actions">
            {result?.resolvedUrl ? (
              <a className="text-link" href={result.resolvedUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden="true" />
                打开来源
              </a>
            ) : null}
            <button className="btn" disabled={!result?.text} type="button" onClick={() => void copyResultText()}>
              <Clipboard size={16} aria-hidden="true" />
              复制文案
            </button>
          </div>
        </>
      );
    }

    return (
      <div className="tools-source-card">
        {result?.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={result.coverUrl} alt={result.title ? `${result.title} 封面` : "视频封面"} height={135} loading="lazy" width={240} />
        ) : (
          <div className="tools-cover-placeholder">
            <ImageIcon size={22} aria-hidden="true" />
          </div>
        )}
        <div>
          <strong>{result?.title || "未读取标题"}</strong>
          <span>{result?.sourceAccountName || (cleanUrl ? "链接已填写" : "来源待解析")}</span>
        </div>
      </div>
    );
  }
}

function VideoLinkField(input: { url: string; setUrl: (url: string) => void }) {
  return (
    <label className="field">
      <span>视频链接</span>
      <div className="tools-input-shell">
        <LinkIcon size={16} aria-hidden="true" />
        <input
          autoComplete="off"
          name="videoUrl"
          type="url"
          value={input.url}
          onChange={(event) => input.setUrl(event.target.value)}
          placeholder="https://www.bilibili.com/video/BV… 或 https://www.douyin.com/video/…"
        />
      </div>
    </label>
  );
}

function MetaPills(input: { items: string[] }) {
  return (
    <div className="tools-result-meta">
      {input.items.map((item) => (
        <span className="status-pill" key={item}>
          {item}
        </span>
      ))}
    </div>
  );
}

function ToolEmptyState(input: { icon: LucideIcon; title: string; text: string }) {
  const Icon = input.icon;
  return (
    <div className="tools-empty-result">
      <span className="empty-state-mark" aria-hidden="true">
        <Icon aria-hidden="true" size={18} />
      </span>
      <h3>{input.title}</h3>
      <p className="subtle">{input.text}</p>
    </div>
  );
}

function makeActiveMeta(
  activeTool: ToolMode,
  input: {
    publishResult: PublishCopyResult | null;
    result: SingleVideoTranscribeResult | null;
    downloadKind: SingleVideoAssetKind;
    hasUrl: boolean;
  }
) {
  if (activeTool === "publish-copy") {
    if (!input.publishResult) return ["待生成"];
    return [
      formatTargetPlatformLabel(input.publishResult.platform),
      `${input.publishResult.research.referenceCount} 条参考`,
      input.publishResult.fallback ? "需检查" : "已生成"
    ];
  }

  if (activeTool === "transcribe") {
    if (!input.result) return ["待提取"];
    return [
      platformLabel(input.result.platform),
      transcriptionSourceLabel(input.result.source),
      input.result.mediaUrls?.length ? `${input.result.mediaUrls.length} 个媒体地址` : "未返回媒体地址"
    ];
  }

  return [
    downloadOptions.find((option) => option.kind === input.downloadKind)?.label || "素材",
    input.hasUrl ? "链接就绪" : "待链接"
  ];
}

function getPrimaryActionLabel(activeTool: ToolMode, busy: BusyState, downloadKind: SingleVideoAssetKind) {
  if (busy === activeTool) {
    if (activeTool === "publish-copy") return "生成中";
    if (activeTool === "transcribe") return "提取中";
    return "下载中";
  }
  if (activeTool === "publish-copy") return "生成标题文案";
  if (activeTool === "transcribe") return "提取文案";
  const label = downloadOptions.find((option) => option.kind === downloadKind)?.label || "素材";
  return `下载${label}`;
}

function getPreviewSubtitle(activeTool: ToolMode) {
  if (activeTool === "publish-copy") return "候选标题和发布文案。";
  if (activeTool === "transcribe") return "平台字幕 / 火山转写 / 标题兜底。";
  return "下载会直接保存到本机。";
}

function formatTargetPlatformLabel(platform: PublishCopyTargetPlatform) {
  if (platform === "both") return "双平台";
  return formatPlatformLabel(platform);
}

function platformLabel(platform: SingleVideoTranscribeResult["platform"]) {
  if (platform === "bilibili") return "B站";
  if (platform === "douyin") return "抖音";
  return "未知平台";
}

function formatPlatformLabel(platform: "bilibili" | "douyin") {
  return platform === "bilibili" ? "B站" : "抖音";
}

function formatReferenceMeta(reference: PublishCopyResult["research"]["references"][number]) {
  const stats = reference.stats || {};
  const items = [
    stats.views ? `播放 ${stats.views}` : "",
    stats.likes ? `赞 ${stats.likes}` : "",
    stats.comments ? `评 ${stats.comments}` : ""
  ].filter(Boolean);
  return items.length ? items.join(" / ") : reference.query;
}

function transcriptionSourceLabel(source: SingleVideoTranscribeResult["source"]) {
  if (source === "platform_subtitle") return "平台字幕";
  if (source === "volcengine") return "火山转写";
  return "标题兜底";
}
