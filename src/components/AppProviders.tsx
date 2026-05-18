"use client";

import { LibraryProvider } from "./LibraryProvider";
import { TaskProvider } from "./TaskProvider";
import { FeedbackProvider } from "./FeedbackProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <LibraryProvider>
      <FeedbackProvider>
        <TaskProvider>{children}</TaskProvider>
      </FeedbackProvider>
    </LibraryProvider>
  );
}
