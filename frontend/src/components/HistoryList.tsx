import { formatDuration, scoreValue } from "../scoreUtils";
import type { PracticeSession } from "../types";

type HistoryListProps = {
  sessions: PracticeSession[];
  onSelect: (session: PracticeSession) => void;
};

export function HistoryList({ sessions, onSelect }: HistoryListProps) {
  return (
    <div className="history-list">
      {sessions.length === 0 ? (
        <p className="muted">No sessions yet.</p>
      ) : (
        sessions.map((session) => (
          <button
            key={session.id}
            className="history-row"
            onClick={() => onSelect(session)}
          >
            <span>{new Date(session.created_at).toLocaleDateString()}</span>
            <strong>{scoreValue(session.scores.pronunciation)}</strong>
            <small>{formatDuration(session.audio_duration_ms)}</small>
          </button>
        ))
      )}
    </div>
  );
}
