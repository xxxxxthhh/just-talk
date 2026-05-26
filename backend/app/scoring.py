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


def normalize_continuous_azure_results(raw_results: list[dict[str, Any]]) -> dict[str, Any]:
    segments = []
    words = []
    transcripts = []

    for index, raw_result in enumerate(raw_results, start=1):
        normalized = normalize_azure_result(raw_result)
        segment = {
            "index": index,
            "transcript": normalized["transcript"],
            "scores": normalized["scores"],
            "words": normalized["words"],
        }
        segments.append(segment)
        words.extend(normalized["words"])
        if normalized["transcript"]:
            transcripts.append(normalized["transcript"])

    return {
        "transcript": " ".join(transcripts),
        "scores": {
            "accuracy": _average_segment_score(segments, "accuracy"),
            "fluency": _average_segment_score(segments, "fluency"),
            "completeness": _average_segment_score(segments, "completeness"),
            "prosody": _average_segment_score(segments, "prosody"),
            "pronunciation": _average_segment_score(segments, "pronunciation"),
        },
        "words": words,
        "segments": segments,
        "raw": {"segments": raw_results},
    }


def _average_segment_score(
    segments: list[dict[str, Any]],
    score_name: str,
) -> float | None:
    weighted_values = [
        (
            segment["scores"][score_name],
            max(len(segment.get("words", [])), 1),
        )
        for segment in segments
        if segment["scores"].get(score_name) is not None
    ]
    if not weighted_values:
        return None
    total_weight = sum(weight for _, weight in weighted_values)
    return round(
        sum(value * weight for value, weight in weighted_values) / total_weight,
        2,
    )
