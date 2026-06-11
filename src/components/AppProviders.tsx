"use client";

import { LibraryProvider } from "./LibraryProvider";
import { TaskProvider } from "./TaskProvider";
import { FeedbackProvider } from "./FeedbackProvider";
import type { AppMode } from "@/lib/app-mode";

export function AppProviders({ appMode, children }: { appMode: AppMode; children: React.ReactNode }) {
  return (
    <FeedbackProvider>
      {appMode === "gross-margin" ? (
        children
      ) : (
        <LibraryProvider>
          <TaskProvider>{children}</TaskProvider>
        </LibraryProvider>
      )}
    </FeedbackProvider>
  );
}
