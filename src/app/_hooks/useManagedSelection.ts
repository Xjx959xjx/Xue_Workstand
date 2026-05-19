"use client";

import { useCallback, useState } from "react";

export function useManagedSelection() {
  const [manageMode, setManageModeState] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const setManageMode = useCallback((enabled: boolean) => {
    setManageModeState(enabled);
    setSelectedIds([]);
  }, []);

  const toggleSelectedId = useCallback((id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setManageModeState(false);
  }, []);

  return {
    clearSelection,
    manageMode,
    selectedIds,
    setManageMode,
    setSelectedIds,
    toggleSelectedId
  };
}
