import { useCallback, useRef, useState } from "react";

import { fetchActivityStats } from "../api";
import type { ActivityStats } from "../types";

export function useActivityStats() {
  const [activityStats, setActivityStats] = useState<ActivityStats | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(false);
  const requestIdRef = useRef(0);

  const loadActivityStats = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setActivityLoading(true);
    try {
      const stats = await fetchActivityStats();
      if (requestIdRef.current !== requestId) {
        // A newer request started after this one; let its result win instead.
        return;
      }
      setActivityStats(stats);
      setActivityError(false);
    } catch {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setActivityStats(null);
      setActivityError(true);
    } finally {
      if (requestIdRef.current === requestId) {
        setActivityLoading(false);
      }
    }
  }, []);

  return {
    activityStats,
    activityLoading,
    activityError,
    loadActivityStats
  };
}
