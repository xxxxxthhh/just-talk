import { useCallback, useEffect, useRef, useState } from "react";
import { speakText, type SpeakTextOptions } from "../api";
import type { SpeechWordBoundary } from "../types";

const SPEECH_CACHE_LIMIT = 30;

type SpeechCacheEntry = {
  url?: string;
  wordBoundaries?: SpeechWordBoundary[];
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

function activeBoundaryIndexAtTime(
  boundaries: SpeechWordBoundary[],
  currentTimeSeconds: number
): number {
  if (!Number.isFinite(currentTimeSeconds)) return -1;
  const currentTimeMs = currentTimeSeconds * 1000;
  const activeIndex = boundaries.findIndex((boundary, index) => {
    const durationEndMs = boundary.audio_offset_ms + Math.max(boundary.duration_ms, 0);
    const nextBoundaryStartMs = boundaries[index + 1]?.audio_offset_ms;
    const endMs = Math.max(durationEndMs, nextBoundaryStartMs ?? durationEndMs);
    return currentTimeMs >= boundary.audio_offset_ms && currentTimeMs < endMs;
  });
  if (activeIndex >= 0) return activeIndex;

  const lastBoundary = boundaries.at(-1);
  if (lastBoundary && currentTimeMs >= lastBoundary.audio_offset_ms) {
    return boundaries.length - 1;
  }
  return -1;
}

export function useSpeech(setError: (msg: string) => void) {
  const [speakingText, setSpeakingText] = useState("");
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const [speechCurrentTime, setSpeechCurrentTime] = useState(0);
  const [speechDuration, setSpeechDuration] = useState(0);
  const [speechWordBoundaries, setSpeechWordBoundaries] = useState<SpeechWordBoundary[]>([]);
  const [activeSpeechBoundaryIndex, setActiveSpeechBoundaryIndex] = useState(-1);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSpeechKeyRef = useRef("");
  const currentSpeechWordBoundariesRef = useRef<SpeechWordBoundary[]>([]);
  const playbackRequestRef = useRef(0);
  const cacheRef = useRef<Map<string, SpeechCacheEntry>>(new Map());

  const resetCurrentSpeechAudio = useCallback(() => {
    if (speechAudioRef.current) {
      speechAudioRef.current.pause();
      speechAudioRef.current.currentTime = 0;
      speechAudioRef.current = null;
    }
    setSpeechCurrentTime(0);
    setActiveSpeechBoundaryIndex(-1);
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
    setActiveSpeechBoundaryIndex(
      activeBoundaryIndexAtTime(currentSpeechWordBoundariesRef.current, audio.currentTime || 0)
    );
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
    setActiveSpeechBoundaryIndex(
      activeBoundaryIndexAtTime(currentSpeechWordBoundariesRef.current, nextTime)
    );
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
          entry.wordBoundaries = response.word_boundaries ?? [];
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
      setSpeechDuration(0);
      setSpeechWordBoundaries([]);
    };
  }, [resetCurrentSpeechAudio]);

  const playCorrect = useCallback(async (
    text: string, 
    options?: SpeechOptions, 
    startAtSeconds?: number,
    startAtPercent?: number
  ) => {
    const spokenText = normalizedSpeechText(text);
    if (!spokenText) return;
    const cacheIdentity = speechCacheIdentity(spokenText, options);
    setError("");

    if (speechAudioRef.current && currentSpeechKeyRef.current === cacheIdentity) {
      setSpeakingText(spokenText);
      setSpeechStatus("playing");
      const duration = speechAudioRef.current.duration || speechDuration;
      let finalSeek = startAtSeconds;
      if (startAtPercent !== undefined && startAtPercent >= 0 && duration > 0) {
        finalSeek = startAtPercent * duration;
      }
      if (finalSeek !== undefined && finalSeek >= 0) {
        speechAudioRef.current.currentTime = finalSeek;
        setSpeechCurrentTime(finalSeek);
        setActiveSpeechBoundaryIndex(
          activeBoundaryIndexAtTime(currentSpeechWordBoundariesRef.current, finalSeek)
        );
      }
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
    
    if (currentSpeechKeyRef.current !== cacheIdentity) {
      setSpeechDuration(0);
      setSpeechWordBoundaries([]);
      currentSpeechKeyRef.current = cacheIdentity;
    }

    resetCurrentSpeechAudio();
    setSpeakingText(spokenText);
    setSpeechStatus("loading");
    try {
      const speechUrl = await loadSpeechUrl(spokenText, options);
      if (playbackRequestRef.current !== requestId) {
        return;
      }
      const audio = new Audio(speechUrl);
      const cacheEntry = cacheRef.current.get(cacheIdentity);
      const wordBoundaries = cacheEntry?.wordBoundaries ?? [];
      speechAudioRef.current = audio;
      currentSpeechWordBoundariesRef.current = wordBoundaries;
      setSpeechWordBoundaries(wordBoundaries);
      const clearIfCurrent = () => {
        if (speechAudioRef.current === audio && playbackRequestRef.current === requestId) {
          speechAudioRef.current = null;
          currentSpeechKeyRef.current = "";
          currentSpeechWordBoundariesRef.current = [];
          setSpeakingText("");
          setSpeechStatus("idle");
          setSpeechCurrentTime(0);
          setSpeechDuration(0);
          setSpeechWordBoundaries([]);
          setActiveSpeechBoundaryIndex(-1);
        }
      };
      const finishIfCurrent = () => {
        if (speechAudioRef.current !== audio || playbackRequestRef.current !== requestId) {
          return;
        }
        const knownDuration = Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : 0;
        const finalTime = knownDuration > 0
          ? knownDuration
          : audio.currentTime || 0;
        if (Number.isFinite(finalTime)) {
          setSpeechCurrentTime(finalTime);
          setActiveSpeechBoundaryIndex(
            activeBoundaryIndexAtTime(currentSpeechWordBoundariesRef.current, finalTime)
          );
        }
        if (knownDuration > 0) {
          setSpeechDuration(knownDuration);
        }
        setSpeechStatus("paused");
      };
      const updateProgress = () => {
        const currentTime = audio.currentTime || 0;
        setSpeechCurrentTime(currentTime);
        setActiveSpeechBoundaryIndex(
          activeBoundaryIndexAtTime(currentSpeechWordBoundariesRef.current, currentTime)
        );
        if (Number.isFinite(audio.duration)) {
          setSpeechDuration(audio.duration || 0);
        }
      };
      audio.onended = finishIfCurrent;
      audio.onerror = clearIfCurrent;
      audio.ondurationchange = updateProgress;
      audio.onloadedmetadata = () => {
        updateProgress();
        const duration = audio.duration || 0;
        let finalSeek = startAtSeconds;
        if (startAtPercent !== undefined && startAtPercent >= 0 && duration > 0) {
          finalSeek = startAtPercent * duration;
        }
        if (finalSeek !== undefined && finalSeek >= 0) {
          audio.currentTime = finalSeek;
          setSpeechCurrentTime(finalSeek);
          setActiveSpeechBoundaryIndex(
            activeBoundaryIndexAtTime(currentSpeechWordBoundariesRef.current, finalSeek)
          );
        }
      };
      audio.ontimeupdate = updateProgress;
      
      updateProgress();
      
      const duration = audio.duration || 0;
      let finalSeek = startAtSeconds;
      if (startAtPercent !== undefined && startAtPercent >= 0 && duration > 0) {
        finalSeek = startAtPercent * duration;
      }
      if (finalSeek !== undefined && finalSeek >= 0) {
        audio.currentTime = finalSeek;
        setSpeechCurrentTime(finalSeek);
      }

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
    speechWordBoundaries,
    activeSpeechBoundaryIndex,
    preloadSpeech,
    playCorrect,
    pauseCurrentSpeech,
    seekCurrentSpeech,
    skipCurrentSpeech,
    stopCurrentSpeech
  };
}
