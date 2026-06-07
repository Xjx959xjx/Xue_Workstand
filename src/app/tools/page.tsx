"use client";

import { useMemo, useState } from "react";
import {
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Music,
  Video,
  Wrench
} from "lucide-react";
import { useFeedback } from "@/components/FeedbackProvider";
import {
  downloadSingleVideoAsset,
  transcribeSingleVideoLink,
  type SingleVideoAssetKind,
  type SingleVideoTranscribeResult
} from "@/lib/client";

type BusyState = "" | "transcribe" | "download";
type NoticeTone = "success" | "info" | "error";

const downloadOptions: Array<{
  kind: SingleVideoAssetKind;
  label: string;
  icon: typeof Video;
}> = [
  { kind: "video", label: "视频", icon: Video },
  { kind: "cover", label: "封面", icon: ImageIcon },
  { kind: "audio", label: "音频", icon: Music }
];

export default function ToolsPage() {
  const { notify } = useFeedback();
  const [url, setUrl] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [result, setResult] = useState<SingleVideoTranscribeResult | null>(null);
  const [downloadKind, setDownloadKind] = useState<SingleVideoAssetKind>("video");
  const [busy, setBusy] = useState<BusyState>("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("success");

  const cleanUrl = url.trim();
  const canSubmit = Boolean(cleanUrl) && !busy;
  const noticeIsError = noticeTone === "error";
  const resultMeta = useMemo(() => makeResultMeta(result), [result]);

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

  async function copyResultText() {
    if (!result?.text.trim()) return;
    await navigator.clipboard.writeText(result.text);
    notify({ tone: "success", message: "文案已复制。" });
  }

  return (
    <div className="page tools-page">
      <header className="page-header">
        <div className="page-title-group">
          <span className="page-title-eyebrow">单条视频</span>
          <div className="page-title-row">
            <span className="page-title-mark" aria-hidden="true">
              <Wrench size={20} strokeWidth={2.1} />
            </span>
            <div className="page-title-copy">
              <h1>工具台</h1>
              <p className="subtle">链接提文案，视频素材下载。</p>
            </div>
          </div>
        </div>
        <div className="page-header-meta">
          <span className="stat-pill">B站 / 抖音</span>
        </div>
      </header>

      <section className="panel tools-link-panel">
        <div className="tools-link-grid">
          <label className="field tools-url-field">
            <span>视频链接</span>
            <div className="tools-input-shell">
              <LinkIcon size={16} aria-hidden="true" />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.bilibili.com/video/BV... 或 https://www.douyin.com/video/..."
              />
            </div>
          </label>
          <label className="field">
            <span>标题提示</span>
            <input
              value={titleHint}
              onChange={(event) => setTitleHint(event.target.value)}
              placeholder="可留空"
            />
          </label>
          <div className="tools-link-actions">
            <button
              className="btn primary"
              disabled={!canSubmit}
              type="button"
              onClick={() => void handleTranscribe()}
              aria-busy={busy === "transcribe"}
            >
              {busy === "transcribe" ? <Loader2 className="tools-spin" size={16} /> : <FileText size={16} />}
              提取文案
            </button>
          </div>
        </div>
      </section>

      {notice ? <div className={noticeIsError ? "error" : "notice"} role={noticeIsError ? "alert" : "status"}>{notice}</div> : null}

      <section className="tools-workbench">
        <section className="panel tools-copy-panel" aria-busy={busy === "transcribe"}>
          <div className="tools-panel-header">
            <div>
              <h2>转写结果</h2>
              <p className="pane-subtitle">平台字幕 / 火山转写 / 标题兜底。</p>
            </div>
          </div>

          <div className="tools-result-meta">
            {resultMeta.map((item) => (
              <span className="status-pill" key={item}>
                {item}
              </span>
            ))}
          </div>

          <div className="tools-result-shell">
            {result?.text ? (
              <textarea className="tools-result-text" value={result.text} readOnly />
            ) : (
              <div className="tools-empty-result">
                <span className="empty-state-mark" aria-hidden="true">
                  <FileText size={18} />
                </span>
                <h2>还没有提取结果</h2>
                <p className="subtle">粘贴单条视频链接后，文案会显示在这里。</p>
              </div>
            )}
          </div>

          <div className="tools-result-actions">
            {result?.resolvedUrl ? (
              <a className="text-link" href={result.resolvedUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
                打开来源
              </a>
            ) : null}
            <button className="btn" disabled={!result?.text} type="button" onClick={() => void copyResultText()}>
              <Clipboard size={16} />
              复制文案
            </button>
          </div>
        </section>

        <aside className="panel tools-download-panel" aria-busy={busy === "download"}>
          <div className="tools-panel-header">
            <div>
              <h2>素材下载</h2>
              <p className="pane-subtitle">视频、封面或音频。</p>
            </div>
          </div>

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
                  <Icon size={16} />
                  {option.label}
                </button>
              );
            })}
          </div>

          <button
            className="btn primary tools-download-submit"
            disabled={!canSubmit}
            type="button"
            onClick={() => void handleDownload()}
            aria-busy={busy === "download"}
          >
            {busy === "download" ? <Loader2 className="tools-spin" size={16} /> : <Download size={16} />}
            下载{downloadOptions.find((option) => option.kind === downloadKind)?.label}
          </button>

          <div className="tools-source-card">
            {result?.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.coverUrl} alt={result.title ? `${result.title} 封面` : "视频封面"} />
            ) : (
              <div className="tools-cover-placeholder">
                <ImageIcon size={22} aria-hidden="true" />
              </div>
            )}
            <div>
              <strong>{result?.title || "未读取标题"}</strong>
              <span>{result?.sourceAccountName || "来源账号待解析"}</span>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function makeResultMeta(result: SingleVideoTranscribeResult | null) {
  if (!result) return ["待提取"];
  return [
    platformLabel(result.platform),
    transcriptionSourceLabel(result.source),
    result.mediaUrls?.length ? `${result.mediaUrls.length} 个媒体地址` : "未返回媒体地址"
  ];
}

function platformLabel(platform: SingleVideoTranscribeResult["platform"]) {
  if (platform === "bilibili") return "B站";
  if (platform === "douyin") return "抖音";
  return "未知平台";
}

function transcriptionSourceLabel(source: SingleVideoTranscribeResult["source"]) {
  if (source === "platform_subtitle") return "平台字幕";
  if (source === "volcengine") return "火山转写";
  return "标题兜底";
}
