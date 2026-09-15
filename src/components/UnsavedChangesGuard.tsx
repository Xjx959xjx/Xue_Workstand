"use client";

import { useEffect } from "react";

const UNSAVED_CHANGES_SELECTOR = '[data-unsaved-changes="true"]';
const DEFAULT_DISCARD_MESSAGE = "当前页面有未保存内容，离开后修改会丢失。仍要离开吗？";

export function hasUnsavedChanges() {
  return typeof document !== "undefined" && Boolean(document.querySelector(UNSAVED_CHANGES_SELECTOR));
}

export function confirmDiscardUnsavedChanges(message = DEFAULT_DISCARD_MESSAGE) {
  if (!hasUnsavedChanges()) return true;
  return window.confirm(message);
}

export function useUnsavedChangesGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || link.target === "_blank") return;
      const target = new URL(link.href, location.href);
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      if (!confirmDiscardUnsavedChanges()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [enabled]);
}
