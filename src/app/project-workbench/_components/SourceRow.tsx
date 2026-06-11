"use client";

import { FileText } from "lucide-react";
import { formatPlatform } from "@/components/Formatters";
import type { CopySource } from "@/lib/types";

type SourceRowProps = {
  actionLabel?: string;
  compact?: boolean;
  managing?: boolean;
  manageSelected?: boolean;
  selected: boolean;
  selectedLabel?: string;
  source: CopySource;
  onManageToggle?: () => void;
  onToggle: () => void;
};

export function SourceRow({
  actionLabel = "加入",
  compact,
  managing,
  manageSelected,
  selected,
  selectedLabel = "已选",
  source,
  onManageToggle,
  onToggle
}: SourceRowProps) {
  const meta = buildSourceMeta(source);
  const analysisLabel = source.materialAnalysis
    ? source.materialAnalysis.mode === "multimodal" && source.materialAnalysis.status === "completed"
      ? "画面描述"
      : "线索"
    : "";

  if (managing) {
    return (
      <label className={`project-workbench-source ${selected ? "selected" : ""} ${compact ? "compact" : ""} manage-row`}>
        <input checked={Boolean(manageSelected)} name="sourceIds" onChange={onManageToggle} type="checkbox" />
        <span className="project-workbench-source-icon">
          <FileText aria-hidden="true" size={15} />
        </span>
        <span>
          <strong>{source.title}</strong>
          <small>{meta}</small>
        </span>
        <span className={`status-pill ${analysisLabel === "画面描述" ? "done" : ""}`}>{analysisLabel || "素材"}</span>
      </label>
    );
  }

  return (
    <button className={`project-workbench-source ${selected ? "selected" : ""} ${compact ? "compact" : ""}`} onClick={onToggle} type="button">
      <span className="project-workbench-source-icon">
        <FileText aria-hidden="true" size={15} />
      </span>
      <span>
        <strong>{source.title}</strong>
        <small>{meta}</small>
      </span>
      <span className={`status-pill ${selected ? "done" : ""}`}>{selected ? selectedLabel : actionLabel}</span>
    </button>
  );
}

function buildSourceMeta(source: CopySource) {
  const platform = source.platform === "unknown" ? "未知平台" : formatPlatform(source.platform);
  const analysis = source.materialAnalysis
    ? source.materialAnalysis.mode === "multimodal" && source.materialAnalysis.status === "completed"
      ? "转写 + 画面描述"
      : "文本线索"
    : "未分析画面";
  return `${platform} · ${source.transcript.length} 字 · ${analysis}`;
}
