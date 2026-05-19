export type LinkJob = {
  url: string;
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
};

export const EMPTY_STYLE = "先加案例，再生成风格卡。";

export function formatJob(status: LinkJob["status"]) {
  if (status === "queued") return "排队";
  if (status === "running") return "转写";
  if (status === "completed") return "完成";
  return "失败";
}
