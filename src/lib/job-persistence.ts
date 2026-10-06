import type { JobKind, JobRecord, JobStartInput } from "./types";

export const DEFAULT_JOB_RESULT_PERSIST_BYTES = 96 * 1024;

const resumableJobKinds = new Set<JobKind>([
  "account-style",
  "transcribe-video",
  "batch-transcribe",
  "hotlist-refresh",
  "hotspot-refresh",
  "gross-margin-refresh"
]);

export function isResumableJobKind(kind: JobKind, input?: JobStartInput) {
  return resumableJobKinds.has(kind) || (kind === "engagement" && input?.kind === "engagement"
    && Boolean(input.checkpointId) && input.input.includeComments === true && !input.input.includeDanmaku);
}

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
