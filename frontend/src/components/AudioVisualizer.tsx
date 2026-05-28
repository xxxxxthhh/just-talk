import { useEffect, useMemo, useRef } from "react";
import type { MouseEvent } from "react";
import type { ScoreResult } from "../types";

interface AudioVisualizerProps {
  recorderState: "idle" | "recording" | "recorded";
  audioStream: MediaStream | null;
  playbackTime: number;
  playbackDuration: number;
  isAudioPlaying: boolean;
  activeTrack?: "coach" | "user" | null;
  coachBoundaries?: any[] | null;
  coachDuration?: number;
  userDuration?: number;
  coachCurrentTime?: number;
  userCurrentTime?: number;
  result: ScoreResult | null;
  recordedAmplitudes: number[] | null;
  onAmplitudesChange?: (amplitudes: number[]) => void;
  onSeek?: (timeSeconds: number) => void;
  onTrackClick?: (track: "coach" | "user", timeSeconds: number, percent?: number) => void;
  maxMs: number; // Maximum recording duration in ms
}

const BAR_COUNT = 45; // Increased slightly for high-density premium look
const BASELINE_AMPLITUDE = 0.08;
const WAVE_PADDING = 18;
const MOBILE_WAVE_PADDING = 12;
const DEFAULT_BAR_GAP = 3.5;
const MOBILE_BAR_GAP = 2.5;
const MIN_BAR_WIDTH = 3;
const MAX_BAR_WIDTH = 10;

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

function getWaveLayout(width: number, isDualMode: boolean = false) {
  const padding = width < 360 ? MOBILE_WAVE_PADDING : WAVE_PADDING;
  const leftPadding = isDualMode ? 55 : padding;
  const rightPadding = padding;
  const gap = width < 360 ? MOBILE_BAR_GAP : DEFAULT_BAR_GAP;
  const availableWidth = Math.max(0, width - leftPadding - rightPadding);
  const maxBarsThatFit = Math.max(
    18,
    Math.min(BAR_COUNT, Math.floor((availableWidth + gap) / (MIN_BAR_WIDTH + gap)))
  );
  const barCount = Number.isFinite(maxBarsThatFit) ? maxBarsThatFit : BAR_COUNT;
  const rawBarWidth = (availableWidth - gap * (barCount - 1)) / barCount;
  const barWidth = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, rawBarWidth));
  const visualWidth = barWidth * barCount + gap * (barCount - 1);
  const leftOffset = leftPadding + Math.max(0, (availableWidth - visualWidth) / 2);

  return {
    barCount,
    barWidth,
    gap,
    leftOffset,
    visualWidth,
  };
}

export function AudioVisualizer({
  recorderState,
  audioStream,
  playbackTime,
  playbackDuration,
  isAudioPlaying,
  activeTrack,
  coachBoundaries,
  coachDuration,
  userDuration,
  coachCurrentTime = 0,
  userCurrentTime = 0,
  result,
  recordedAmplitudes,
  onAmplitudesChange,
  onSeek,
  onTrackClick,
  maxMs,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const smoothedVolumeRef = useRef(BASELINE_AMPLITUDE);
  const playbackProgressRef = useRef(0);

  const isDualMode = recorderState === "recorded" && result !== null;

  // Buffer to collect raw volume samples at high resolution during active recording
  const rawSamplesRef = useRef<number[]>([]);
  const lastStateRef = useRef<string>(recorderState);
  const recordingStartRef = useRef<number>(0);

  // Coach standard word-aligned pseudo-waveform (synchronized exactly to Coach audio timeline)
  const coachAmplitudes = useMemo(() => {
    const lastBoundary = coachBoundaries?.at(-1);
    const estimatedDuration = lastBoundary 
      ? (lastBoundary.audio_offset_ms + lastBoundary.duration_ms) / 1000
      : 0;
    const duration = coachDuration || estimatedDuration || playbackDuration || (maxMs / 1000) || 1;
    const generated = Array(BAR_COUNT).fill(BASELINE_AMPLITUDE);

    if (coachBoundaries && coachBoundaries.length > 0) {
      for (let i = 0; i < BAR_COUNT; i++) {
        const timeSec = (i / BAR_COUNT) * duration;
        const timeMs = timeSec * 1000;

        // Find if this time falls inside any Coach word boundary's offset
        const matchingBoundary = coachBoundaries.find((boundary, index) => {
          const start = boundary.audio_offset_ms;
          const nextBoundary = coachBoundaries[index + 1];
          const end = nextBoundary 
            ? Math.min(nextBoundary.audio_offset_ms, start + 450)
            : start + 450;
          return timeMs >= start && timeMs <= end;
        });

        if (matchingBoundary) {
          const wordHash = matchingBoundary.text.split("").reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
          const pseudoRandomHeight = 0.45 + (wordHash % 5) * 0.1; // 0.45 to 0.85
          generated[i] = pseudoRandomHeight;
        } else {
          // Check near boundaries for smooth slopes
          const isNear = coachBoundaries.some((boundary, index) => {
            const start = boundary.audio_offset_ms;
            const nextBoundary = coachBoundaries[index + 1];
            const end = nextBoundary 
              ? Math.min(nextBoundary.audio_offset_ms, start + 450)
              : start + 450;
            const startDist = Math.abs(start - timeMs);
            const endDist = Math.abs(end - timeMs);
            return startDist < 80 || endDist < 80;
          });
          generated[i] = isNear ? 0.22 : BASELINE_AMPLITUDE;
        }
      }
      return generated;
    }
    
    // Fallback: symmetric speech wave
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = (i / BAR_COUNT) * Math.PI * 4;
      const wave = Math.sin(x) * Math.cos(x * 0.5);
      generated[i] = 0.15 + Math.max(0, wave) * 0.65;
    }
    return generated;
  }, [coachBoundaries, coachDuration]);


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

  const transitionEndTimeRef = useRef(0);

  // Trigger continuous rendering during layout/CSS state transitions
  useEffect(() => {
    transitionEndTimeRef.current = Date.now() + 600;
  }, [recorderState, result, isAudioPlaying]);

  // Main drawing & analysis loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let activeAmplitudes = Array(BAR_COUNT).fill(BASELINE_AMPLITUDE);
    const dataArray = analyserRef.current
      ? new Uint8Array(analyserRef.current.frequencyBinCount)
      : null;

    const tick = () => {
      if (!ctx || !canvas) return;

      // Handle high DPI displays for crisp drawing and dynamic resizing (e.g. CSS transitions)
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.floor(rect.width * dpr);
      const targetHeight = Math.floor(rect.height * dpr);
      
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        ctx.scale(dpr, dpr);
      }

      const width = rect.width;
      const height = rect.height;
      
      const isDualMode = recorderState === "recorded" && result !== null;
      const layout = getWaveLayout(width, isDualMode);

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

        // Normalize live volume
        const targetVolume = Math.min(rms / 35, 1.0);
        smoothedVolumeRef.current += (targetVolume - smoothedVolumeRef.current) * 0.32;
        const currentVolume = Math.max(smoothedVolumeRef.current, BASELINE_AMPLITUDE);

        // Buffer the volume sample
        rawSamplesRef.current.push(currentVolume);

        // Calculate recording progress index
        const elapsed = Date.now() - recordingStartRef.current;
        const progress = Math.min(elapsed / maxMs, 1.0);
        const progressIndex = Math.floor(progress * (BAR_COUNT - 1));

        // Resample what we recorded so far
        const activeBarCount = Math.max(1, progressIndex);
        const recordedPart = resample(rawSamplesRef.current, activeBarCount);

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
      } else if (recorderState === "recorded") {
        // 2. Playback / Static view
        if (recordedAmplitudes && recordedAmplitudes.length === BAR_COUNT) {
          activeAmplitudes = recordedAmplitudes;
        } else {
          // Fallback static wave
          for (let i = 0; i < BAR_COUNT; i++) {
            const x = (i / BAR_COUNT) * Math.PI * 4;
            const wave = Math.sin(x) * Math.cos(x * 0.5);
            activeAmplitudes[i] = 0.15 + Math.max(0, wave) * 0.65;
          }
        }
      } else {
        // 3. Idle / Listening State (gentle breathing wave)
        const time = Date.now() * 0.0018;
        const middle = (BAR_COUNT - 1) / 2;
        for (let i = 0; i < BAR_COUNT; i++) {
          const distanceFromCenter = Math.abs(i - middle) / middle;
          const centerWeight = 1 - distanceFromCenter;
          const breath = (Math.sin(time + i * 0.42) + 1) / 2;
          activeAmplitudes[i] = BASELINE_AMPLITUDE + centerWeight * 0.035 + breath * 0.04;
        }
      }

      const drawUserAmplitudes =
        layout.barCount === BAR_COUNT ? activeAmplitudes : resample(activeAmplitudes, layout.barCount);
      const drawCoachAmplitudes =
        layout.barCount === BAR_COUNT ? coachAmplitudes : resample(coachAmplitudes, layout.barCount);

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

      let activeEndIndex = -1;
      if (recorderState === "recording") {
        const elapsed = Date.now() - recordingStartRef.current;
        const progress = Math.min(elapsed / maxMs, 1.0);
        activeEndIndex = Math.floor(progress * (layout.barCount - 1));
      } else if (recorderState === "recorded" && playbackProgress >= 0) {
        activeEndIndex = Math.floor(playbackProgress * (layout.barCount - 1));
      }

      ctx.lineCap = "round";

      if (isDualMode) {
        // ================= DUAL WAVEFORM MODE (COACH vs YOU) =================
        const coachCenterY = height * 0.28;
        const userCenterY = height * 0.72;
        const maxBarHeight = height * 0.36;

        // Draw center dividing rule
        ctx.beginPath();
        ctx.moveTo(layout.leftOffset, height / 2);
        ctx.lineTo(layout.leftOffset + layout.visualWidth, height / 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // 1. Draw Labels (COACH and YOU) within the reserved left margin
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "800 10px var(--font-display)";
        ctx.fillText("COACH", 10, coachCenterY + 3.5);
        ctx.fillText("YOU", 10, userCenterY + 3.5);

        // 2. Draw Top Wave (Coach Standard Pronunciation Wave)
        const coachGrad = ctx.createLinearGradient(layout.leftOffset, 0, layout.leftOffset + layout.visualWidth, 0);
        coachGrad.addColorStop(0, "#a78bfa"); // Purple
        coachGrad.addColorStop(1, "#ec4899"); // Pink

        for (let i = 0; i < layout.barCount; i++) {
          const x = layout.leftOffset + i * (layout.barWidth + layout.gap) + layout.barWidth / 2;
          const amplitude = drawCoachAmplitudes[i];
          const barHalfHeight = Math.max(1.5, amplitude * maxBarHeight * 0.5);

          ctx.beginPath();
          ctx.moveTo(x, coachCenterY - barHalfHeight);
          ctx.lineTo(x, coachCenterY + barHalfHeight);
          ctx.lineWidth = layout.barWidth;

          // Highlight matching progress segment
          if (playbackProgress >= 0 && i <= activeEndIndex) {
            ctx.strokeStyle = coachGrad;
          } else {
            ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
          }
          ctx.stroke();
        }

        // 3. Draw Bottom Wave (Your Voice Recording)
        const userScore = result?.scores?.pronunciation ?? 80;
        const isGood = userScore >= 80;
        const isNeedsWork = userScore < 60;
        const userGrad = ctx.createLinearGradient(layout.leftOffset, 0, layout.leftOffset + layout.visualWidth, 0);

        if (isGood) {
          userGrad.addColorStop(0, "#10b981"); // Gorgeous Mint Green
          userGrad.addColorStop(1, "#34d399");
        } else if (isNeedsWork) {
          userGrad.addColorStop(0, "#f87171"); // Neon Amber/Coral
          userGrad.addColorStop(1, "#ef4444");
        } else {
          userGrad.addColorStop(0, "#fbbf24"); // Yellow Warning
          userGrad.addColorStop(1, "#f59e0b");
        }

        for (let i = 0; i < layout.barCount; i++) {
          const x = layout.leftOffset + i * (layout.barWidth + layout.gap) + layout.barWidth / 2;
          const amplitude = drawUserAmplitudes[i];
          const barHalfHeight = Math.max(1.5, amplitude * maxBarHeight * 0.5);

          ctx.beginPath();
          ctx.moveTo(x, userCenterY - barHalfHeight);
          ctx.lineTo(x, userCenterY + barHalfHeight);
          ctx.lineWidth = layout.barWidth;

          if (playbackProgress >= 0 && i <= activeEndIndex) {
            ctx.strokeStyle = userGrad;
          } else {
            ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
          }
          ctx.stroke();
        }

      } else {
        // ================= SINGLE WAVEFORM MODE (Idle/Recording/Standard) =================
        const centerY = height / 2;
        const maxBarHeight = height * 0.72;

        const defaultGrad = ctx.createLinearGradient(layout.leftOffset, 0, layout.leftOffset + layout.visualWidth, 0);
        defaultGrad.addColorStop(0, "#6366f1"); // Modern Indigo accent
        defaultGrad.addColorStop(1, "#db2777"); // Pink hover accent

        for (let i = 0; i < layout.barCount; i++) {
          const x = layout.leftOffset + i * (layout.barWidth + layout.gap) + layout.barWidth / 2;
          const amplitude = drawUserAmplitudes[i];
          const barHalfHeight = Math.max(2, amplitude * maxBarHeight * 0.5);

          ctx.beginPath();
          ctx.moveTo(x, centerY - barHalfHeight);
          ctx.lineTo(x, centerY + barHalfHeight);
          ctx.lineWidth = layout.barWidth;

          if (recorderState === "recording" && i <= activeEndIndex) {
            // Pulse active recording in crimson/red
            ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
          } else if (playbackProgress >= 0 && i <= activeEndIndex) {
            ctx.strokeStyle = defaultGrad;
          } else {
            ctx.strokeStyle = recorderState === "idle" ? "rgba(148, 163, 184, 0.35)" : "rgba(148, 163, 184, 0.22)";
          }
          ctx.stroke();
        }
      }

      // Draw cursor scrubber line during playback (runs through entire height)
      if (recorderState === "recorded" && playbackProgress >= 0 && playbackDuration > 0) {
        const cursorX = layout.leftOffset + playbackProgress * layout.visualWidth;

        const coachCenterY = height * 0.28;
        const userCenterY = height * 0.72;
        const scrubberY = isDualMode
          ? (activeTrack === "coach" ? coachCenterY : userCenterY)
          : height / 2;

        // Draw vertical overlay guideline
        ctx.beginPath();
        ctx.moveTo(cursorX, 4);
        ctx.lineTo(cursorX, height - 4);
        ctx.strokeStyle = "rgba(167, 139, 250, 0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();

        if (isAudioPlaying) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = "rgba(167, 139, 250, 0.55)";
          ctx.beginPath();
          ctx.arc(cursorX, scrubberY, 8, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(167, 139, 250, 0.15)";
          ctx.fill();
        }

        ctx.shadowBlur = 4;
        ctx.shadowColor = "#a78bfa";
        ctx.beginPath();
        ctx.arc(cursorX, scrubberY, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#a78bfa";
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow
      }

      const isTransitioning = Date.now() < transitionEndTimeRef.current;
      if (recorderState !== "recorded" || isAudioPlaying || isTransitioning) {
        animationFrameIdRef.current = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [recorderState, recordedAmplitudes, coachAmplitudes, playbackTime, playbackDuration, isAudioPlaying, maxMs, result]);

  // Handle canvas click for interactive seeking (scrubbing) and track switching
  const handleCanvasClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (recorderState !== "recorded") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top; // Track vertical Y coordinate
    const width = rect.width;
    const height = rect.height;

    const isDualMode = recorderState === "recorded" && result !== null;
    const layout = getWaveLayout(width, isDualMode);

    const clickXRelative = clickX - layout.leftOffset;
    const percent = Math.max(0, Math.min(clickXRelative / layout.visualWidth, 1.0));

    if (isDualMode && onTrackClick) {
      const clickedTrack = clickY < height / 2 ? "coach" : "user";
      const lastBoundary = coachBoundaries?.at(-1);
      const estimatedCoachDuration = lastBoundary 
        ? (lastBoundary.audio_offset_ms + lastBoundary.duration_ms) / 1000
        : 0;
      const trackDuration = clickedTrack === "coach"
        ? (coachDuration && coachDuration > 0 ? coachDuration : (estimatedCoachDuration || playbackDuration))
        : (userDuration && userDuration > 0 ? userDuration : playbackDuration);
      const seekTime = percent * (trackDuration || (maxMs / 1000));
      onTrackClick(clickedTrack, seekTime, percent);
    } else if (onSeek) {
      const duration = playbackDuration || (maxMs / 1000);
      const seekTime = percent * duration;
      onSeek(seekTime);
    }
  };

  const handleSliderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, track: "coach" | "user") => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const targetTime = track === "coach" ? coachCurrentTime : userCurrentTime;
      const targetDur = track === "coach" ? finalCoachDuration : finalUserDuration;
      const percent = targetDur > 0 ? targetTime / targetDur : 0;
      onTrackClick?.(track, targetTime, percent);
    }
  };

  // HTML5 Semantic Accessibility Controls (Visually Hidden)
  const lastBoundary = coachBoundaries?.at(-1);
  const estimatedCoachDuration = lastBoundary 
    ? (lastBoundary.audio_offset_ms + lastBoundary.duration_ms) / 1000
    : 0;
  const finalCoachDuration = coachDuration || estimatedCoachDuration || (maxMs / 1000) || 1;
  const finalUserDuration = userDuration || playbackDuration;

  return (
    <div className="wave-container-visualizer">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{
          width: "100%",
          height: recorderState === "recorded" && result !== null ? "130px" : "80px", // Expanded elegantly to 130px
          display: "block",
          cursor: recorderState === "recorded" ? "pointer" : "default",
          transition: "height 0.4s cubic-bezier(0.4, 0, 0.2, 1)", // Gorgeous smooth slide-down when result loads!
        }}
        aria-hidden="true" // Canvas is pure visual feedback; accessibility is driven by semantic inputs below
        title={recorderState === "recorded" ? "Click to scrub playback position" : undefined}
      />
      
      {recorderState === "recorded" && (
        <div className="visually-hidden">
          {isDualMode ? (
            <>
              <input
                type="range"
                min={0}
                max={finalCoachDuration}
                step={0.01}
                value={coachCurrentTime}
                aria-label="Coach standard accent playback position slider"
                aria-valuemin={0}
                aria-valuemax={finalCoachDuration}
                aria-valuenow={coachCurrentTime}
                aria-valuetext={`Coach track. Playback at ${coachCurrentTime.toFixed(1)}s of ${finalCoachDuration.toFixed(1)}s.`}
                onKeyDown={(e) => handleSliderKeyDown(e, "coach")}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  const pct = finalCoachDuration > 0 ? val / finalCoachDuration : 0;
                  onTrackClick?.("coach", val, pct);
                }}
              />
              <input
                type="range"
                min={0}
                max={finalUserDuration}
                step={0.01}
                value={userCurrentTime}
                aria-label="Your recorded accent playback position slider"
                aria-valuemin={0}
                aria-valuemax={finalUserDuration}
                aria-valuenow={userCurrentTime}
                aria-valuetext={`Your track. Playback at ${userCurrentTime.toFixed(1)}s of ${finalUserDuration.toFixed(1)}s.`}
                onKeyDown={(e) => handleSliderKeyDown(e, "user")}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  const pct = finalUserDuration > 0 ? val / finalUserDuration : 0;
                  onTrackClick?.("user", val, pct);
                }}
              />
            </>
          ) : (
            <input
              type="range"
              min={0}
              max={playbackDuration || 1}
              step={0.01}
              value={playbackTime}
              aria-label="Recorded voice playback position slider"
              aria-valuemin={0}
              aria-valuemax={playbackDuration || 1}
              aria-valuenow={playbackTime}
              aria-valuetext={`Recorded track. Playback at ${playbackTime.toFixed(1)}s of ${playbackDuration.toFixed(1)}s.`}
              onChange={(e) => {
                onSeek?.(parseFloat(e.target.value));
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
