"use client";

import { usePathname } from "next/navigation";
import { LibraryProvider } from "./LibraryProvider";
import { TaskProvider } from "./TaskProvider";
import { FeedbackProvider } from "./FeedbackProvider";
import type { AppMode } from "@/lib/app-mode";

export function AppProviders({ appMode, children }: { appMode: AppMode; children: React.ReactNode }) {
  const pathname = usePathname();
  const needsWorkspaceState = appMode !== "gross-margin" && !pathname.startsWith("/gross-margin");

  return (
    <FeedbackProvider>
      {needsWorkspaceState ? (
        <LibraryProvider>
          <TaskProvider>{children}</TaskProvider>
        </LibraryProvider>
      ) : (
        children
      )}
    </FeedbackProvider>
  );
}
