import { scoreTone, scoreValue } from "../scoreUtils";
import type { ScoreMap } from "../types";

export function ScoreGrid({ scores }: { scores: ScoreMap | null }) {
  const rows: { label: string; value: number | null | undefined }[] = [
    { label: "Pronunciation", value: scores?.pronunciation },
    { label: "Accuracy", value: scores?.accuracy },
    { label: "Fluency", value: scores?.fluency },
    { label: "Completeness", value: scores?.completeness },
    { label: "Prosody", value: scores?.prosody },
  ];

  return (
    <div className="score-grid">
      {rows.map((row) => (
        <div className={`score-tile ${scoreTone(row.value)}`} key={row.label}>
          <span>{row.label}</span>
          <strong>{scoreValue(row.value)}</strong>
        </div>
      ))}
    </div>
  );
}
