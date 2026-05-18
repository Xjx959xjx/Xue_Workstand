---
name: Account Style Library Workbench
description: Desktop-first local content operations workbench for style collection, transcription, and copy generation.
colors:
  bg: "oklch(0.945 0.016 236)"
  bg-elevated: "oklch(0.982 0.009 236)"
  panel: "oklch(0.994 0.004 236)"
  panel-soft: "oklch(0.966 0.011 236)"
  text: "oklch(0.245 0.031 246)"
  muted: "oklch(0.505 0.034 246)"
  line: "oklch(0.875 0.018 236)"
  accent: "oklch(0.69 0.118 183)"
  blue: "oklch(0.55 0.145 256)"
  amber: "oklch(0.61 0.13 72)"
  rose: "oklch(0.54 0.155 8)"
typography:
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 10px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "14px"
---

## Overview

The interface is a desktop-first local workbench. It should feel efficient, precise, and alive enough to reveal state without distracting from collection, transcription, editing, and writing tasks.

## Colors

Use restrained tinted neutrals with teal as the primary action and selection accent. Blue is informational, amber is pending or configuration-needed, rose is destructive or failed, and green is completed. Color should clarify workflow state rather than decorate inactive surfaces.

## Typography

Use the system UI stack throughout. Keep type compact, with clear weight contrast between page titles, section headers, labels, and metadata. Body and metadata can stay dense; long generated text should use more relaxed line height.

## Elevation

Surfaces use low, layered elevation: subtle borders, tinted panel backgrounds, and small shadows. Strong shadows are reserved for modals and lifted hover states. Avoid glass effects as the default.

## Components

Buttons, segmented controls, list rows, panes, status pills, progress bars, dialogs, and empty states share the same radius and interaction language. Desktop states must cover default, hover, focus, active, disabled, loading, selected, success, warning, and error.

## Do's and Don'ts

Do keep desktop information dense, preserve local asset safety, show progress for long operations, and make fallback behavior editable rather than alarming.

Don't introduce a marketing hero, large decorative animations, dark neon theming, nested cards, or side-stripe active states. Motion should be 150-250ms and tied to state changes.
