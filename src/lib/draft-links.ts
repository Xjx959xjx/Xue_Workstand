import type { Draft } from "./types";

export function buildWriterDraftHref(draft: Draft) {
  const params = new URLSearchParams({
    draftId: draft.id,
    mode: draft.mode,
    targetType: draft.targetType === "project" ? "project" : "account"
  });

  if (draft.targetType === "project") {
    params.set("projectId", draft.projectId);
  } else {
    params.set("accountId", draft.accountId);
  }

  return `/writer?${params.toString()}`;
}
