import { FastForward, Rewind } from "lucide-react";

import type { SpeechWordBoundary } from "../types";

export type PassageReadAlongPart =
  | { kind: "text"; key: string; text: string }
  | { kind: "word"; boundaryIndex: number; key: string; text: string };

export function buildPassageReadAlongParts(
  text: string,
  boundaries: SpeechWordBoundary[]
): PassageReadAlongPart[] {
  if (!text || boundaries.length === 0) return [];

  const parts: PassageReadAlongPart[] = [];
  let cursor = 0;
  const orderedBoundaries = boundaries
    .map((boundary, index) => ({ boundary, index }))
    .filter(({ boundary }) => boundary.word_length > 0 && boundary.text_offset >= 0)
    .sort((left, right) => left.boundary.text_offset - right.boundary.text_offset);

  for (const { boundary, index } of orderedBoundaries) {
    const start = Math.min(Math.max(Math.floor(boundary.text_offset), 0), text.length);
    const end = Math.min(start + Math.max(Math.floor(boundary.word_length), 0), text.length);
    if (end <= cursor || start < cursor) {
      continue;
    }
    if (start > cursor) {
      parts.push({
        kind: "text",
        key: `text-${cursor}-${start}`,
        text: text.slice(cursor, start)
      });
    }
    parts.push({
      kind: "word",
      boundaryIndex: index,
      key: `word-${index}-${start}`,
      text: text.slice(start, end) || boundary.text
    });
    cursor = end;
  }

  if (cursor < text.length) {
    parts.push({
      kind: "text",
      key: `text-${cursor}-end`,
      text: text.slice(cursor)
    });
  }

  return parts;
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

type PassageAudioControlsProps = {
  currentTime: number;
  duration: number;
  disabled: boolean;
  onSkip: (deltaSeconds: number) => void;
  onSeek: (timeSeconds: number) => void;
};

export function PassageAudioControls({
  currentTime,
  duration,
  disabled,
  onSkip,
  onSeek
}: PassageAudioControlsProps) {
  return (
    <div className="passage-audio-controls">
      <button
        type="button"
        className="passage-audio-step"
        onClick={() => onSkip(-5)}
        aria-label="Back 5 seconds"
        disabled={disabled}
      >
        <Rewind size={15} />
        5s
      </button>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.05}
        value={Math.min(currentTime, duration || 1)}
        onChange={(event) => onSeek(parseFloat(event.target.value))}
        className="passage-audio-slider"
        aria-label="Passage audio progress"
        disabled={disabled}
      />
      <span className="passage-audio-time">
        {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
      </span>
      <button
        type="button"
        className="passage-audio-step"
        onClick={() => onSkip(5)}
        aria-label="Forward 5 seconds"
        disabled={disabled}
      >
        <FastForward size={15} />
        5s
      </button>
    </div>
  );
}

type PassageReadAlongProps = {
  parts: PassageReadAlongPart[];
  activeBoundaryIndex: number;
  onWordClick: (boundaryIndex: number) => void;
};

export function PassageReadAlong({
  parts,
  activeBoundaryIndex,
  onWordClick
}: PassageReadAlongProps) {
  return (
    <div className="passage-read-along" aria-label="Passage read-along">
      {parts.map((part) =>
        part.kind === "word" ? (
          <button
            type="button"
            key={part.key}
            className={`passage-read-word ${
              part.boundaryIndex === activeBoundaryIndex ? "playing" : ""
            }`}
            onClick={() => onWordClick(part.boundaryIndex)}
          >
            {part.text}
          </button>
        ) : (
          <span className="passage-read-text" key={part.key}>
            {part.text}
          </span>
        )
      )}
    </div>
  );
}
