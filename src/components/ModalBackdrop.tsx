"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { useDialogInteraction } from "./useDialogInteraction";

type ModalBackdropProps = {
  children: ReactNode;
  closeLabel?: string;
  disabled?: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function ModalBackdrop({
  children,
  closeLabel = "关闭弹窗",
  disabled = false,
  onClose,
  initialFocusRef,
  returnFocusRef
}: ModalBackdropProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useDialogInteraction(rootRef, { onClose, disabled, initialFocusRef, returnFocusRef });
  return (
    <div className="modal-backdrop" ref={rootRef}>
      <button
        aria-label={closeLabel}
        className="modal-backdrop-dismiss"
        disabled={disabled}
        onClick={close}
        tabIndex={-1}
        type="button"
      />
      {children}
    </div>
  );
}
