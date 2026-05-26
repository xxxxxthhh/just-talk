import { AlertCircle, ChevronRight, History, Loader2, Mic, RefreshCw, Sparkles } from "lucide-react";
import { scoreTone } from "../scoreUtils";
import type { SpeechStatus } from "../hooks/useSpeech";
import type { PhonemeStat } from "../types";
import { PhonemeCoachCard } from "./PhonemeCoachCard";

const PHONEME_GUIDE_WORDS: Record<string, string> = {
  // Consonants & Semi-Vowels
  "p": "p in pin",
  "b": "b in bin",
  "t": "t in to",
  "d": "d in do",
  "k": "k in key",
  "g": "g in get",
  "f": "f in fit",
  "v": "v in van",
  "θ": "th in thin",
  "th": "th in thin",
  "ð": "th in this",
  "dh": "th in this",
  "s": "s in sit",
  "z": "z in zoo",
  "ʃ": "sh in ship",
  "sh": "sh in ship",
  "ʒ": "s in measure",
  "zh": "s in measure",
  "h": "h in hat",
  "m": "m in man",
  "n": "n in now",
  "ŋ": "ng in sing",
  "ng": "ng in sing",
  "l": "l in leg",
  "r": "r in red",
  "w": "w in wet",
  "j": "y in yes",
  "tʃ": "ch in chin",
  "ch": "ch in chin",
  "dʒ": "j in jam",
  "jh": "j in jam",

  // Vowels & Diphthongs (including Azure API specific variants)
  "æ": "a in cat",
  "aa": "a in cat",
  "ɑː": "a in father",
  "ɑ": "a in father",
  "ɒ": "o in hot",
  "o": "o in hot",
  "ah": "o in hot",
  "ɔː": "aw in saw",
  "ao": "aw in saw",
  "ʊ": "oo in foot",
  "oo": "oo in foot",
  "uː": "oo in too",
  "u": "oo in too",
  "ʌ": "u in cup",
  "uh": "u in cup",
  "ɜː": "ur in bird",
  "ɜ": "ur in bird",
  "ɝ": "ur in bird",
  "er": "ur in bird",
  "ə": "a in about",
  "ax": "a in about",
  "e": "e in bed",
  "eh": "e in bed",
  "ɪ": "i in pin",
  "ih": "i in pin",
  "iː": "ee in see",
  "i": "ee in see",
  "eɪ": "a in day",
  "ey": "a in day",
  "aɪ": "y in my",
  "ay": "y in my",
  "ɔɪ": "oy in boy",
  "ɔj": "oy in boy",
  "oy": "oy in boy",
  "aʊ": "ow in cow",
  "aw": "ow in cow",
  "əʊ": "o in go",
  "oʊ": "o in go",
  "ow": "o in go",
  "ɪə": "ear in beer",
  "ihr": "ear in beer",
  "eə": "are in hare",
  "ehr": "are in hare",
  "ʊə": "ure in pure",
  "uhr": "ure in pure",
};

export function InsightsPanel({
  stats,
  loading,
  error,
  expandedPhoneme,
  setExpandedPhoneme,
  onDrill,
  onPlayWord,
  speakingText,
  speechStatus,
  onRefresh,
}: {
  stats: PhonemeStat[];
  loading: boolean;
  error: string;
  expandedPhoneme: string | null;
  setExpandedPhoneme: (p: string | null) => void;
  onDrill: (word: string) => void;
  onPlayWord?: (word: string) => void;
  speakingText?: string;
  speechStatus?: SpeechStatus;
  onRefresh: () => void;
}) {
  return (
    <section className="insights-panel">
      <div className="panel-heading split">
        <div>
          <h2>Phoneme Insights</h2>
          <p className="muted">Weakest sounds across recent sessions</p>
        </div>
        <button className="icon-button" onClick={onRefresh} title="Refresh">
          <RefreshCw size={18} />
        </button>
      </div>

      {error ? (
        <div className="banner" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="empty-state">
          <Loader2 className="spin" size={22} />
          <p>Loading…</p>
        </div>
      ) : stats.length === 0 ? (
        <div className="empty-state">
          <Sparkles size={22} />
          <p>Practice a few passages to start seeing phoneme trends. We need at least 3 attempts per sound.</p>
        </div>
      ) : (
        <ol className="phoneme-stat-list">
          {stats.map((stat) => {
            const isOpen = expandedPhoneme === stat.phoneme;
            const guideWord =
              PHONEME_GUIDE_WORDS[stat.phoneme.toLowerCase()] ||
              PHONEME_GUIDE_WORDS[stat.phoneme];

            return (
              <li key={stat.phoneme} className={`phoneme-stat-row ${stat.bucket}`}>
                <button
                  type="button"
                  className="phoneme-stat-header"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedPhoneme(isOpen ? null : stat.phoneme)}
                >
                  <div className="phoneme-symbol-area">
                    <span className={`phoneme-symbol ${stat.bucket}`}>{stat.phoneme}</span>
                    {guideWord ? <span className="phoneme-guide-hint">/{guideWord}/</span> : null}
                  </div>
                  <strong>{Math.round(stat.average_accuracy)}</strong>
                  <small>
                    {stat.attempts} tries · {stat.needs_work_count} weak
                  </small>
                  <ChevronRight
                    size={18}
                    className={isOpen ? "chevron-open" : "chevron-closed"}
                  />
                </button>
                <div
                  className="phoneme-heatmap"
                  aria-label={`Recent attempts for ${stat.phoneme}`}
                >
                  {Array.from({ length: 12 }).map((_, i) => {
                    const attempt = stat.attempts_history?.[i];
                    if (!attempt || !attempt.word.trim()) {
                      return (
                        <div
                          key={i}
                          className="heatmap-cell empty"
                          title="No practice attempt yet"
                          aria-hidden="true"
                        />
                      );
                    }
                    const score = Math.round(attempt.accuracy);
                    const tone = scoreTone(attempt.accuracy);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`heatmap-cell ${tone}`}
                        aria-label={`Drill ${attempt.word}, score ${score}`}
                        onClick={() => onDrill(attempt.word)}
                        title={`Drill: "${attempt.word}"\nScore: ${score} (${tone})\nDate: ${new Date(attempt.created_at).toLocaleDateString()}`}
                      />
                    );
                  })}
                </div>
                {isOpen ? (
                  <div className="phoneme-expanded-coach-container">
                    {/* The interactive Pronunciation Coach Card */}
                    <PhonemeCoachCard
                      phoneme={stat.phoneme}
                      onDrill={onDrill}
                      onPlayWord={onPlayWord}
                      speakingText={speakingText}
                      speechStatus={speechStatus}
                    />
                    
                    {/* The user's historical practice examples under this phoneme */}
                    <div className="user-history-drill-box">
                      <h4>
                        <History size={15} />
                        <span>Your Recent Session Attempts (历史练习单词)</span>
                      </h4>
                      <ul className="phoneme-examples">
                        {stat.example_words.map((ex) => (
                          <li key={`${stat.phoneme}-${ex.word}-${ex.session_id}`}>
                            <button
                              type="button"
                              className={`phoneme-example ${scoreTone(ex.accuracy)}`}
                              onClick={() => onDrill(ex.word)}
                              title={`Drill "${ex.word}"`}
                            >
                              <strong>{ex.word}</strong>
                              <span>{Math.round(ex.accuracy)}</span>
                              <em>{new Date(ex.created_at).toLocaleDateString()}</em>
                              <Mic size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
