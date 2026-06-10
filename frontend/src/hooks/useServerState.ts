import { useCallback, useState } from "react";

import { checkHealth, listMaterials, listSessions, listWords } from "../api";
import type { Health, MaterialItem, PracticeSession, VocabularyItem } from "../types";

export function useServerState(setError: (msg: string) => void) {
  const [health, setHealth] = useState<Health | null>(null);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);

  const refreshServerState = useCallback(async () => {
    try {
      setError("");
      const [nextHealth, nextSessions, nextWords, nextMaterials] = await Promise.all([
        checkHealth(),
        listSessions(),
        listWords(),
        listMaterials()
      ]);
      setHealth(nextHealth);
      setSessions(nextSessions);
      setVocabulary(nextWords);
      setMaterials(nextMaterials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backend is not reachable.");
    }
  }, [setError]);

  const refreshVocabulary = useCallback(async () => {
    setVocabulary(await listWords());
  }, []);

  const refreshMaterials = useCallback(async () => {
    setMaterials(await listMaterials());
  }, []);

  return {
    health,
    sessions,
    vocabulary,
    materials,
    refreshServerState,
    refreshVocabulary,
    refreshMaterials
  };
}
