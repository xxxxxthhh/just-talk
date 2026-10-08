export type Health = {
  ok: boolean;
  azure_configured: boolean;
  passage_check_configured: boolean;
  max_audio_seconds: number;
  max_long_audio_seconds: number;
  vocabulary_graduation_score: number;
  vocabulary_graduation_streak: number;
  public?: PublicTrialInfo;
};

export type PublicTrialInfo = {
  scoring_enabled: boolean;
  turnstile_site_key: string;
  max_tts_chars_per_request: number;
  max_reference_chars: number;
  visitor_ttl_days: number;
};

export type QuotaWindow = {
  used: number;
  limit: number;
  attempts_used: number;
  attempts_limit: number;
  resets_at: string;
};

export type QuotaScope = "visitor_day" | "global_day" | "global_month";

export type QuotaStatus = Record<"score" | "tts", Record<QuotaScope, QuotaWindow>>;

export type ScoreMap = {
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
  prosody: number | null;
  pronunciation: number | null;
};

export type PhonemeResult = {
  phoneme: string;
  accuracy: number | null;
  bucket: string;
  offset_ms: number;
  duration_ms: number;
  n_best: { phoneme: string; score: number | null }[];
};

export type ProsodyIssue = "unexpected_break" | "missing_break" | "monotone";

export type WordResult = {
  word: string;
  accuracy: number | null;
  bucket: string;
  error_type: string;
  offset_ms: number;
  duration_ms: number;
  phonemes: PhonemeResult[];
  prosody_issues?: ProsodyIssue[];
};

export type RecognitionStatus = "success" | "no_match";

export type ScoreResult = {
  transcript: string;
  recognition_status?: RecognitionStatus;
  scores: ScoreMap;
  words: WordResult[];
  segments?: ScoreSegment[];
  warnings?: string[];
  raw: unknown;
};

export type ScoreSegment = {
  index: number;
  transcript: string;
  scores: ScoreMap;
  words: WordResult[];
};

export type PracticeSession = {
  id: string;
  created_at: string;
  reference_text: string;
  audio_duration_ms: number;
  scores: ScoreMap;
  segments?: ScoreSegment[];
  words?: WordResult[];
  warnings?: string[];
  raw?: unknown;
};

export type ScoreResponse = {
  result: ScoreResult;
  // null when result.recognition_status === "no_match": nothing was persisted.
  session: PracticeSession | null;
};

export type PassageIssue = {
  span: string;
  problem: string;
  suggestion: string;
  explanation: string;
};

export type VocabularyStatus = "active" | "graduated";

export type VocabularyItem = {
  id: string;
  word: string;
  source: string;
  notes: string;
  latest_score: number | null;
  practice_count: number;
  last_practiced_at: string | null;
  status: VocabularyStatus;
  consecutive_successes: number;
  graduated_at: string | null;
  interval_days: number;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SpeechResponse = {
  audio_base64: string;
  content_type: string;
  word_boundaries?: SpeechWordBoundary[];
};

export type SpeechWordBoundary = {
  text: string;
  text_offset: number;
  word_length: number;
  audio_offset_ms: number;
  duration_ms: number;
};

export type PhonemeStatExample = {
  word: string;
  accuracy: number;
  session_id: string;
  reference_text: string;
  created_at: string;
};

export type PhonemeAttempt = {
  accuracy: number;
  word: string;
  created_at: string;
  session_id: string;
};

export type ActivityDay = {
  date: string;
  sessions: number;
};

export type RecentScore = {
  created_at: string;
  pron_score: number | null;
  accuracy_score: number | null;
  fluency_score: number | null;
  prosody_score: number | null;
  mode: string;
};

export type ActivityStats = {
  days: ActivityDay[];
  streak_days: number;
  sessions_this_week: number;
  recent_scores: RecentScore[];
};

export type PhonemeStat = {
  phoneme: string;
  average_accuracy: number;
  attempts: number;
  needs_work_count: number;
  watch_count: number;
  good_count: number;
  bucket: string;
  last_seen_at: string;
  example_words: PhonemeStatExample[];
  attempts_history?: PhonemeAttempt[];
};

export type MaterialItem = {
  id: string;
  pack_id: string;
  pack_title: string;
  title: string;
  text: string;
  book: string;
  lesson: string;
  tags: string[];
  source: string;
  license: string;
  created_at: string;
  updated_at: string;
};

export type MaterialPack = {
  id: string;
  title: string;
  source: string;
  license: string;
  imported_at?: string;
  updated_at?: string;
};

export type MaterialPackImportPayload = {
  schema_version: 1;
  pack: {
    id: string;
    title: string;
    source?: string;
    license?: string;
  };
  lessons: {
    id: string;
    title: string;
    text: string;
    book?: string | number | null;
    lesson?: string | number | null;
    tags?: string[];
  }[];
};

export type MaterialPackImportResponse = {
  pack: MaterialPack;
  materials: MaterialItem[];
};

export type RunMode = "route" | "challenge";
export type RunPhase = "ready" | "recording" | "scoring" | "feedback" | "rescue" | "summary" | "review";
export type AttemptKey = { runId: string; itemId: string; attemptId: string };
export type AttemptPurpose = "initial" | "rerecord" | "rescue";
export type ScoreFailure = { kind: "rejected" | "quota" | "unknown"; message: string };
export type Verdict =
  | "practiced"
  | "passed"
  | "relisten"
  | "saved"
  | "heart-lost"
  | "no-match"
  | "unjudged"
  | "cannot-confirm"
  | "rejected"
  | "skipped"
  | "pending"
  | "quota-ended";
export type WordCandidate = { word: string; status: "processed" | "unconfirmed" | "save-manually" };

export type Attempt = {
  key: AttemptKey;
  purpose: AttemptPurpose;
  slot: "main" | "extra";
  status: "capturing" | "submitted" | "scored" | "pending";
  recording: Blob | null;
  sessionId: string | null;
  result: ScoreResult | null;
  sync: "not-needed" | "pending" | "done" | "manual";
  candidates: readonly WordCandidate[];
};

export type RunPrompt = {
  itemId: string;
  stage: "warmup" | "focus" | "context";
  kind: "word" | "sentence";
  text: string;
  targetPhoneme: string | null;
  targetWord: string | null;
  source: "due-word" | "starter" | "previous-run";
};

export type RunItem = {
  prompt: Readonly<RunPrompt>;
  attempts: readonly Attempt[];
  resolution: "open" | "resolved" | "skipped" | "unjudged" | "pending";
  verdict: Verdict | null;
  firstLowAttemptId: string | null;
  referenceLoad: "idle" | "pending" | "ready" | "failed";
  lastRejection: { attemptId: string; message: string; localReason?: LocalRejectReason } | null;
};

export type RunState = {
  runId: string;
  mode: RunMode;
  phase: RunPhase;
  paused: boolean;
  items: readonly RunItem[];
  index: number;
  activeAttemptId: string | null;
  hearts: 0 | 1 | 2 | null;
  budgetUsed: number; // Reserved on send; refunded for rejected, not total HTTP requests.
  mainItemIdsUsed: readonly string[];
  extraUsed: 0 | 1 | 2;
  challengeIncomplete: boolean;
  endReason: "completed" | "hearts-exhausted" | "quit" | "quota" | null;
  challengeOutcome: "cleared" | "failed" | "incomplete" | null;
};

export type RunAction =
  | { type: "START"; runId: string; mode: RunMode; prompts: readonly RunPrompt[] }
  | { type: "BEGIN_CAPTURE"; key: AttemptKey; purpose: AttemptPurpose; slot: "main" | "extra" }
  | { type: "BLOB_READY"; key: AttemptKey; blob: Blob }
  | { type: "CANCEL_CAPTURE"; key: AttemptKey }
  | { type: "SCORE_SENT"; key: AttemptKey }
  | { type: "SCORE_RECEIVED"; key: AttemptKey; response: ScoreResponse }
  | { type: "SCORE_FAILED"; key: AttemptKey; failure: ScoreFailure }
  | { type: "SYNC_SETTLED"; key: AttemptKey; candidates: readonly WordCandidate[]; failed: boolean }
  | { type: "REFERENCE_CLICKED"; runId: string; itemId: string }
  | { type: "REFERENCE_LOADED"; runId: string; itemId: string; ok: boolean }
  | { type: "SKIP" | "ADVANCE" | "CANNOT_CONFIRM"; runId: string; itemId: string }
  | { type: "PAUSE" | "RESUME" | "QUIT" | "OPEN_REVIEW" | "EXIT"; runId: string };

// Game Mode v2 Day 1 contracts. RunAction gains LOCAL_REJECT together with its handler:
// | { type: "LOCAL_REJECT"; key: AttemptKey; reason: LocalRejectReason }
export type AutoStopState = "off" | "calibrating" | "listening" | "tail" | "fallback" | "stopping";
export type LocalRejectReason = "too-short" | "no-speech";
export type CaptureStopReason = "manual" | "silence" | "no-speech" | "short-voice"
  | "auto-cap" | "hard-cap" | "cancel" | "pause" | "quit" | "exit" | "replaced";
export type CaptureSummary = Readonly<{
  captureId: string; // Equal to the owning attemptId; callback also closes over AttemptKey.
  stopReason: CaptureStopReason;
  durationMs: number; // Monotonic; recorder.start() to first accepted stop, not onstop delivery.
  detectionValid: boolean;
  speechSeen: boolean;
  voicedMs: number;
}>;
export type RunCaptureOptions = Readonly<{
  key: AttemptKey; kind: "word" | "sentence"; autoStop: boolean;
}>;
export type CaptureTelemetry = Readonly<{
  captureId: string | null; level: number; silenceProgress: number;
  autoStopState: AutoStopState; elapsedMs: number;
}>;
export type RunTier = "perfect" | "great" | "good" | "relisten";
export type RunRating = "S" | "A" | "B" | "C";
export type RunItemScore = Readonly<{
  itemId: string; firstAccuracy: number | null; tier: RunTier | null;
  chain: number; basePoints: number; chainPoints: number;
}>;
export type RunScoreView = Readonly<{
  items: readonly RunItemScore[]; points: number; currentChain: number;
  longestChain: number; rated: boolean; rating: RunRating | null;
  unratedReason: string | null; fullCombo: boolean;
}>;
export type RevisitEvidence = Readonly<{
  itemId: string; attemptId: string; word: string; phoneme: string | null;
  accuracy: number; scoreSource: "word" | "phoneme";
}>;
export type RevisitSuggestion = Readonly<{
  id: string; summary: string; evidence: readonly RevisitEvidence[];
}>;
export type RunBestReceipt = Readonly<{
  runId: string; previousPoints: number | null;
  outcome: "first-record" | "new-best" | "none";
}>;
