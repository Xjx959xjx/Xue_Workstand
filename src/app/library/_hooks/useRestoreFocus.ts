"use client";

import { useEffect, type RefObject } from "react";

export function useRestoreFocus<T extends HTMLElement>(active: boolean, ref: RefObject<T | null>) {
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [active, ref]);
}
