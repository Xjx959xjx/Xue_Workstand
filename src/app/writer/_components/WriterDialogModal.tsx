"use client";

import type { ReactNode } from "react";
import { ModalBackdrop } from "@/components/ModalBackdrop";

type WriterDialogModalProps = {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  panelClassName?: string;
};

export function WriterDialogModal({
  children,
  labelledBy,
  onClose,
  panelClassName = ""
}: WriterDialogModalProps) {
  return (
    <ModalBackdrop onClose={onClose}>
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`modal-panel ${panelClassName}`}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </ModalBackdrop>
  );
}
