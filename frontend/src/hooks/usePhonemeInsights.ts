import { useCallback, useState } from "react";

import { fetchPhonemeStats, generateDrill as requestDrill } from "../api";
import type { MaterialItem, PhonemeStat } from "../types";

export function usePhonemeInsights(
  onDrillCreated?: (material: MaterialItem) => void
) {
  const [stats, setStats] = useState<PhonemeStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedPhoneme, setExpandedPhoneme] = useState<string | null>(null);
  const [generatingPhoneme, setGeneratingPhoneme] = useState<string | null>(null);
  const [drillError, setDrillError] = useState("");

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

  const generateDrill = useCallback(
    async (phoneme: string) => {
      setGeneratingPhoneme(phoneme);
      setDrillError("");
      try {
        const material = await requestDrill(phoneme);
        onDrillCreated?.(material);
      } catch (err) {
        setDrillError(
          err instanceof Error ? err.message : "Could not generate a drill."
        );
      } finally {
        setGeneratingPhoneme(null);
      }
    },
    [onDrillCreated]
  );

  return {
    stats,
    loading,
    error,
    expandedPhoneme,
    setExpandedPhoneme,
    loadStats,
    generatingPhoneme,
    drillError,
    generateDrill
  };
}
