"use client";

import { usePathname } from "next/navigation";
import { LibraryProvider } from "./LibraryProvider";
import { TaskProvider } from "./TaskProvider";
import { FeedbackProvider } from "./FeedbackProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const needsWorkspaceState = !pathname.startsWith("/gross-margin");

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
