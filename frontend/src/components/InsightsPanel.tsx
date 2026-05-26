import { useMemo, useState } from "react";
import { AlertCircle, ChevronRight, History, Loader2, Mic, RefreshCw, Sparkles } from "lucide-react";
import { scoreTone } from "../scoreUtils";
import type { SpeechStatus } from "../hooks/useSpeech";
import type { PhonemeStat } from "../types";
import { PhonemeCoachCard } from "./PhonemeCoachCard";

type InsightsViewMode = "map" | "priority";

type PhonemeMapGroup = {
  id: string;
  title: string;
  hint: string;
  phonemes: string[];
};

type InsightsPanelProps = {
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
};

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

const PHONEME_MAP_GROUPS: PhonemeMapGroup[] = [
  {
    id: "stops",
    title: "Stops",
    hint: "Complete air stop, then release",
    phonemes: ["p", "b", "t", "d", "k", "g"],
  },
  {
    id: "fricatives-affricates",
    title: "Fricatives & Affricates",
    hint: "Narrow airflow, with ch/j as stop + friction",
    phonemes: ["f", "v", "θ", "ð", "s", "z", "ʃ", "h", "tʃ", "dʒ"],
  },
  {
    id: "nasals",
    title: "Nasals",
    hint: "Voice resonates through the nose",
    phonemes: ["m", "n", "ŋ"],
  },
  {
    id: "liquids-glides",
    title: "Liquids & Glides",
    hint: "Smooth transitions and light approximants",
    phonemes: ["l", "ɹ", "w", "j"],
  },
  {
    id: "simple-vowels",
    title: "Simple Vowels",
    hint: "Single target mouth and tongue shape",
    phonemes: ["i", "ɪ", "ɛ", "æ", "ə", "ʌ", "ɑ", "ɔ", "ʊ", "u"],
  },
  {
    id: "diphthongs",
    title: "Diphthongs",
    hint: "One vowel glides into another",
    phonemes: ["eɪ", "aɪ", "aʊ", "oʊ", "ju"],
  },
  {
    id: "r-controlled",
    title: "R-Controlled Vowels",
    hint: "Vowel color changes because of the following r",
    phonemes: ["ɝ", "ɚ", "ɔɹ", "ɑɹ", "ɛɹ", "ɪɹ", "aʊɹ"],
  },
];

const PHONEME_ALIASES: Record<string, string> = {
  r: "ɹ",
  er: "ɝ",
  ax: "ə",
  ih: "ɪ",
  eh: "ɛ",
  ah: "ɑ",
  ao: "ɔ",
  oo: "ʊ",
  uh: "ʌ",
  ey: "eɪ",
  ay: "aɪ",
  aw: "aʊ",
  ow: "oʊ",
  th: "θ",
  dh: "ð",
  sh: "ʃ",
  ch: "tʃ",
  jh: "dʒ",
  ng: "ŋ",
};

const KNOWN_MAP_PHONEMES = new Set(PHONEME_MAP_GROUPS.flatMap((group) => group.phonemes));

function normalizePhoneme(phoneme: string) {
  const lower = phoneme.toLowerCase();
  return PHONEME_ALIASES[lower] ?? phoneme;
}

function getGuideWord(phoneme: string) {
  return PHONEME_GUIDE_WORDS[phoneme.toLowerCase()] || PHONEME_GUIDE_WORDS[phoneme];
}

function comparePriorityStats(a: PhonemeStat, b: PhonemeStat) {
  const scoreDelta = a.average_accuracy - b.average_accuracy;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const weakDelta = b.needs_work_count - a.needs_work_count;
  if (weakDelta !== 0) {
    return weakDelta;
  }

  const attemptsDelta = b.attempts - a.attempts;
  if (attemptsDelta !== 0) {
    return attemptsDelta;
  }

  return a.phoneme.localeCompare(b.phoneme);
}

function PhonemeHeatmap({
  stat,
  onDrill,
}: {
  stat: PhonemeStat;
  onDrill: InsightsPanelProps["onDrill"];
}) {
  return (
    <div className="phoneme-heatmap" aria-label={`Recent attempts for ${stat.phoneme}`}>
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
  );
}

function PhonemeStatHeader({
  stat,
  isOpen,
  setExpandedPhoneme,
}: {
  stat: PhonemeStat;
  isOpen: boolean;
  setExpandedPhoneme: InsightsPanelProps["setExpandedPhoneme"];
}) {
  const guideWord = getGuideWord(stat.phoneme);
  const score = Math.round(stat.average_accuracy);

  return (
    <button
      type="button"
      className="phoneme-stat-header"
      aria-expanded={isOpen}
      aria-label={`Open /${stat.phoneme}/ coach, score ${score} with ${stat.attempts} tries`}
      onClick={() => setExpandedPhoneme(isOpen ? null : stat.phoneme)}
    >
      <div className="phoneme-symbol-area">
        <span className={`phoneme-symbol ${stat.bucket}`}>{stat.phoneme}</span>
        {guideWord ? <span className="phoneme-guide-hint">/{guideWord}/</span> : null}
      </div>
      <strong>{score}</strong>
      <small>
        {stat.attempts} tries · {stat.needs_work_count} weak
      </small>
      <ChevronRight size={18} className={isOpen ? "chevron-open" : "chevron-closed"} />
    </button>
  );
}

function ExpandedPhonemeDetails({
  stat,
  onDrill,
  onPlayWord,
  speakingText,
  speechStatus,
}: {
  stat: PhonemeStat;
  onDrill: InsightsPanelProps["onDrill"];
  onPlayWord?: InsightsPanelProps["onPlayWord"];
  speakingText?: InsightsPanelProps["speakingText"];
  speechStatus?: InsightsPanelProps["speechStatus"];
}) {
  return (
    <div className="phoneme-expanded-coach-container">
      <PhonemeCoachCard
        phoneme={stat.phoneme}
        onDrill={onDrill}
        onPlayWord={onPlayWord}
        speakingText={speakingText}
        speechStatus={speechStatus}
      />

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
  );
}

function PhonemePriorityRow({
  stat,
  expandedPhoneme,
  setExpandedPhoneme,
  onDrill,
  onPlayWord,
  speakingText,
  speechStatus,
}: {
  stat: PhonemeStat;
  expandedPhoneme: InsightsPanelProps["expandedPhoneme"];
  setExpandedPhoneme: InsightsPanelProps["setExpandedPhoneme"];
  onDrill: InsightsPanelProps["onDrill"];
  onPlayWord?: InsightsPanelProps["onPlayWord"];
  speakingText?: InsightsPanelProps["speakingText"];
  speechStatus?: InsightsPanelProps["speechStatus"];
}) {
  const isOpen = expandedPhoneme === stat.phoneme;

  return (
    <li className={`phoneme-stat-row ${stat.bucket}`}>
      <PhonemeStatHeader
        stat={stat}
        isOpen={isOpen}
        setExpandedPhoneme={setExpandedPhoneme}
      />
      <PhonemeHeatmap stat={stat} onDrill={onDrill} />
      {isOpen ? (
        <ExpandedPhonemeDetails
          stat={stat}
          onDrill={onDrill}
          onPlayWord={onPlayWord}
          speakingText={speakingText}
          speechStatus={speechStatus}
        />
      ) : null}
    </li>
  );
}

function PhonemeMapTile({
  phoneme,
  stat,
  isOpen,
  setExpandedPhoneme,
}: {
  phoneme: string;
  stat?: PhonemeStat;
  isOpen: boolean;
  setExpandedPhoneme: InsightsPanelProps["setExpandedPhoneme"];
}) {
  if (!stat) {
    return (
      <button
        type="button"
        className="phoneme-map-tile no-data"
        aria-label={`/${phoneme}/ has no practice data yet`}
        title="No practice data yet"
        disabled
      >
        <span className="phoneme-map-symbol">/{phoneme}/</span>
        <span className="phoneme-map-status">No data</span>
      </button>
    );
  }

  const score = Math.round(stat.average_accuracy);

  return (
    <button
      type="button"
      className={`phoneme-map-tile ${stat.bucket}${isOpen ? " selected" : ""}`}
      aria-expanded={isOpen}
      aria-label={`Open /${stat.phoneme}/ coach, score ${score} with ${stat.attempts} tries`}
      onClick={() => setExpandedPhoneme(isOpen ? null : stat.phoneme)}
    >
      <span className="phoneme-map-symbol">/{phoneme}/</span>
      <strong>{score}</strong>
      <small>{stat.attempts} tries</small>
    </button>
  );
}

function PhonemeMapGroupSection({
  group,
  statsByPhoneme,
  expandedPhoneme,
  setExpandedPhoneme,
  onDrill,
  onPlayWord,
  speakingText,
  speechStatus,
}: {
  group: PhonemeMapGroup;
  statsByPhoneme: Map<string, PhonemeStat>;
  expandedPhoneme: InsightsPanelProps["expandedPhoneme"];
  setExpandedPhoneme: InsightsPanelProps["setExpandedPhoneme"];
  onDrill: InsightsPanelProps["onDrill"];
  onPlayWord?: InsightsPanelProps["onPlayWord"];
  speakingText?: InsightsPanelProps["speakingText"];
  speechStatus?: InsightsPanelProps["speechStatus"];
}) {
  const headingId = `phoneme-map-${group.id}`;
  const expandedStat = group.phonemes
    .map((phoneme) => statsByPhoneme.get(phoneme))
    .find((stat) => stat?.phoneme === expandedPhoneme);

  return (
    <section className="phoneme-map-group" role="group" aria-labelledby={headingId}>
      <div className="phoneme-map-group-heading">
        <div>
          <h3 id={headingId}>{group.title}</h3>
          <p>{group.hint}</p>
        </div>
      </div>
      <div className="phoneme-map-grid">
        {group.phonemes.map((phoneme) => {
          const stat = statsByPhoneme.get(phoneme);
          return (
            <PhonemeMapTile
              key={phoneme}
              phoneme={phoneme}
              stat={stat}
              isOpen={Boolean(stat && expandedPhoneme === stat.phoneme)}
              setExpandedPhoneme={setExpandedPhoneme}
            />
          );
        })}
      </div>
      {expandedStat ? (
        <ExpandedPhonemeDetails
          stat={expandedStat}
          onDrill={onDrill}
          onPlayWord={onPlayWord}
          speakingText={speakingText}
          speechStatus={speechStatus}
        />
      ) : null}
    </section>
  );
}

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
}: InsightsPanelProps) {
  const [viewMode, setViewMode] = useState<InsightsViewMode>("map");
  const statsByPhoneme = useMemo(() => {
    const map = new Map<string, PhonemeStat>();
    for (const stat of stats) {
      map.set(normalizePhoneme(stat.phoneme), stat);
    }
    return map;
  }, [stats]);
  const sortedPriorityStats = useMemo(() => [...stats].sort(comparePriorityStats), [stats]);
  const mapGroups = useMemo(() => {
    const extraPhonemes = stats
      .map((stat) => normalizePhoneme(stat.phoneme))
      .filter((phoneme, index, phonemes) => {
        return !KNOWN_MAP_PHONEMES.has(phoneme) && phonemes.indexOf(phoneme) === index;
      })
      .sort((a, b) => a.localeCompare(b));

    if (extraPhonemes.length === 0) {
      return PHONEME_MAP_GROUPS;
    }

    return [
      ...PHONEME_MAP_GROUPS,
      {
        id: "other-observed",
        title: "Other Observed Sounds",
        hint: "Captured from your recent practice data",
        phonemes: extraPhonemes,
      },
    ];
  }, [stats]);

  return (
    <section className="insights-panel">
      <div className="panel-heading split">
        <div>
          <h2>Phoneme Insights</h2>
          <p className="muted">Fixed sound map with a quick weakest-sounds view</p>
        </div>
        <div className="insights-actions">
          <div className="view-switch insights-view-switch" aria-label="Phoneme insights view">
            <button
              type="button"
              className={`view-tab ${viewMode === "map" ? "selected" : ""}`}
              aria-pressed={viewMode === "map"}
              onClick={() => setViewMode("map")}
            >
              Map
            </button>
            <button
              type="button"
              className={`view-tab ${viewMode === "priority" ? "selected" : ""}`}
              aria-pressed={viewMode === "priority"}
              onClick={() => setViewMode("priority")}
            >
              Priority
            </button>
          </div>
          <button className="icon-button" onClick={onRefresh} title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>
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
      ) : viewMode === "map" ? (
        <div className="phoneme-map" aria-label="Phoneme map">
          {mapGroups.map((group) => (
            <PhonemeMapGroupSection
              key={group.id}
              group={group}
              statsByPhoneme={statsByPhoneme}
              expandedPhoneme={expandedPhoneme}
              setExpandedPhoneme={setExpandedPhoneme}
              onDrill={onDrill}
              onPlayWord={onPlayWord}
              speakingText={speakingText}
              speechStatus={speechStatus}
            />
          ))}
        </div>
      ) : (
        <ol className="phoneme-stat-list" aria-label="Weakest sounds">
          {sortedPriorityStats.map((stat) => (
            <PhonemePriorityRow
              key={stat.phoneme}
              stat={stat}
              expandedPhoneme={expandedPhoneme}
              setExpandedPhoneme={setExpandedPhoneme}
              onDrill={onDrill}
              onPlayWord={onPlayWord}
              speakingText={speakingText}
              speechStatus={speechStatus}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
