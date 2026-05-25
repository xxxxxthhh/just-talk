import { useEffect, useRef, useState } from "react";

type AudioPlayerOptions = {
  onPlayStart?: () => void;
  stopSignal?: number;
};

export function useAudioPlayer(audioUrl: string | null, options: AudioPlayerOptions = {}) {
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const lastStopSignalRef = useRef(options.stopSignal);

  useEffect(() => {
    setIsAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, [audioUrl]);

  useEffect(() => {
    if (options.stopSignal === lastStopSignalRef.current) return;
    lastStopSignalRef.current = options.stopSignal;
    if (!audioPlayerRef.current) return;
    audioPlayerRef.current.pause();
    audioPlayerRef.current.currentTime = 0;
    setIsAudioPlaying(false);
    setAudioCurrentTime(0);
  }, [options.stopSignal]);

  function togglePlayAudio() {
    if (!audioPlayerRef.current) return;
    if (isAudioPlaying) {
      audioPlayerRef.current.pause();
    } else {
      options.onPlayStart?.();
      audioPlayerRef.current.play().catch(() => {});
    }
  }

  function handleAudioScrub(val: number) {
    if (!audioPlayerRef.current) return;
    audioPlayerRef.current.currentTime = val;
    setAudioCurrentTime(val);
  }

  return {
    isAudioPlaying,
    audioCurrentTime,
    audioDuration,
    audioPlayerRef,
    togglePlayAudio,
    handleAudioScrub,
    setIsAudioPlaying,
    setAudioCurrentTime,
    setAudioDuration,
  };
}
