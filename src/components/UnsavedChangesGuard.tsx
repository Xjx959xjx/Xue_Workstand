"use client";

const UNSAVED_CHANGES_SELECTOR = '[data-unsaved-changes="true"]';
const DEFAULT_DISCARD_MESSAGE = "当前页面有未保存内容，离开后修改会丢失。仍要离开吗？";

export function hasUnsavedChanges() {
  return typeof document !== "undefined" && Boolean(document.querySelector(UNSAVED_CHANGES_SELECTOR));
}

export function confirmDiscardUnsavedChanges(message = DEFAULT_DISCARD_MESSAGE) {
  if (!hasUnsavedChanges()) return true;
  return window.confirm(message);
}
