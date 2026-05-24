from typing import Any


AZURE_TICKS_PER_MILLISECOND = 10_000


def score_bucket(score: float | None) -> str:
    if score is None:
        return "unknown"
    if score >= 80:
        return "good"
    if score >= 60:
        return "watch"
    return "needs-work"


def _score(assessment: dict[str, Any], key: str) -> float | None:
    value = assessment.get(key)
    return float(value) if value is not None else None


def _ticks_to_ms(value: int | float | None) -> int:
    if value is None:
        return 0
    return round(float(value) / AZURE_TICKS_PER_MILLISECOND)


def normalize_azure_result(raw_result: dict[str, Any]) -> dict[str, Any]:
    best = raw_result.get("NBest", [{}])[0] if raw_result.get("NBest") else {}
    full_assessment = best.get("PronunciationAssessment", {})

    words = []
    for raw_word in best.get("Words", []):
        word_assessment = raw_word.get("PronunciationAssessment", {})
        word_accuracy = _score(word_assessment, "AccuracyScore")
        phonemes = []

        for raw_phoneme in raw_word.get("Phonemes", []):
            phoneme_assessment = raw_phoneme.get("PronunciationAssessment", {})
            phoneme_accuracy = _score(phoneme_assessment, "AccuracyScore")
            phonemes.append(
                {
                    "phoneme": raw_phoneme.get("Phoneme", ""),
                    "accuracy": phoneme_accuracy,
                    "bucket": score_bucket(phoneme_accuracy),
                    "offset_ms": _ticks_to_ms(raw_phoneme.get("Offset")),
                    "duration_ms": _ticks_to_ms(raw_phoneme.get("Duration")),
                    "n_best": [
                        {
                            "phoneme": item.get("Phoneme", ""),
                            "score": _score(item, "Score"),
                        }
                        for item in phoneme_assessment.get("NBestPhonemes", [])
                    ],
                }
            )

        words.append(
            {
                "word": raw_word.get("Word", ""),
                "accuracy": word_accuracy,
                "bucket": score_bucket(word_accuracy),
                "error_type": word_assessment.get("ErrorType", "None"),
                "offset_ms": _ticks_to_ms(raw_word.get("Offset")),
                "duration_ms": _ticks_to_ms(raw_word.get("Duration")),
                "phonemes": phonemes,
            }
        )

    return {
        "transcript": raw_result.get("DisplayText", ""),
        "scores": {
            "accuracy": _score(full_assessment, "AccuracyScore"),
            "fluency": _score(full_assessment, "FluencyScore"),
            "completeness": _score(full_assessment, "CompletenessScore"),
            "prosody": _score(full_assessment, "ProsodyScore"),
            "pronunciation": _score(full_assessment, "PronScore"),
        },
        "words": words,
        "raw": raw_result,
    }
