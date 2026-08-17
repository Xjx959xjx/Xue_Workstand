import type { JobRecord } from "./types";

export const DEFAULT_JOB_RESULT_PERSIST_BYTES = 96 * 1024;

export function compactJobForPersistence(
  job: JobRecord,
  maxResultBytes = DEFAULT_JOB_RESULT_PERSIST_BYTES
): JobRecord {
  if (!isTerminalStatus(job.status) || typeof job.result === "undefined") return job;

  const resultSizeBytes = Buffer.byteLength(JSON.stringify(job.result), "utf8");
  if (resultSizeBytes <= maxResultBytes) return job;

  const { result, ...compact } = job;
  void result;
  return {
    ...compact,
    resultCompacted: true,
    resultSizeBytes
  };
}

function isTerminalStatus(status: JobRecord["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}
