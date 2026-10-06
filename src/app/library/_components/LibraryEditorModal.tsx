"use client";

import { memo, type ReactNode, type RefObject } from "react";
import { ModalBackdrop } from "@/components/ModalBackdrop";
import { useUnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

type LibraryEditorModalProps = {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  panelClassName?: string;
  panelRef: RefObject<HTMLDivElement | null>;
  unsavedChanges?: boolean;
  disabled?: boolean;
};

export const LibraryEditorModal = memo(function LibraryEditorModal({
  children,
  labelledBy,
  onClose,
  panelClassName = "",
  panelRef,
  unsavedChanges = false,
  disabled = false
}: LibraryEditorModalProps) {
  useUnsavedChangesGuard(unsavedChanges, "编辑器还有未保存修改，确定要离开吗？");
  return (
    <ModalBackdrop disabled={disabled} onClose={onClose}>
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
