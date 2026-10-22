/**
 * useInvalidateAll — invalidates all wagmi read queries after a tx confirms,
 * then schedules a second refetch 2 s later for nodes that are one block behind.
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useInvalidateAll() {
  const qc = useQueryClient();

  return useCallback(() => {
    void qc.invalidateQueries();
    setTimeout(() => { void qc.invalidateQueries(); }, 2_000);
  }, [qc]);
}
