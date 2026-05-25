import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { PhonemeCoachCard } from "./PhonemeCoachCard";

interface PhonemeCoachModalProps {
  phoneme: string | null;
  onClose: () => void;
  onDrill: (word: string) => void;
  onPlayWord?: (word: string) => void;
  onStopAudio?: () => void;
  speakingText?: string;
  speechStatus?: "idle" | "loading" | "playing";
}

export function PhonemeCoachModal({
  phoneme,
  onClose,
  onDrill,
  onPlayWord,
  onStopAudio,
  speakingText,
  speechStatus,
}: PhonemeCoachModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  const handleClose = useCallback(() => {
    onStopAudio?.();
    onClose();
  }, [onClose, onStopAudio]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  // Prevent scroll propagation to the background page when the modal is open
  useEffect(() => {
    if (phoneme) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [phoneme]);

  if (!phoneme) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      handleClose();
    }
  };

  const handleDrillAndClose = (word: string) => {
    onStopAudio?.();
    onDrill(word);
    onClose();
  };

  return (
    <div
      className="coach-modal-overlay"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="coach-modal-container glass-panel shadow-2xl" ref={modalRef}>
        {/* Close button */}
        <button
          type="button"
          className="coach-modal-close"
          onClick={handleClose}
          aria-label="Close pronunciation coach"
        >
          <X size={20} />
        </button>

        {/* Modal Title */}
        <div className="coach-modal-title-bar">
          <h2 id="modal-title">Phoneme Pronunciation Coach</h2>
          <span className="subtitle">Sound guide and targeted training drills</span>
        </div>

        {/* Scrollable coach card content */}
        <div className="coach-modal-body">
          <PhonemeCoachCard
            phoneme={phoneme}
            onDrill={handleDrillAndClose}
            onPlayWord={onPlayWord}
            speakingText={speakingText}
            speechStatus={speechStatus}
          />
        </div>
      </div>
    </div>
  );
}
