import type { SyntheticEvent } from "react";

export function isBackdropEvent(event: SyntheticEvent<HTMLElement>) {
  return event.target === event.currentTarget;
}
