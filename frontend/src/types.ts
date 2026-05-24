export type Health = {
  ok: boolean;
  azure_configured: boolean;
  passage_check_configured: boolean;
  max_audio_seconds: number;
  max_long_audio_seconds: number;
  vocabulary_graduation_score: number;
  vocabulary_graduation_streak: number;
};

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

export type WordResult = {
  word: string;
  accuracy: number | null;
  bucket: string;
  error_type: string;
  offset_ms: number;
  duration_ms: number;
  phonemes: PhonemeResult[];
};

export type ScoreResult = {
  transcript: string;
  scores: ScoreMap;
  words: WordResult[];
  segments?: ScoreSegment[];
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
  raw?: unknown;
};

export type ScoreResponse = {
  result: ScoreResult;
  session: PracticeSession;
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
  created_at: string;
  updated_at: string;
};

export type SpeechResponse = {
  audio_base64: string;
  content_type: string;
};

export type PhonemeStatExample = {
  word: string;
  accuracy: number;
  session_id: string;
  reference_text: string;
  created_at: string;
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
};
