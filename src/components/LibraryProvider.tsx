"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLibrary } from "@/lib/client";
import { LibraryState } from "@/lib/types";

type LibraryContextValue = {
  library: LibraryState | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setLibrary(await getLibrary());
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取本地风格库失败，请确认 style-library 目录可访问。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ library, loading, error, refresh }), [library, loading, error, refresh]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error("useLibrary must be used inside LibraryProvider");
  return context;
}
