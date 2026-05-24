import { useEffect, useRef, useState } from "react";

export function useAudioPlayer(audioUrl: string | null) {
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setIsAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, [audioUrl]);

  function togglePlayAudio() {
    if (!audioPlayerRef.current) return;
    if (isAudioPlaying) {
      audioPlayerRef.current.pause();
    } else {
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
