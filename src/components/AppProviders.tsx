"use client";

import { LibraryProvider } from "./LibraryProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <LibraryProvider>{children}</LibraryProvider>;
}
