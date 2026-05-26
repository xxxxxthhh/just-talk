import { useEffect, useRef, useState } from "react";

export type AudioSeekRequest = {
  id: number;
  timeSeconds: number;
  play?: boolean;
};

type AudioPlayerOptions = {
  onPlayStart?: () => void;
  onTimeChange?: (currentTime: number) => void;
  seekRequest?: AudioSeekRequest | null;
  stopSignal?: number;
};

export function useAudioPlayer(audioUrl: string | null, options: AudioPlayerOptions = {}) {
  const { onPlayStart, onTimeChange, seekRequest, stopSignal } = options;
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const lastSeekRequestRef = useRef<number | null>(null);
  const lastStopSignalRef = useRef(stopSignal);

  function updateAudioCurrentTime(currentTime: number) {
    setAudioCurrentTime(currentTime);
    onTimeChange?.(currentTime);
  }

  useEffect(() => {
    setIsAudioPlaying(false);
    updateAudioCurrentTime(0);
    setAudioDuration(0);
  }, [audioUrl]);

  useEffect(() => {
    if (stopSignal === lastStopSignalRef.current) return;
    lastStopSignalRef.current = stopSignal;
    if (!audioPlayerRef.current) return;
    audioPlayerRef.current.pause();
    audioPlayerRef.current.currentTime = 0;
    setIsAudioPlaying(false);
    updateAudioCurrentTime(0);
  }, [stopSignal]);

  useEffect(() => {
    if (!seekRequest || seekRequest.id === lastSeekRequestRef.current) return;
    lastSeekRequestRef.current = seekRequest.id;
    const audio = audioPlayerRef.current;
    if (!audio) return;

    const knownDuration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : audioDuration;
    const upperBound = knownDuration > 0 ? knownDuration : seekRequest.timeSeconds;
    const nextTime = Math.max(0, Math.min(seekRequest.timeSeconds, upperBound));
    audio.currentTime = nextTime;
    updateAudioCurrentTime(nextTime);

    if (seekRequest.play) {
      onPlayStart?.();
      audio.play().catch(() => {});
    }
  }, [audioDuration, onPlayStart, seekRequest]);

  function togglePlayAudio() {
    if (!audioPlayerRef.current) return;
    if (isAudioPlaying) {
      audioPlayerRef.current.pause();
    } else {
      onPlayStart?.();
      audioPlayerRef.current.play().catch(() => {});
    }
  }

  function handleAudioScrub(val: number) {
    if (!audioPlayerRef.current) return;
    audioPlayerRef.current.currentTime = val;
    updateAudioCurrentTime(val);
  }

  return {
    isAudioPlaying,
    audioCurrentTime,
    audioDuration,
    audioPlayerRef,
    togglePlayAudio,
    handleAudioScrub,
    setIsAudioPlaying,
    setAudioCurrentTime: updateAudioCurrentTime,
    setAudioDuration,
  };
}
