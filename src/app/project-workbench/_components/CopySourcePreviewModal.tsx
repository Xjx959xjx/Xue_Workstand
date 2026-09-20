"use client";

import { ExternalLink, FileText, X } from "lucide-react";
import { ModalBackdrop } from "@/components/ModalBackdrop";
import { formatDateWithYear, formatPlatform } from "@/components/Formatters";
import type { CopySource, CopySourceMaterialAnalysis } from "@/lib/types";

type CopySourcePreviewModalProps = {
  source: CopySource;
  onClose: () => void;
};

export function CopySourcePreviewModal({ source, onClose }: CopySourcePreviewModalProps) {
  const analysis = source.materialAnalysis;

  return (
    <ModalBackdrop onClose={onClose}>
      <div aria-labelledby="copy-source-preview-title" aria-modal="true" className="modal-panel copy-source-preview-modal" role="dialog" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="copy-source-preview-title">{source.title}</h2>
            <p className="pane-subtitle">{source.url}</p>
          </div>
          <div className="button-row">
            <a className="btn compact" href={source.url} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={14} />
              原链接
            </a>
            <button className="btn icon-btn" aria-label="关闭脚本预览弹窗" onClick={onClose} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </div>

        <div className="copy-source-preview-body">
          <div className="copy-source-preview-meta">
            <span className="status-pill">{source.platform === "unknown" ? "未知平台" : formatPlatform(source.platform)}</span>
            <span className="status-pill">{source.transcript.length} 字</span>
            <span className={`status-pill ${analysisTone(analysis)}`}>{analysisLabel(analysis)}</span>
            <span className="status-pill">{formatDateWithYear(source.updatedAt)}</span>
          </div>

          <section className="copy-source-script-block" aria-label="转写稿">
            <div className="copy-source-script-head">
              <h3>转写稿</h3>
              <span>{source.source === "metadata" ? "标题线索" : "原文"}</span>
            </div>
            <div className="copy-source-preview-text">{source.transcript || "暂无转写内容"}</div>
          </section>

          {analysis ? (
            <section className="copy-source-analysis-block" aria-label="画面描述">
              <div className="copy-source-analysis-head">
                <span className="project-workbench-source-icon">
                  <FileText aria-hidden="true" size={15} />
                </span>
                <span>
                  <strong>{analysis.mode === "multimodal" && analysis.status === "completed" ? "画面描述" : "标题 / 转写线索"}</strong>
                  <small>{analysis.frameCount ? `${analysis.frameCount} 帧 · ${formatDateWithYear(analysis.generatedAt)}` : formatDateWithYear(analysis.generatedAt)}</small>
                </span>
              </div>
              <AnalysisText label={analysis.mode === "multimodal" ? "画面描述" : "线索"} value={analysis.visualNotes || analysis.summary} />
              <AnalysisText label="镜头顺序" value={analysis.structureNotes} />
              <AnalysisText label="标题 / 封面" value={analysis.titleNotes} />
              <AnalysisText label="降级原因" value={analysis.fallbackReason || analysis.error} />
            </section>
          ) : (
            <div className="project-workbench-empty compact">这份素材还没有画面描述或文本线索。</div>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}

function AnalysisText({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="copy-source-analysis-text">
      <strong>{label}</strong>
      <p>{value}</p>
    </div>
  );
}

function analysisLabel(analysis?: CopySourceMaterialAnalysis) {
  if (!analysis) return "未分析";
  if (analysis.mode === "multimodal" && analysis.status === "completed") return "转写 + 画面";
  if (analysis.status === "failed") return "分析失败";
  return "文本线索";
}

function analysisTone(analysis?: CopySourceMaterialAnalysis) {
  if (!analysis) return "";
  if (analysis.mode === "multimodal" && analysis.status === "completed") return "done";
  if (analysis.status === "failed") return "failed";
  return "pending";
}
