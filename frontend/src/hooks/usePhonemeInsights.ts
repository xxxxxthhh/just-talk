import { useCallback, useState } from "react";

import { fetchPhonemeStats } from "../api";
import type { PhonemeStat } from "../types";

export function usePhonemeInsights() {
  const [stats, setStats] = useState<PhonemeStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedPhoneme, setExpandedPhoneme] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStats(await fetchPhonemeStats());
    } catch (err) {
      setStats([]);
      setError(err instanceof Error ? err.message : "Could not load phoneme stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  return { stats, loading, error, expandedPhoneme, setExpandedPhoneme, loadStats };
}
