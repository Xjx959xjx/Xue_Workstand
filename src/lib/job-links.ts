import type { JobRecord } from "./types";

export const ENGAGEMENT_RECORD_QUERY_PARAM = "recordId";

export function buildEngagementRecordHref(recordId: string, baseHref = "/assets") {
  const [hrefWithoutHash, hash = ""] = baseHref.split("#", 2);
  const [pathname, query = ""] = hrefWithoutHash.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(ENGAGEMENT_RECORD_QUERY_PARAM, recordId);
  return `${pathname || "/assets"}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

export function getJobResultHref(job: Pick<JobRecord, "href" | "kind" | "resultRef">) {
  const href = job.resultRef?.href || job.href;
  if (job.kind === "engagement" && job.resultRef?.id) {
    return buildEngagementRecordHref(job.resultRef.id, href || "/assets");
  }
  return href;
}
