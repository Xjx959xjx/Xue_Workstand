"use client";

import { useEffect } from "react";

const UNSAVED_CHANGES_SELECTOR = '[data-unsaved-changes="true"]';

export function hasUnsavedChanges() {
  return typeof document !== "undefined" && Boolean(document.querySelector(UNSAVED_CHANGES_SELECTOR));
}

export function confirmDiscardUnsavedChanges(message: string) {
  if (!hasUnsavedChanges()) return true;
  return window.confirm(message);
}

export function useUnsavedChangesGuard(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const anchor = (event.target as Element).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download") || new URL(anchor.href).pathname === window.location.pathname) return;
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty, message]);
}
