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

export function UnsavedChangesGuard() {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || !shouldConfirmLinkNavigation(event, link)) return;
      if (confirmDiscardUnsavedChanges()) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, []);

  return null;
}

function shouldConfirmLinkNavigation(event: MouseEvent, link: HTMLAnchorElement) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.hasAttribute("download") ||
    (link.target && link.target.toLowerCase() !== "_self")
  ) {
    return false;
  }

  const rawHref = link.getAttribute("href")?.trim();
  if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) return false;

  const destination = new URL(link.href, window.location.href);
  if (destination.protocol !== "http:" && destination.protocol !== "https:") return false;

  const current = new URL(window.location.href);
  if (destination.href === current.href) return false;
  return !(
    destination.origin === current.origin &&
    destination.pathname === current.pathname &&
    destination.search === current.search &&
    destination.hash !== current.hash
  );
}
