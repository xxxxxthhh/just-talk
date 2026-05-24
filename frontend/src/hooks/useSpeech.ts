import { useEffect, useRef, useState } from "react";
import { speakText } from "../api";

export function useSpeech(setError: (msg: string) => void) {
  const [speakingText, setSpeakingText] = useState("");
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechUrlRef = useRef("");

  function stopCurrentSpeech() {
    if (speechAudioRef.current) {
      speechAudioRef.current.pause();
      speechAudioRef.current.currentTime = 0;
      speechAudioRef.current = null;
    }
    if (speechUrlRef.current) {
      URL.revokeObjectURL(speechUrlRef.current);
      speechUrlRef.current = "";
    }
  }

  useEffect(() => {
    return () => {
      stopCurrentSpeech();
    };
  }, []);

  async function playCorrect(text: string) {
    const spokenText = text.trim();
    if (!spokenText) return;
    setError("");
    setSpeakingText(spokenText);
    try {
      stopCurrentSpeech();
      const response = await speakText(spokenText);
      const binary = window.atob(response.audio_base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const speechUrl = URL.createObjectURL(
        new Blob([bytes], { type: response.content_type })
      );
      const audio = new Audio(speechUrl);
      speechAudioRef.current = audio;
      speechUrlRef.current = speechUrl;
      audio.onended = () => {
        if (speechAudioRef.current === audio) {
          speechAudioRef.current = null;
          speechUrlRef.current = "";
          setSpeakingText("");
        }
        URL.revokeObjectURL(speechUrl);
      };
      audio.onerror = () => {
        if (speechAudioRef.current === audio) {
          speechAudioRef.current = null;
          speechUrlRef.current = "";
          setSpeakingText("");
        }
        URL.revokeObjectURL(speechUrl);
      };
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not play pronunciation.");
      stopCurrentSpeech();
    } finally {
      setSpeakingText("");
    }
  }

  return { speakingText, playCorrect, stopCurrentSpeech };
}
