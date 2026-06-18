"use client";

import { usePathname } from "next/navigation";
import { LibraryProvider } from "./LibraryProvider";
import { TaskProvider } from "./TaskProvider";
import { FeedbackProvider } from "./FeedbackProvider";
import type { AppMode } from "@/lib/app-mode";

export function AppProviders({ appMode, children }: { appMode: AppMode; children: React.ReactNode }) {
  const pathname = usePathname();
  const needsLibrary = appMode !== "gross-margin" && isLibraryRoute(pathname);

  return (
    <FeedbackProvider>
      {appMode === "gross-margin" ? (
        children
      ) : (
        <LibraryProvider enabled={needsLibrary}>
          <TaskProvider>{children}</TaskProvider>
        </LibraryProvider>
      )}
    </FeedbackProvider>
  );
}

function isLibraryRoute(pathname: string) {
  return pathname === "/library" || pathname === "/project-workbench" || pathname === "/writer";
}
