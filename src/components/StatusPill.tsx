import { TranscriptStatus } from "@/lib/types";

const labels: Record<TranscriptStatus, string> = {
  not_started: "未采集",
  pending: "待转写",
  transcribing: "转写中",
  failed: "转写失败",
  completed: "已完成"
};

export function StatusPill({ status }: { status: TranscriptStatus }) {
  return <span className={`status-pill ${status}`}>{labels[status] || status}</span>;
}
