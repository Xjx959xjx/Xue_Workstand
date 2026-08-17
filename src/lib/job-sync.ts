import type { JobListItem, JobListResponse } from "./types";

const JOB_LIST_LIMIT = 80;

export function applyJobListResponse(current: JobListItem[], response: JobListResponse) {
  if (response.reset) return sortJobList(response.jobs);

  const removed = new Set(response.removedJobIds);
  const merged = new Map(current.filter((job) => !removed.has(job.id)).map((job) => [job.id, job]));
  for (const job of response.jobs) merged.set(job.id, job);
  return sortJobList([...merged.values()]);
}

function sortJobList(jobs: JobListItem[]) {
  return [...jobs]
    .sort((left, right) => +new Date(right.updatedAt) - +new Date(left.updatedAt))
    .slice(0, JOB_LIST_LIMIT);
}
