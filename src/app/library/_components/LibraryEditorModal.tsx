"use client";

import { memo, type ReactNode, type RefObject } from "react";
import { ModalBackdrop } from "@/components/ModalBackdrop";

type LibraryEditorModalProps = {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  panelClassName?: string;
  panelRef: RefObject<HTMLDivElement | null>;
  unsavedChanges?: boolean;
};

export const LibraryEditorModal = memo(function LibraryEditorModal({
  children,
  labelledBy,
  onClose,
  panelClassName = "",
  panelRef,
  unsavedChanges = false
}: LibraryEditorModalProps) {
  return (
    <ModalBackdrop onClose={onClose}>
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`modal-panel ${panelClassName}`}
        data-unsaved-changes={unsavedChanges ? "true" : undefined}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </ModalBackdrop>
  );
});
