import { useEffect, useRef, useState } from "react";

import type { CaptureStopReason } from "../types";

export type RecorderState = "idle" | "recording" | "recorded";

// The first accepted stop of one capture, timed on its own monotonic clock from recorder.start().
export type CaptureStop = Readonly<{ reason: CaptureStopReason; durationMs: number }>;
// discarded is true when the capture was abandoned with discardRecording. Ordinary callers ignore stop.
export type RecordingReady = (blob: Blob, discarded: boolean, stop: CaptureStop) => void;
// Optional analysis hooks; a throwing hook never affects the recording. onRelease runs once, after
// the capture's microphone tracks have stopped.
export type CaptureHooks = {
  onStream?: (stream: MediaStream) => void;
  onStart?: (startedAt: number) => void;
  onStop?: (stop: CaptureStop) => void;
  onRelease?: () => void;
};

type UseRecorderOptions = {
  maxMs: number;
  onUnsupported: () => void;
  onRecordingReady: RecordingReady;
};

type Capture = {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  startedAt: number;
  stop: CaptureStop | null;
  discardReason: CaptureStopReason | null;
  hooks: CaptureHooks;
  timer: number | null;
  released: boolean;
};

function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function callHook(hook: () => void) {
  try {
    hook();
  } catch {
    // Analysis is optional; the take continues without it.
  }
}

export function useRecorder({ maxMs, onUnsupported, onRecordingReady }: UseRecorderOptions) {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const capturesRef = useRef(new WeakMap<MediaRecorder, Capture>());
  // Captures still holding the microphone, released on stop, setup failure, or unmount.
  const liveCapturesRef = useRef(new Set<Capture>());
  // Bumped by every start, discard, and unmount: a permission request that resolves after its
  // number moved on is obsolete and must not touch the recorder, timers, or state.
  const acquisitionRef = useRef(0);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    const acquisition = acquisitionRef;
    const live = liveCapturesRef.current;
    return () => {
      acquisition.current += 1;
      // Leaving stops every capture; their late onstop still reaches their callbacks as discards.
      for (const capture of [...live]) {
        capture.discardReason ??= "exit";
        if (capture.recorder?.state === "recording") {
          latch(capture, "exit");
          capture.recorder.stop();
        }
        release(capture);
      }
    };
  }, []);

  // Stops the capture's tracks and timer once, then tells its owner the microphone is closed.
  function release(capture: Capture) {
    if (capture.released) return;
    capture.released = true;
    if (capture.timer !== null) window.clearInterval(capture.timer);
    capture.timer = null;
    stopTracks(capture.stream);
    liveCapturesRef.current.delete(capture);
    callHook(() => capture.hooks.onRelease?.());
  }

  // Latches the first stop of a capture; later stop sources for it are no-ops.
  function latch(capture: Capture, reason: CaptureStopReason): CaptureStop {
    if (!capture.stop) {
      capture.stop = Object.freeze({ reason, durationMs: performance.now() - capture.startedAt });
      const stop = capture.stop;
      callHook(() => capture.hooks.onStop?.(stop));
    }
    return capture.stop;
  }

  function stopCapture(capture: Capture, reason: CaptureStopReason) {
    if (capture.timer !== null) window.clearInterval(capture.timer);
    capture.timer = null;
    if (capture.recorder?.state === "recording") {
      latch(capture, reason);
      capture.recorder.stop();
    }
  }

  function stopRecordingWith(reason: CaptureStopReason) {
    const capture = mediaRecorderRef.current && capturesRef.current.get(mediaRecorderRef.current);
    if (capture) stopCapture(capture, reason);
  }

  // Takes no arguments so it can be a click handler.
  function stopRecording() {
    stopRecordingWith("manual");
  }

  // onReady is bound to this capture, so a late onstop from a cancelled
  // capture still reaches the callback it was started with.
  async function startRecording(onReady: RecordingReady = onRecordingReady, hooks: CaptureHooks = {}): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      onUnsupported();
      return false;
    }

    acquisitionRef.current += 1;
    const acquisition = acquisitionRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    // Cancelled, replaced, or unmounted while permission was pending: the caller gets false and
    // the newer capture keeps the recorder.
    if (acquisition !== acquisitionRef.current) {
      stopTracks(stream);
      return false;
    }
    const capture: Capture = {
      stream,
      recorder: null,
      startedAt: 0,
      stop: null,
      discardReason: null,
      hooks,
      timer: null,
      released: false
    };
    liveCapturesRef.current.add(capture);
    try {
      return beginCapture(capture, onReady);
    } catch (error) {
      release(capture);
      throw error;
    }
  }

  function beginCapture(capture: Capture, onReady: RecordingReady): boolean {
    const { stream, hooks } = capture;
    // Chrome/Firefox support opus-in-webm; Safari does not, but does support
    // mp4. Feature-detect both before falling back to the browser default so
    // the recorded blob's type isn't mislabeled on Safari.
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    capture.recorder = recorder;
    capturesRef.current.set(recorder, capture);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      release(capture);
      const blob = new Blob(chunks, {
        // Reflect whatever the browser actually recorded with rather than
        // hardcoding webm, which mislabels the blob on Safari.
        type: mimeType || recorder.mimeType || "audio/webm"
      });
      // A browser-initiated stop (device loss) was never accepted, so a run discards it.
      const accepted = latch(capture, "cancel");
      const discarded = capture.discardReason !== null;
      const stop: CaptureStop = Object.freeze({
        reason: capture.discardReason ?? accepted.reason,
        durationMs: accepted.durationMs
      });
      // A discarded or superseded capture never republishes the shared
      // preview, but its own callback still runs.
      if (!discarded && mediaRecorderRef.current === recorder) {
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
        }
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecorderState("recorded");
        setRecordingStream(null);
      }
      onReady(blob, discarded, stop);
    };
    // Analysis attaches before the clock starts, so a permission prompt never eats a timeout.
    callHook(() => hooks.onStream?.(stream));
    recorder.start();
    capture.startedAt = performance.now();
    mediaRecorderRef.current = recorder;
    callHook(() => hooks.onStart?.(capture.startedAt));
    setElapsedMs(0);
    setAudioBlob(null);
    setRecorderState("recording");
    setRecordingStream(stream);
    // The elapsed display and hard cap keep the wall clock; stop durations use the monotonic one.
    const wallStartedAt = Date.now();
    capture.timer = window.setInterval(() => {
      const nextElapsed = Date.now() - wallStartedAt;
      setElapsedMs(nextElapsed);
      if (nextElapsed >= maxMs) {
        stopCapture(capture, "hard-cap");
      }
    }, 150);
    return true;
  }

  // Stops the current capture without keeping it: the browser's later onstop
  // reaches only that capture's callback. A discard after an accepted stop but
  // before onstop still turns the delivery into a discard.
  function discardRecording(reason: CaptureStopReason = "cancel") {
    acquisitionRef.current += 1;
    const capture = mediaRecorderRef.current && capturesRef.current.get(mediaRecorderRef.current);
    if (capture) capture.discardReason ??= reason;
    stopRecordingWith(reason);
    resetRecording();
    setRecordingStream(null);
  }

  function resetRecording() {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecorderState("idle");
    setElapsedMs(0);
  }

  return {
    recorderState,
    elapsedMs,
    audioBlob,
    audioUrl,
    recordingStream,
    startRecording,
    stopRecording,
    stopRecordingWith,
    discardRecording,
    resetRecording
  };
}
