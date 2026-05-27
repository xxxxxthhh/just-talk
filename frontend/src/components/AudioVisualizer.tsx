import { useEffect, useMemo, useRef } from "react";
import type { MouseEvent } from "react";
import type { ScoreResult } from "../types";

interface AudioVisualizerProps {
  recorderState: "idle" | "recording" | "recorded";
  audioStream: MediaStream | null;
  playbackTime: number;
  playbackDuration: number;
  isAudioPlaying: boolean;
  result: ScoreResult | null;
  recordedAmplitudes: number[] | null;
  onAmplitudesChange?: (amplitudes: number[]) => void;
  onSeek?: (timeSeconds: number) => void;
  maxMs: number; // Maximum recording duration in ms
}

const BAR_COUNT = 40;
const BASELINE_AMPLITUDE = 0.08;
const WAVE_PADDING = 18;
const MOBILE_WAVE_PADDING = 12;
const DEFAULT_BAR_GAP = 4;
const MOBILE_BAR_GAP = 3;
const MIN_BAR_WIDTH = 3;
const MAX_BAR_WIDTH = 12;

// Helper to resample an arbitrary array of numbers to exactly targetCount buckets using peak values
function resample(samples: number[], targetCount: number, baseline: number = BASELINE_AMPLITUDE): number[] {
  if (targetCount <= 0) return [];
  if (samples.length === 0) return Array(targetCount).fill(baseline);
  const resampled = Array(targetCount).fill(baseline);
  const step = samples.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.ceil((i + 1) * step));
    let maxVal = baseline;
    for (let j = start; j < Math.min(end, samples.length); j++) {
      if (samples[j] > maxVal) {
        maxVal = samples[j];
      }
    }
    resampled[i] = maxVal;
  }
  return resampled;
}

function getWaveLayout(width: number) {
  const padding = width < 360 ? MOBILE_WAVE_PADDING : WAVE_PADDING;
  const gap = width < 360 ? MOBILE_BAR_GAP : DEFAULT_BAR_GAP;
  const availableWidth = Math.max(0, width - padding * 2);
  const maxBarsThatFit = Math.max(
    18,
    Math.min(BAR_COUNT, Math.floor((availableWidth + gap) / (MIN_BAR_WIDTH + gap)))
  );
  const barCount = Number.isFinite(maxBarsThatFit) ? maxBarsThatFit : BAR_COUNT;
  const rawBarWidth = (availableWidth - gap * (barCount - 1)) / barCount;
  const barWidth = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, rawBarWidth));
  const visualWidth = barWidth * barCount + gap * (barCount - 1);
  const leftOffset = Math.max(padding, (width - visualWidth) / 2);

  return {
    barCount,
    barWidth,
    gap,
    leftOffset,
    visualWidth,
  };
}

function waveformY(amplitude: number, index: number, height: number, phase: number) {
  const carrier = Math.sin(index * 1.12 + phase) + Math.sin(index * 2.35 + phase * 0.58) * 0.34;
  const normalizedCarrier = Math.max(-1, Math.min(1, carrier / 1.34));
  const maxWaveHeight = height * 0.34;
  return height / 2 - normalizedCarrier * Math.max(amplitude, BASELINE_AMPLITUDE) * maxWaveHeight;
}

function traceWaveformPath(
  ctx: CanvasRenderingContext2D,
  amplitudes: number[],
  layout: ReturnType<typeof getWaveLayout>,
  height: number,
  phase: number,
  startIndex: number,
  endIndex: number
) {
  const start = Math.max(0, startIndex);
  const end = Math.min(amplitudes.length - 1, endIndex);
  if (end < start) return false;

  ctx.beginPath();
  for (let i = start; i <= end; i++) {
    const x = layout.leftOffset + i * (layout.barWidth + layout.gap) + layout.barWidth / 2;
    const y = waveformY(amplitudes[i], i, height, phase);
    if (i === start) {
      ctx.moveTo(x, y);
    } else {
      const previousX = layout.leftOffset + (i - 1) * (layout.barWidth + layout.gap) + layout.barWidth / 2;
      const previousY = waveformY(amplitudes[i - 1], i - 1, height, phase);
      ctx.quadraticCurveTo((previousX + x) / 2, previousY, x, y);
    }
  }
  return true;
}

export function AudioVisualizer({
  recorderState,
  audioStream,
  playbackTime,
  playbackDuration,
  isAudioPlaying,
  result,
  recordedAmplitudes,
  onAmplitudesChange,
  onSeek,
  maxMs,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const smoothedVolumeRef = useRef(BASELINE_AMPLITUDE);
  const playbackProgressRef = useRef(0);

  // Buffer to collect raw volume samples at high resolution during active recording
  const rawSamplesRef = useRef<number[]>([]);
  const lastStateRef = useRef<string>(recorderState);

  const recordingStartRef = useRef<number>(0);

  // Generate or retrieve wave amplitudes for "recorded" view
  const staticAmplitudes = useMemo(() => {
    if (recorderState !== "recorded") return null;

    // 1. If we have the live recorded amplitudes, use them!
    if (recordedAmplitudes && recordedAmplitudes.length === BAR_COUNT) {
      return recordedAmplitudes;
    }

    // 2. Fallback: Generate smart word-aligned pseudo-waveform from AI result
    const duration = playbackDuration || (maxMs / 1000);
    const generated = Array(BAR_COUNT).fill(BASELINE_AMPLITUDE);

    if (result?.words && result.words.length > 0) {
      for (let i = 0; i < BAR_COUNT; i++) {
        const timeSec = (i / BAR_COUNT) * duration;
        const timeMs = timeSec * 1000;

        // Find if this time falls inside any word token's offset & duration
        const matchingWord = result.words.find((word) => {
          const start = word.offset_ms;
          const end = word.offset_ms + Math.max(word.duration_ms, 150);
          return timeMs >= start && timeMs <= end;
        });

        if (matchingWord) {
          // Speak peak: create a nice, natural wavy height based on the word index
          // but deterministically pseudo-random so it doesn't shift
          const wordHash = matchingWord.word.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const pseudoRandomHeight = 0.45 + (wordHash % 5) * 0.1; // 0.45 to 0.85
          generated[i] = pseudoRandomHeight;
        } else {
          // Check if it's very close to any word to add a gentle slope
          const isNearWord = result.words.some((word) => {
            const startDist = Math.abs(word.offset_ms - timeMs);
            const endDist = Math.abs((word.offset_ms + word.duration_ms) - timeMs);
            return startDist < 100 || endDist < 100;
          });
          generated[i] = isNearWord ? 0.22 : BASELINE_AMPLITUDE;
        }
      }
      return generated;
    }

    // 3. Fallback fallback: a beautiful natural symmetric speech wave
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = (i / BAR_COUNT) * Math.PI * 4;
      const wave = Math.sin(x) * Math.cos(x * 0.5);
      generated[i] = 0.15 + Math.max(0, wave) * 0.65;
    }
    return generated;
  }, [recorderState, recordedAmplitudes, result, playbackDuration, maxMs]);

  // Hook to handle recording-to-recorded transition and bubble up resampled waveform
  useEffect(() => {
    if (lastStateRef.current === "recording" && recorderState === "recorded") {
      if (rawSamplesRef.current.length > 0) {
        onAmplitudesChange?.(resample(rawSamplesRef.current, BAR_COUNT));
      }
    }
    lastStateRef.current = recorderState;
  }, [recorderState, onAmplitudesChange]);

  // Set up Web Audio API when recording stream is available
  useEffect(() => {
    if (recorderState === "recording" && audioStream) {
      rawSamplesRef.current = []; // Reset raw samples buffer
      smoothedVolumeRef.current = BASELINE_AMPLITUDE;
      recordingStartRef.current = Date.now();

      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;

        const source = ctx.createMediaStreamSource(audioStream);
        source.connect(analyser);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;
        sourceRef.current = source;
      } catch (err) {
        console.error("Failed to initialize AudioContext", err);
      }
    }

    return () => {
      // Cleanup Web Audio API resources
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (audioContextRef.current) {
        if (audioContextRef.current.state !== "closed") {
          audioContextRef.current.close().catch(() => {});
        }
        audioContextRef.current = null;
      }
      analyserRef.current = null;
    };
  }, [recorderState, audioStream]);

  // Main drawing & analysis loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI displays for crisp drawing
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    let activeAmplitudes = Array(BAR_COUNT).fill(BASELINE_AMPLITUDE);
    const dataArray = analyserRef.current
      ? new Uint8Array(analyserRef.current.frequencyBinCount)
      : null;

    const tick = () => {
      if (!ctx || !canvas) return;

      const width = rect.width;
      const height = rect.height;
      const layout = getWaveLayout(width);

      // Clear the canvas
      ctx.clearRect(0, 0, width, height);

      if (recorderState === "recording" && analyserRef.current && dataArray) {
        // 1. Live Recording Analysis
        analyserRef.current.getByteTimeDomainData(dataArray);

        // Calculate root-mean-square (RMS) volume
        let sumSquaredDeviations = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const deviation = dataArray[i] - 128;
          sumSquaredDeviations += deviation * deviation;
        }
        const rms = Math.sqrt(sumSquaredDeviations / dataArray.length);

        // Normalize live volume (sensitivity factor around 35)
        const targetVolume = Math.min(rms / 35, 1.0);
        smoothedVolumeRef.current += (targetVolume - smoothedVolumeRef.current) * 0.32;
        const currentVolume = Math.max(smoothedVolumeRef.current, BASELINE_AMPLITUDE);

        // Buffer the volume sample
        rawSamplesRef.current.push(currentVolume);

        // Calculate recording progress index
        const elapsed = Date.now() - recordingStartRef.current;
        const progress = Math.min(elapsed / maxMs, 1.0);
        const progressIndex = Math.floor(progress * (BAR_COUNT - 1));

        // Resample what we recorded so far to the active portion of the bars
        const activeBarCount = Math.max(1, progressIndex);
        const recordedPart = resample(rawSamplesRef.current, activeBarCount);

        // Lock in previous volume bars, write to active index, and preview future bars
        for (let i = 0; i < BAR_COUNT; i++) {
          if (i < progressIndex) {
            activeAmplitudes[i] = recordedPart[i];
          } else if (i === progressIndex) {
            activeAmplitudes[i] = Math.max(currentVolume, BASELINE_AMPLITUDE);
          } else {
            const futurePulse = Math.max(0, Math.sin(elapsed * 0.008 + i * 0.72)) * 0.025;
            activeAmplitudes[i] = BASELINE_AMPLITUDE + futurePulse + currentVolume * 0.05;
          }
        }
      } else if (recorderState === "recorded" && staticAmplitudes) {
        // 2. Playback / Static Waveform view
        activeAmplitudes = staticAmplitudes;
      } else {
        // 3. Idle / Listening State
        const time = Date.now() * 0.0018;
        const middle = (BAR_COUNT - 1) / 2;
        for (let i = 0; i < BAR_COUNT; i++) {
          const distanceFromCenter = Math.abs(i - middle) / middle;
          const centerWeight = 1 - distanceFromCenter;
          const breath = (Math.sin(time + i * 0.42) + 1) / 2;
          activeAmplitudes[i] = BASELINE_AMPLITUDE + centerWeight * 0.035 + breath * 0.04;
        }
      }

      const drawAmplitudes =
        layout.barCount === BAR_COUNT ? activeAmplitudes : resample(activeAmplitudes, layout.barCount);

      // Determine playback progress highlight
      let playbackProgress = -1;
      if (recorderState === "recorded" && playbackDuration > 0) {
        const targetProgress = Math.max(0, Math.min(playbackTime / playbackDuration, 1.0));
        if (isAudioPlaying) {
          playbackProgressRef.current += (targetProgress - playbackProgressRef.current) * 0.22;
        } else {
          playbackProgressRef.current = targetProgress;
        }
        playbackProgress = playbackProgressRef.current;
      }

      const phase =
        recorderState === "recorded" && !isAudioPlaying
          ? 0.45
          : Date.now() * (recorderState === "idle" ? 0.0011 : 0.0035);
      let activeEndIndex = -1;
      if (recorderState === "recording") {
        const elapsed = Date.now() - recordingStartRef.current;
        const progress = Math.min(elapsed / maxMs, 1.0);
        activeEndIndex = Math.floor(progress * (layout.barCount - 1));
      } else if (recorderState === "recorded" && playbackProgress >= 0) {
        activeEndIndex = Math.floor(playbackProgress * (layout.barCount - 1));
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.moveTo(layout.leftOffset, height / 2);
      ctx.lineTo(layout.leftOffset + layout.visualWidth, height / 2);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.1)";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (traceWaveformPath(ctx, drawAmplitudes, layout, height, phase, 0, layout.barCount - 1)) {
        ctx.strokeStyle = recorderState === "idle" ? "rgba(148, 163, 184, 0.34)" : "rgba(148, 163, 184, 0.24)";
        ctx.lineWidth = recorderState === "idle" ? 1.4 : 1.6;
        ctx.stroke();
      }

      if (activeEndIndex > 0) {
        const gradient = ctx.createLinearGradient(layout.leftOffset, 0, layout.leftOffset + layout.visualWidth, 0);
        gradient.addColorStop(0, "#34d399");
        gradient.addColorStop(1, "#3b82f6");

        ctx.shadowColor = "rgba(59, 130, 246, 0.28)";
        ctx.shadowBlur = recorderState === "recording" || isAudioPlaying ? 6 : 0;
        if (traceWaveformPath(ctx, drawAmplitudes, layout, height, phase, 0, activeEndIndex)) {
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 2.2;
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      // Draw cursor scrubber line during playback
      if (recorderState === "recorded" && playbackProgress >= 0 && playbackDuration > 0) {
        const cursorX = layout.leftOffset + playbackProgress * layout.visualWidth;

        if (isAudioPlaying) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = "rgba(59, 130, 246, 0.45)";
          ctx.beginPath();
          ctx.arc(cursorX, height / 2, 9, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
          ctx.fill();
        }

        ctx.shadowBlur = 6;
        ctx.shadowColor = "#3b82f6";
        ctx.beginPath();
        ctx.arc(cursorX, height / 2, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#3b82f6";
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow
      }

      if (recorderState !== "recorded" || isAudioPlaying) {
        animationFrameIdRef.current = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [recorderState, staticAmplitudes, playbackTime, playbackDuration, isAudioPlaying, maxMs]);

  // Handle canvas click for interactive seeking (scrubbing)
  const handleCanvasClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (recorderState !== "recorded" || playbackDuration <= 0 || !onSeek) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const layout = getWaveLayout(width);

    const clickXRelative = clickX - layout.leftOffset;
    const percent = Math.max(0, Math.min(clickXRelative / layout.visualWidth, 1.0));

    const seekTime = percent * playbackDuration;
    onSeek(seekTime);
  };

  return (
    <div className="wave-container-visualizer">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{
          width: "100%",
          height: "80px",
          display: "block",
          cursor: recorderState === "recorded" ? "pointer" : "default",
        }}
        aria-label="Recording waveform"
        title={recorderState === "recorded" ? "Click to scrub playback position" : undefined}
      />
    </div>
  );
}
