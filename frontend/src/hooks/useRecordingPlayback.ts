import { useCallback, useState } from "react";

import type { AudioSeekRequest } from "../components/AudioPlayer";

export function useRecordingPlayback() {
  const [seekRequest, setSeekRequest] = useState<AudioSeekRequest | null>(null);
  const [stopSignal, setStopSignal] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordedAmplitudes, setRecordedAmplitudes] = useState<number[] | null>(null);

  const stopPlayback = useCallback(() => {
    setSeekRequest(null);
    setPlaybackTime(0);
    setStopSignal((signal) => signal + 1);
    setIsPlaying(false);
  }, []);

  const seekTo = useCallback((timeSeconds: number, play: boolean) => {
    setPlaybackTime(timeSeconds);
    setSeekRequest((request) => ({
      id: (request?.id ?? 0) + 1,
      timeSeconds,
      play
    }));
  }, []);

  const resetForNewAudio = useCallback(() => {
    setSeekRequest(null);
    setPlaybackTime(0);
  }, []);

  return {
    seekRequest,
    stopSignal,
    playbackTime,
    setPlaybackTime,
    isPlaying,
    setIsPlaying,
    duration,
    setDuration,
    recordedAmplitudes,
    setRecordedAmplitudes,
    stopPlayback,
    seekTo,
    resetForNewAudio
  };
}
