import { useCallback, useEffect, useRef, useState } from "react";
import { speakText } from "../api";

const SPEECH_CACHE_LIMIT = 30;

type SpeechCacheEntry = {
  url?: string;
  promise?: Promise<string>;
  lastUsed: number;
};

type SpeechStatus = "idle" | "loading" | "playing";

function normalizedSpeechText(text: string): string {
  return text.trim();
}

function responseToObjectUrl(response: Awaited<ReturnType<typeof speakText>>): string {
  const binary = window.atob(response.audio_base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: response.content_type }));
}

export function useSpeech(setError: (msg: string) => void) {
  const [speakingText, setSpeakingText] = useState("");
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSpeechKeyRef = useRef("");
  const playbackRequestRef = useRef(0);
  const cacheRef = useRef<Map<string, SpeechCacheEntry>>(new Map());

  const pauseCurrentSpeechAudio = useCallback(() => {
    if (speechAudioRef.current) {
      speechAudioRef.current.pause();
      speechAudioRef.current.currentTime = 0;
      speechAudioRef.current = null;
    }
    currentSpeechKeyRef.current = "";
  }, []);

  const stopCurrentSpeech = useCallback(() => {
    playbackRequestRef.current += 1;
    pauseCurrentSpeechAudio();
    setSpeakingText("");
    setSpeechStatus("idle");
  }, [pauseCurrentSpeechAudio]);

  const evictOldSpeech = useCallback(() => {
    const cache = cacheRef.current;
    while (cache.size > SPEECH_CACHE_LIMIT) {
      const oldestEntry = [...cache.entries()]
        .filter(([key]) => key !== currentSpeechKeyRef.current)
        .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)[0];
      if (!oldestEntry) return;
      const [key, entry] = oldestEntry;
      if (entry.url) {
        URL.revokeObjectURL(entry.url);
      }
      cache.delete(key);
    }
  }, []);

  const loadSpeechUrl = useCallback(
    async (spokenText: string): Promise<string> => {
      const cache = cacheRef.current;
      const cached = cache.get(spokenText);
      if (cached?.url) {
        cached.lastUsed = Date.now();
        return cached.url;
      }
      if (cached?.promise) {
        return cached.promise;
      }

      const entry: SpeechCacheEntry = cached ?? { lastUsed: Date.now() };
      const promise = speakText(spokenText)
        .then((response) => {
          const speechUrl = responseToObjectUrl(response);
          entry.url = speechUrl;
          entry.promise = undefined;
          entry.lastUsed = Date.now();
          cache.set(spokenText, entry);
          evictOldSpeech();
          return speechUrl;
        })
        .catch((err) => {
          cache.delete(spokenText);
          throw err;
        });

      entry.promise = promise;
      entry.lastUsed = Date.now();
      cache.set(spokenText, entry);
      return promise;
    },
    [evictOldSpeech]
  );

  const preloadSpeech = useCallback(
    async (text: string) => {
      const spokenText = normalizedSpeechText(text);
      if (!spokenText) return;
      try {
        await loadSpeechUrl(spokenText);
      } catch {
        // Preloading is an optimization; clicks still retry and surface errors.
      }
    },
    [loadSpeechUrl]
  );

  useEffect(() => {
    return () => {
      playbackRequestRef.current += 1;
      pauseCurrentSpeechAudio();
      for (const entry of cacheRef.current.values()) {
        if (entry.url) {
          URL.revokeObjectURL(entry.url);
        }
      }
      cacheRef.current.clear();
    };
  }, [pauseCurrentSpeechAudio]);

  const playCorrect = useCallback(async (text: string) => {
    const spokenText = normalizedSpeechText(text);
    if (!spokenText) return;
    setError("");
    playbackRequestRef.current += 1;
    const requestId = playbackRequestRef.current;
    pauseCurrentSpeechAudio();
    setSpeakingText(spokenText);
    setSpeechStatus("loading");
    try {
      const speechUrl = await loadSpeechUrl(spokenText);
      if (playbackRequestRef.current !== requestId) {
        return;
      }
      const audio = new Audio(speechUrl);
      speechAudioRef.current = audio;
      currentSpeechKeyRef.current = spokenText;
      const clearIfCurrent = () => {
        if (speechAudioRef.current === audio && playbackRequestRef.current === requestId) {
          speechAudioRef.current = null;
          currentSpeechKeyRef.current = "";
          setSpeakingText("");
          setSpeechStatus("idle");
        }
      };
      audio.onended = clearIfCurrent;
      audio.onerror = clearIfCurrent;
      setSpeechStatus("playing");
      await audio.play();
    } catch (err) {
      if (playbackRequestRef.current === requestId) {
        setError(err instanceof Error ? err.message : "Could not play pronunciation.");
        stopCurrentSpeech();
      }
    }
  }, [loadSpeechUrl, pauseCurrentSpeechAudio, setError, stopCurrentSpeech]);

  return { speakingText, speechStatus, preloadSpeech, playCorrect, stopCurrentSpeech };
}
