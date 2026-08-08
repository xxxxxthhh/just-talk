from typing import Any

AZURE_TICKS_PER_MILLISECOND = 10_000
NO_MATCH_RECOGNITION_STATUSES = {"NoMatch", "InitialSilenceTimeout"}


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


def _prosody_issues(word_assessment: dict[str, Any]) -> list[str]:
    """Best-effort parse of Feedback.Prosody error types.

    Azure's Feedback.Prosody shape varies across API versions and can be
    missing, null, or malformed. This is supplementary feedback, so any
    unexpected shape yields no issues rather than raising.
    """
    try:
        feedback = word_assessment.get("Feedback") or {}
        prosody = feedback.get("Prosody") or {}
        break_errors = (prosody.get("Break") or {}).get("ErrorTypes") or []
        intonation_errors = (prosody.get("Intonation") or {}).get("ErrorTypes") or []
        issues = []
        if "UnexpectedBreak" in break_errors:
            issues.append("unexpected_break")
        if "MissingBreak" in break_errors:
            issues.append("missing_break")
        if "Monotone" in intonation_errors:
            issues.append("monotone")
        return issues
    except (AttributeError, TypeError):
        return []


def normalize_azure_result(raw_result: dict[str, Any]) -> dict[str, Any]:
    nbest = raw_result.get("NBest")
    best = nbest[0] if nbest else {}
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

        word_entry = {
            "word": raw_word.get("Word", ""),
            "accuracy": word_accuracy,
            "bucket": score_bucket(word_accuracy),
            "error_type": word_assessment.get("ErrorType", "None"),
            "offset_ms": _ticks_to_ms(raw_word.get("Offset")),
            "duration_ms": _ticks_to_ms(raw_word.get("Duration")),
            "phonemes": phonemes,
        }
        prosody_issues = _prosody_issues(word_assessment)
        if prosody_issues:
            word_entry["prosody_issues"] = prosody_issues
        words.append(word_entry)

    # No-match covers every empty-recognition shape: an explicit Azure
    # NoMatch/InitialSilenceTimeout status, or a result where no words were
    # actually recognized (including a missing/empty NBest).
    recognition_status = (
        "no_match"
        if raw_result.get("RecognitionStatus") in NO_MATCH_RECOGNITION_STATUSES or not words
        else "success"
    )

    return {
        "transcript": raw_result.get("DisplayText", ""),
        "recognition_status": recognition_status,
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
        # No-match when zero words were recognized across every segment
        # (including zero segments at all); mirrors normalize_azure_result
        # so main.py's skip-persist guard applies uniformly to long mode.
        "recognition_status": "success" if words else "no_match",
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
