import { useState } from "react";
import { Activity, BookOpen, Loader2, Sparkles, Volume2, Zap } from "lucide-react";
import { useSpeech, type SpeechStatus } from "../hooks/useSpeech";
import { PHONEME_GUIDES, PhonemeGuide, getFallbackGuide } from "./PhonemeGuideData";
import { MouthVisualizer } from "./MouthVisualizer";

type PairSide = "word1" | "word2";

interface PhonemeCoachCardProps {
  phoneme: string;
  onDrill?: (word: string) => void;
  onPlayWord?: (word: string) => void;
  speakingText?: string;
  speechStatus?: SpeechStatus;
}

export function PhonemeCoachCard({
  phoneme,
  onDrill,
  onPlayWord,
  speakingText,
  speechStatus,
}: PhonemeCoachCardProps) {
  const [localSpeechError, setLocalSpeechError] = useState("");
  const [showAirflow, setShowAirflow] = useState(true);
  const [showVibration, setShowVibration] = useState(true);
  const [trainerPairIndex, setTrainerPairIndex] = useState(0);
  const [trainerSide, setTrainerSide] = useState<PairSide>("word1");
  const [trainerFeedback, setTrainerFeedback] = useState("");
  const [trainerAnswered, setTrainerAnswered] = useState(false);
  const [trainerStats, setTrainerStats] = useState({ correct: 0, total: 0 });
  const fallbackSpeech = useSpeech(setLocalSpeechError);

  // Normalize phonetic symbol input to match our database keys
  const cleanPhoneme = phoneme.trim().toLowerCase();
  
  // Find matching guide, or construct a robust fallback
  const guide: PhonemeGuide = PHONEME_GUIDES[cleanPhoneme] || 
    PHONEME_GUIDES[phoneme] || 
    getFallbackGuide(phoneme);

  const activeSpeakingText = speakingText ?? fallbackSpeech.speakingText;
  const activeSpeechStatus = speechStatus ?? fallbackSpeech.speechStatus;
  const activePair = guide.minimalPairs[trainerPairIndex] ?? null;
  const trainerTarget = activePair ? activePair[trainerSide] : "";
  const isAudioBusy = activeSpeechStatus === "playing" || activeSpeechStatus === "loading";

  const isPlayingWord = (word: string) =>
    activeSpeakingText === word && (activeSpeechStatus === "playing" || activeSpeechStatus === "loading");

  const handlePlayAudio = (text: string) => {
    if (!text.trim()) return;
    if (onPlayWord) {
      onPlayWord(text);
      return;
    }
    void fallbackSpeech.playCorrect(text);
  };

  const handleTrainerAnswer = (choice: string) => {
    if (!activePair || trainerAnswered) return;
    const isCorrect = choice === trainerTarget;
    setTrainerStats((current) => ({
      correct: current.correct + (isCorrect ? 1 : 0),
      total: current.total + 1,
    }));
    setTrainerAnswered(true);
    setTrainerFeedback(
      isCorrect
        ? `Correct. You heard ${trainerTarget}.`
        : `Try again. You heard ${trainerTarget}.`
    );
  };

  const moveToNextChallenge = () => {
    if (guide.minimalPairs.length === 0) return;
    const nextSide = trainerSide === "word1" ? "word2" : "word1";
    const nextIndex =
      trainerSide === "word2"
        ? (trainerPairIndex + 1) % guide.minimalPairs.length
        : trainerPairIndex;
    setTrainerSide(nextSide);
    setTrainerPairIndex(nextIndex);
    setTrainerFeedback("");
    setTrainerAnswered(false);
  };

  return (
    <div className="phoneme-coach-card glass-panel animate-fade-in">
      {/* ── HEADER SECTION ─────────────────────────────────── */}
      <div className="coach-header">
        <div className="coach-badge-area">
          <div className="ipa-avatar">/{guide.ipaSymbol}/</div>
          <div>
            <h3>{guide.name}</h3>
            <div className="coach-tags">
              <span className={`coach-tag ${guide.type}`}>
                {guide.type.toUpperCase()}
              </span>
              <span className={`coach-tag voiced-state ${guide.voiced ? "voiced" : "voiceless"}`}>
                {guide.voiced ? "Voiced (浊音)" : "Voiceless (清音)"}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`speak-guide-btn ${isPlayingWord(guide.guideWord) ? "playing" : ""}`}
          onClick={() => handlePlayAudio(guide.guideWord)}
          title={`Listen to guide word: ${guide.guideWord}`}
          disabled={isAudioBusy && !isPlayingWord(guide.guideWord)}
        >
          {isPlayingWord(guide.guideWord) && activeSpeechStatus === "loading" ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <Volume2 size={16} />
          )}
          <span>/{guide.guideWord}/</span>
        </button>
      </div>

      {/* ── MAIN INTERACTIVE CONTAINER ────────────────────── */}
      <div className="coach-main-grid">
        {/* Anatomical Visualizer (Left Column) */}
        <div className="visualizer-container">
          <div className="visualizer-wrapper">
            <MouthVisualizer
              phoneme={guide.symbol}
              type={guide.type}
              voiced={guide.voiced && showVibration}
              showAirflow={showAirflow}
              tonguePosition={guide.tonguePosition}
              mouthOpening={guide.mouthOpening}
              velum={guide.velum}
            />
          </div>
          <div className="visualizer-toggles">
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={showAirflow}
                onChange={(e) => setShowAirflow(e.target.checked)}
              />
              <span className="toggle-label">Animate Flow (气流)</span>
            </label>
            {guide.voiced && (
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={showVibration}
                  onChange={(e) => setShowVibration(e.target.checked)}
                />
                <span className="toggle-label">Vibrations (声带)</span>
              </label>
            )}
          </div>
        </div>

        {localSpeechError ? (
          <div className="coach-inline-error" role="alert">
            {localSpeechError}
          </div>
        ) : null}

        {/* Written Guide Text (Right Column) */}
        <div className="guide-text-area">
          <div className="bilingual-desc">
            <p className="desc-cn">{guide.descriptionCn}</p>
            <p className="desc-en">{guide.descriptionEn}</p>
          </div>

          <div className="instruction-breakdown">
            <div className="inst-row">
              <span className="inst-label">👅 Tongue (舌位)</span>
              <p>{guide.tongueInstructions}</p>
            </div>
            <div className="inst-row">
              <span className="inst-label">👄 Lips & Jaw (口形)</span>
              <p>{guide.lipInstructions}</p>
            </div>
            <div className="inst-row">
              <span className="inst-label">💨 Airflow (气流)</span>
              <p>{guide.airflowInstructions}</p>
            </div>
          </div>

          {/* Special Coach Tip Box */}
          <div className="coach-tip-box">
            <div className="tip-title">
              <Sparkles size={16} />
              <span>Coach Tip (发音秘诀)</span>
            </div>
            <p>{guide.coachTips}</p>
          </div>
        </div>
      </div>

      {/* ── DRills / PRACTICE WORDS ───────────────────────── */}
      <div className="coach-drills-section">
        {/* Minimal Pairs (Double Contrast drills) */}
        {guide.minimalPairs.length > 0 && (
          <div className="drill-block minimal-pairs-block">
            {activePair ? (
              <div className="contrast-trainer" aria-label="Minimal pair listening trainer">
                <div className="contrast-trainer-topline">
                  <div>
                    <h4>
                      <Activity size={15} />
                      <span>Listen & Choose (听辨训练)</span>
                    </h4>
                    <p className="muted text-xs">
                      Play the hidden prompt, then choose which word you heard.
                    </p>
                  </div>
                  <div className="trainer-score" aria-label="Trainer score">
                    <strong>{trainerStats.correct} / {trainerStats.total}</strong>
                    <span>correct</span>
                  </div>
                </div>
                <div className="trainer-actions">
                  <button
                    type="button"
                    className="trainer-play-button"
                    onClick={() => handlePlayAudio(trainerTarget)}
                    disabled={isAudioBusy && !isPlayingWord(trainerTarget)}
                    aria-label="Play challenge"
                  >
                    {isPlayingWord(trainerTarget) && activeSpeechStatus === "loading" ? (
                      <Loader2 className="spin" size={15} />
                    ) : (
                      <Volume2 size={15} />
                    )}
                    <span>Play challenge</span>
                  </button>
                  <div className="trainer-choices">
                    <button
                      type="button"
                      className="trainer-choice"
                      onClick={() => handleTrainerAnswer(activePair.word1)}
                      aria-label={`Choose ${activePair.word1}`}
                      disabled={trainerAnswered}
                    >
                      <strong>{activePair.word1}</strong>
                      <small>/{activePair.ipa1}/</small>
                    </button>
                    <button
                      type="button"
                      className="trainer-choice"
                      onClick={() => handleTrainerAnswer(activePair.word2)}
                      aria-label={`Choose ${activePair.word2}`}
                      disabled={trainerAnswered}
                    >
                      <strong>{activePair.word2}</strong>
                      <small>/{activePair.ipa2}/</small>
                    </button>
                  </div>
                </div>
                <div className="trainer-footer">
                  <div className="trainer-feedback" role="status">
                    {trainerFeedback || `Ready: ${activePair.word1} vs ${activePair.word2}`}
                  </div>
                  <div className="trainer-footer-actions">
                    {onDrill ? (
                      <button
                        type="button"
                        className="drill-bubble-btn"
                        onClick={() => onDrill(trainerTarget)}
                        aria-label={`Drill ${trainerTarget}`}
                      >
                        <Zap size={12} />
                        <span>Drill {trainerTarget}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="trainer-next-button"
                      onClick={moveToNextChallenge}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <h4>
              <Activity size={15} />
              <span>Minimal Pairs Contrast (对比练习)</span>
            </h4>
            <p className="muted text-xs">
              Contrast this sound with highly similar sounds to build correct muscle memory:
            </p>
            <div className="minimal-pairs-grid">
              {guide.minimalPairs.map((pair, idx) => (
                <div className="pair-row" key={idx}>
                  <div className="pair-left">
                    <button
                      type="button"
                      className="word-bubble target"
                      onClick={() => handlePlayAudio(pair.word1)}
                      title={`Play "${pair.word1}"`}
                      disabled={isAudioBusy && !isPlayingWord(pair.word1)}
                    >
                      {isPlayingWord(pair.word1) && activeSpeechStatus === "loading" ? (
                        <Loader2 className="spin" size={13} />
                      ) : (
                        <Volume2 size={13} />
                      )}
                      <strong>{pair.word1}</strong>
                      <small>/{pair.ipa1}/</small>
                    </button>
                    <span className="vs">vs</span>
                    <button
                      type="button"
                      className="word-bubble contrast"
                      onClick={() => handlePlayAudio(pair.word2)}
                      title={`Play "${pair.word2}"`}
                      disabled={isAudioBusy && !isPlayingWord(pair.word2)}
                    >
                      {isPlayingWord(pair.word2) && activeSpeechStatus === "loading" ? (
                        <Loader2 className="spin" size={13} />
                      ) : (
                        <Volume2 size={13} />
                      )}
                      <strong>{pair.word2}</strong>
                      <small>/{pair.ipa2}/</small>
                    </button>
                  </div>
                  <div className="pair-right">
                    <span className="pair-explanation">{pair.note}</span>
                    {onDrill && (
                      <button
                        type="button"
                        className="drill-bubble-btn"
                        onClick={() => onDrill(pair.word1)}
                        title={`Practice "${pair.word1}" inside workspace`}
                      >
                        <Zap size={12} />
                        <span>Drill</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Practice Words (Simple target items) */}
        <div className="drill-block practice-words-block">
          <h4>
            <BookOpen size={15} />
            <span>Target Practice Words (专项训练词)</span>
          </h4>
          <div className="practice-words-grid">
            {guide.practiceWords.map((word) => (
              <div className="drill-word-card" key={word}>
                <div className="word-details">
                  <strong>{word}</strong>
                </div>
                <div className="word-card-actions">
                  <button
                    type="button"
                    className="action-btn-mini audio"
                    onClick={() => handlePlayAudio(word)}
                    title={`Hear standard model`}
                    disabled={isAudioBusy && !isPlayingWord(word)}
                  >
                    {isPlayingWord(word) && activeSpeechStatus === "loading" ? (
                      <Loader2 className="spin" size={13} />
                    ) : (
                      <Volume2 size={13} />
                    )}
                  </button>
                  {onDrill && (
                    <button
                      type="button"
                      className="action-btn-mini drill"
                      onClick={() => onDrill(word)}
                      title={`Drill "${word}"`}
                    >
                      <Zap size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
