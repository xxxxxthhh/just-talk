import { useEffect } from "react";
import { Play, Square } from "lucide-react";
import { useAudioPlayer, type AudioSeekRequest } from "../hooks/useAudioPlayer";

export type { AudioSeekRequest };

function formatAudioTime(secs: number): string {
  if (isNaN(secs) || !isFinite(secs)) return "0:00";
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  audioUrl,
  onPlayStart,
  onTimeChange,
  seekRequest,
  stopSignal,
  onIsPlayingChange,
  onDurationChange,
}: {
  audioUrl: string;
  onPlayStart?: () => void;
  onTimeChange?: (currentTime: number) => void;
  seekRequest?: AudioSeekRequest | null;
  stopSignal?: number;
  onIsPlayingChange?: (isPlaying: boolean) => void;
  onDurationChange?: (duration: number) => void;
}) {
  const {
    isAudioPlaying,
    audioCurrentTime,
    audioDuration,
    audioPlayerRef,
    togglePlayAudio,
    handleAudioScrub,
    setIsAudioPlaying,
    setAudioCurrentTime,
    setAudioDuration,
  } = useAudioPlayer(audioUrl, { onPlayStart, onTimeChange, seekRequest, stopSignal });

  useEffect(() => {
    onIsPlayingChange?.(isAudioPlaying);
  }, [isAudioPlaying, onIsPlayingChange]);

  useEffect(() => {
    onDurationChange?.(audioDuration);
  }, [audioDuration, onDurationChange]);

  return (
    <div className="custom-audio-player">
      <button
        type="button"
        className="audio-play-button"
        onClick={togglePlayAudio}
        title={isAudioPlaying ? "Pause recording" : "Play recording"}
      >
        {isAudioPlaying ? (
          <Square size={12} fill="currentColor" />
        ) : (
          <Play size={12} fill="currentColor" />
        )}
      </button>
      <input
        type="range"
        min={0}
        max={audioDuration || 1}
        step={0.05}
        value={audioCurrentTime}
        onChange={(e) => handleAudioScrub(parseFloat(e.target.value))}
        className="audio-slider"
        aria-label="Audio progress slider"
      />
      <span className="audio-time-label">
        {formatAudioTime(audioCurrentTime)} / {formatAudioTime(audioDuration)}
      </span>
      <audio
        ref={audioPlayerRef}
        src={audioUrl}
        style={{ display: "none" }}
        onPlay={() => setIsAudioPlaying(true)}
        onPause={() => setIsAudioPlaying(false)}
        onTimeUpdate={(e) => setAudioCurrentTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setAudioDuration(e.currentTarget.duration || 0)}
        onEnded={() => setIsAudioPlaying(false)}
      />
    </div>
  );
}
