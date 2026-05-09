import { TranscriptStatus } from "@/lib/types";

const labels: Record<TranscriptStatus, string> = {
  not_started: "未完成",
  pending: "未完成",
  transcribing: "未完成",
  failed: "转写失败",
  completed: "已完成"
};

export function StatusPill({ status }: { status: TranscriptStatus }) {
  return <span className={`status-pill ${status}`}>{labels[status] || status}</span>;
}
