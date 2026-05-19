import type { Draft } from "@/lib/types";

export function getDraftReferenceLabel(draft: Draft) {
  return draft.targetType === "project" ? `项目 ${draft.projectName}` : draft.accountName;
}

export function buildRewriteHref(draft: Draft) {
  const params = new URLSearchParams({
    mode: "rewrite",
    draftId: draft.id
  });

  if (draft.targetType === "project") {
    params.set("targetType", "project");
    params.set("projectId", draft.projectId);
  } else {
    params.set("targetType", "account");
    params.set("accountId", draft.accountId);
  }

  return `/writer?${params.toString()}`;
}
