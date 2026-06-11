"use client";

import type { KeyboardEventHandler, ReactNode } from "react";

type ModalBackdropProps = {
  children: ReactNode;
  closeLabel?: string;
  disabled?: boolean;
  onClose: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

export function ModalBackdrop({
  children,
  closeLabel = "关闭弹窗",
  disabled = false,
  onClose,
  onKeyDown
}: ModalBackdropProps) {
  return (
    <div className="modal-backdrop" onKeyDown={onKeyDown}>
      <button
        aria-label={closeLabel}
        className="modal-backdrop-dismiss"
        disabled={disabled}
        onClick={onClose}
        type="button"
      />
      {children}
    </div>
  );
}
