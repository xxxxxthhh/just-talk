import { useCallback, useEffect, useRef, useState } from "react";
import { speakText, type SpeakTextOptions } from "../api";

const SPEECH_CACHE_LIMIT = 30;

type SpeechCacheEntry = {
  url?: string;
  promise?: Promise<string>;
  lastUsed: number;
};

export type SpeechStatus = "idle" | "loading" | "playing" | "paused";
export type SpeechOptions = SpeakTextOptions;

function normalizedSpeechText(text: string): string {
  return text.trim();
}

function speechCacheIdentity(spokenText: string, options?: SpeechOptions): string {
  return options?.cacheKey ? `${options.cacheKey}::${spokenText}` : spokenText;
}

function responseToObjectUrl(response: Awaited<ReturnType<typeof speakText>>): string {
  const binary = window.atob(response.audio_base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: response.content_type }));
}

export function useSpeech(setError: (msg: string) => void) {
  const [speakingText, setSpeakingText] = useState("");
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const [speechCurrentTime, setSpeechCurrentTime] = useState(0);
  const [speechDuration, setSpeechDuration] = useState(0);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSpeechKeyRef = useRef("");
  const playbackRequestRef = useRef(0);
  const cacheRef = useRef<Map<string, SpeechCacheEntry>>(new Map());

  const resetCurrentSpeechAudio = useCallback(() => {
    if (speechAudioRef.current) {
      speechAudioRef.current.pause();
      speechAudioRef.current.currentTime = 0;
      speechAudioRef.current = null;
    }
    currentSpeechKeyRef.current = "";
    setSpeechCurrentTime(0);
    setSpeechDuration(0);
  }, []);

  const stopCurrentSpeech = useCallback(() => {
    playbackRequestRef.current += 1;
    resetCurrentSpeechAudio();
    setSpeakingText("");
    setSpeechStatus("idle");
  }, [resetCurrentSpeechAudio]);

  const pauseCurrentSpeech = useCallback(() => {
    const audio = speechAudioRef.current;
    if (!audio) return;
    audio.pause();
    setSpeechCurrentTime(audio.currentTime || 0);
    if (Number.isFinite(audio.duration)) {
      setSpeechDuration(audio.duration || 0);
    }
    setSpeechStatus("paused");
  }, []);

  const seekCurrentSpeech = useCallback((timeSeconds: number) => {
    const audio = speechAudioRef.current;
    if (!audio) return;
    const knownDuration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : speechDuration;
    const upperBound = knownDuration > 0 ? knownDuration : timeSeconds;
    const nextTime = Math.max(0, Math.min(timeSeconds, upperBound));
    audio.currentTime = nextTime;
    setSpeechCurrentTime(nextTime);
    if (knownDuration > 0) {
      setSpeechDuration(knownDuration);
    }
  }, [speechDuration]);

  const skipCurrentSpeech = useCallback((deltaSeconds: number) => {
    const audio = speechAudioRef.current;
    seekCurrentSpeech((audio?.currentTime ?? speechCurrentTime) + deltaSeconds);
  }, [seekCurrentSpeech, speechCurrentTime]);

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
    async (spokenText: string, options?: SpeechOptions): Promise<string> => {
      const cacheIdentity = speechCacheIdentity(spokenText, options);
      const cache = cacheRef.current;
      const cached = cache.get(cacheIdentity);
      if (cached?.url) {
        cached.lastUsed = Date.now();
        return cached.url;
      }
      if (cached?.promise) {
        return cached.promise;
      }

      const entry: SpeechCacheEntry = cached ?? { lastUsed: Date.now() };
      const promise = speakText(spokenText, options)
        .then((response) => {
          const speechUrl = responseToObjectUrl(response);
          entry.url = speechUrl;
          entry.promise = undefined;
          entry.lastUsed = Date.now();
          cache.set(cacheIdentity, entry);
          evictOldSpeech();
          return speechUrl;
        })
        .catch((err) => {
          cache.delete(cacheIdentity);
          throw err;
        });

      entry.promise = promise;
      entry.lastUsed = Date.now();
      cache.set(cacheIdentity, entry);
      return promise;
    },
    [evictOldSpeech]
  );

  const preloadSpeech = useCallback(
    async (text: string, options?: SpeechOptions) => {
      const spokenText = normalizedSpeechText(text);
      if (!spokenText) return;
      try {
        await loadSpeechUrl(spokenText, options);
      } catch {
        // Preloading is an optimization; clicks still retry and surface errors.
      }
    },
    [loadSpeechUrl]
  );

  useEffect(() => {
    return () => {
      playbackRequestRef.current += 1;
      resetCurrentSpeechAudio();
      for (const entry of cacheRef.current.values()) {
        if (entry.url) {
          URL.revokeObjectURL(entry.url);
        }
      }
      cacheRef.current.clear();
    };
  }, [resetCurrentSpeechAudio]);

  const playCorrect = useCallback(async (text: string, options?: SpeechOptions) => {
    const spokenText = normalizedSpeechText(text);
    if (!spokenText) return;
    const cacheIdentity = speechCacheIdentity(spokenText, options);
    setError("");

    if (speechAudioRef.current && currentSpeechKeyRef.current === cacheIdentity) {
      setSpeakingText(spokenText);
      setSpeechStatus("playing");
      try {
        await speechAudioRef.current.play();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not play pronunciation.");
        stopCurrentSpeech();
      }
      return;
    }

    playbackRequestRef.current += 1;
    const requestId = playbackRequestRef.current;
    resetCurrentSpeechAudio();
    setSpeakingText(spokenText);
    setSpeechStatus("loading");
    try {
      const speechUrl = await loadSpeechUrl(spokenText, options);
      if (playbackRequestRef.current !== requestId) {
        return;
      }
      const audio = new Audio(speechUrl);
      speechAudioRef.current = audio;
      currentSpeechKeyRef.current = cacheIdentity;
      const clearIfCurrent = () => {
        if (speechAudioRef.current === audio && playbackRequestRef.current === requestId) {
          speechAudioRef.current = null;
          currentSpeechKeyRef.current = "";
          setSpeakingText("");
          setSpeechStatus("idle");
          setSpeechCurrentTime(0);
          setSpeechDuration(0);
        }
      };
      const updateProgress = () => {
        setSpeechCurrentTime(audio.currentTime || 0);
        if (Number.isFinite(audio.duration)) {
          setSpeechDuration(audio.duration || 0);
        }
      };
      audio.onended = clearIfCurrent;
      audio.onerror = clearIfCurrent;
      audio.ondurationchange = updateProgress;
      audio.onloadedmetadata = updateProgress;
      audio.ontimeupdate = updateProgress;
      updateProgress();
      setSpeechStatus("playing");
      await audio.play();
    } catch (err) {
      if (playbackRequestRef.current === requestId) {
        setError(err instanceof Error ? err.message : "Could not play pronunciation.");
        stopCurrentSpeech();
      }
    }
  }, [loadSpeechUrl, resetCurrentSpeechAudio, setError, stopCurrentSpeech]);

  return {
    speakingText,
    speechStatus,
    speechCurrentTime,
    speechDuration,
    preloadSpeech,
    playCorrect,
    pauseCurrentSpeech,
    seekCurrentSpeech,
    skipCurrentSpeech,
    stopCurrentSpeech
  };
}
