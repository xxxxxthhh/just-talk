import { useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "recorded";

type UseRecorderOptions = {
  maxMs: number;
  onUnsupported: () => void;
  // discarded is true when the capture was abandoned with discardRecording.
  onRecordingReady: (blob: Blob, discarded: boolean) => void;
};

export function useRecorder({ maxMs, onUnsupported, onRecordingReady }: UseRecorderOptions) {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const discardedRef = useRef(new WeakSet<MediaRecorder>());
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  function stopRecording() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  // onReady is bound to this capture, so a late onstop from a cancelled
  // capture still reaches the callback it was started with.
  async function startRecording(
    onReady: (blob: Blob, discarded: boolean) => void = onRecordingReady
  ): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      onUnsupported();
      return false;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    // Chrome/Firefox support opus-in-webm; Safari does not, but does support
    // mp4. Feature-detect both before falling back to the browser default so
    // the recorded blob's type isn't mislabeled on Safari.
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, {
        // Reflect whatever the browser actually recorded with rather than
        // hardcoding webm, which mislabels the blob on Safari.
        type: mimeType || recorder.mimeType || "audio/webm"
      });
      const discarded = discardedRef.current.has(recorder);
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
      onReady(blob, discarded);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setAudioBlob(null);
    setRecorderState("recording");
    setRecordingStream(stream);
    timerRef.current = window.setInterval(() => {
      const nextElapsed = Date.now() - startedAtRef.current;
      setElapsedMs(nextElapsed);
      if (nextElapsed >= maxMs) {
        stopRecording();
      }
    }, 150);
    return true;
  }

  // Stops the current capture without keeping it: the browser's later onstop
  // reaches only that capture's callback.
  function discardRecording() {
    if (mediaRecorderRef.current) {
      discardedRef.current.add(mediaRecorderRef.current);
    }
    stopRecording();
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
    discardRecording,
    resetRecording
  };
}
