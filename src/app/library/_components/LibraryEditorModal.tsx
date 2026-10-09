"use client";

import { memo, type ReactNode } from "react";
import { ModalBackdrop } from "@/components/ModalBackdrop";
import { useUnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

type LibraryEditorModalProps = {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  panelClassName?: string;
  unsavedChanges?: boolean;
  disabled?: boolean;
};

export const LibraryEditorModal = memo(function LibraryEditorModal({
  children,
  labelledBy,
  onClose,
  panelClassName = "",
  unsavedChanges = false,
  disabled = false
}: LibraryEditorModalProps) {
  useUnsavedChangesGuard(unsavedChanges);
  return (
    <ModalBackdrop
      disabled={disabled}
      onClose={onClose}
      aria-labelledby={labelledBy}
      className={`modal-panel ${panelClassName}`}
      data-unsaved-changes={unsavedChanges ? "true" : undefined}
    >
        {children}
    </ModalBackdrop>
  );
});
