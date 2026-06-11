"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getLibraryOverview } from "@/lib/client";
import type { LibraryOverview, LibraryOverviewResponse } from "@/lib/types";

type LibraryContextValue = {
  library: LibraryOverview | null;
  loading: boolean;
  error: string;
  refresh: (options?: { force?: boolean }) => Promise<void>;
};

const LibraryContext = createContext<LibraryContextValue | null>(null);
let libraryOverviewCache: LibraryOverviewResponse | null = null;
let libraryOverviewRequest: Promise<LibraryOverviewResponse> | null = null;
let libraryOverviewRequestSeq = 0;

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [library, setLibrary] = useState<LibraryOverview | null>(() =>
    libraryOverviewCache ? buildLibraryOverview(libraryOverviewCache) : null
  );
  const [loading, setLoading] = useState(() => !libraryOverviewCache);
  const [error, setError] = useState("");
  const hasLibraryRef = useRef(Boolean(libraryOverviewCache));
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(async (options: { force?: boolean } = {}) => {
    const refreshSeq = refreshSeqRef.current + 1;
    refreshSeqRef.current = refreshSeq;
    if (!hasLibraryRef.current) setLoading(true);
    setError("");
    try {
      const overview = await loadLibraryOverview(options.force ?? true);
      if (refreshSeq !== refreshSeqRef.current) return;
      hasLibraryRef.current = true;
      setLibrary(buildLibraryOverview(overview));
    } catch (err) {
      if (refreshSeq !== refreshSeqRef.current) return;
      setError(err instanceof Error ? err.message : "读取本地风格库失败，请确认 style-library 目录可访问。");
    } finally {
      if (refreshSeq === refreshSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh({ force: false });
  }, [refresh]);

  const value = useMemo(() => ({ library, loading, error, refresh }), [library, loading, error, refresh]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error("useLibrary must be used inside LibraryProvider");
  return context;
}

function buildLibraryOverview(library: LibraryOverviewResponse): LibraryOverview {
  return {
    ...library,
    recentAccounts: library.accounts.slice(0, 4),
    recentProjects: library.projects.slice(0, 4),
    recentCopySources: [...library.copySources].sort(compareCreatedAtDesc).slice(0, 8),
    recentEngagementRecords: [...library.engagementRecords].sort(compareCreatedAtDesc).slice(0, 8),
    recentDrafts: [...library.drafts].sort(compareCreatedAtDesc).slice(0, 8)
  };
}

function loadLibraryOverview(force: boolean) {
  if (!force && libraryOverviewRequest) return libraryOverviewRequest;
  if (!force && libraryOverviewCache) return Promise.resolve(libraryOverviewCache);

  const requestSeq = libraryOverviewRequestSeq + 1;
  libraryOverviewRequestSeq = requestSeq;
  const request = getLibraryOverview()
    .then((library) => {
      if (requestSeq === libraryOverviewRequestSeq) libraryOverviewCache = library;
      return library;
    })
    .finally(() => {
      if (libraryOverviewRequest === request) libraryOverviewRequest = null;
    });
  libraryOverviewRequest = request;
  return request;
}

function compareCreatedAtDesc(left: { createdAt: string }, right: { createdAt: string }) {
  return +new Date(right.createdAt) - +new Date(left.createdAt);
}
