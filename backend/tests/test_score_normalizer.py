import unittest


class ScoreNormalizerTests(unittest.TestCase):
    def test_normalizes_azure_json_into_stable_frontend_shape(self):
        from app.scoring import normalize_azure_result

        raw_result = {
            "RecognitionStatus": "Success",
            "DisplayText": "Hello world.",
            "NBest": [
                {
                    "PronunciationAssessment": {
                        "AccuracyScore": 82.0,
                        "FluencyScore": 75.0,
                        "CompletenessScore": 100.0,
                        "ProsodyScore": 68.0,
                        "PronScore": 78.0,
                    },
                    "Words": [
                        {
                            "Word": "hello",
                            "Offset": 1_000_000,
                            "Duration": 4_000_000,
                            "PronunciationAssessment": {
                                "AccuracyScore": 92.0,
                                "ErrorType": "None",
                            },
                            "Phonemes": [
                                {
                                    "Phoneme": "h",
                                    "Offset": 1_000_000,
                                    "Duration": 1_000_000,
                                    "PronunciationAssessment": {
                                        "AccuracyScore": 98.0,
                                        "NBestPhonemes": [
                                            {"Phoneme": "h", "Score": 98.0},
                                            {"Phoneme": "k", "Score": 12.0},
                                        ],
                                    },
                                }
                            ],
                        }
                    ],
                }
            ],
        }

        result = normalize_azure_result(raw_result)

        self.assertEqual(result["transcript"], "Hello world.")
        self.assertEqual(result["recognition_status"], "success")
        self.assertEqual(
            result["scores"],
            {
                "accuracy": 82.0,
                "fluency": 75.0,
                "completeness": 100.0,
                "prosody": 68.0,
                "pronunciation": 78.0,
            },
        )
        self.assertEqual(result["words"][0]["word"], "hello")
        self.assertEqual(result["words"][0]["offset_ms"], 100)
        self.assertEqual(result["words"][0]["duration_ms"], 400)
        self.assertEqual(result["words"][0]["accuracy"], 92.0)
        self.assertEqual(result["words"][0]["bucket"], "good")
        self.assertEqual(result["words"][0]["phonemes"][0]["phoneme"], "h")
        self.assertEqual(result["words"][0]["phonemes"][0]["n_best"][1]["phoneme"], "k")

    def test_marks_missing_nbest_as_unscored_result(self):
        from app.scoring import normalize_azure_result

        result = normalize_azure_result({"RecognitionStatus": "NoMatch"})

        self.assertEqual(result["scores"]["pronunciation"], None)
        self.assertEqual(result["words"], [])
        self.assertEqual(result["transcript"], "")
        self.assertEqual(result["recognition_status"], "no_match")

    def test_marks_initial_silence_timeout_as_no_match(self):
        from app.scoring import normalize_azure_result

        result = normalize_azure_result({"RecognitionStatus": "InitialSilenceTimeout"})

        self.assertEqual(result["recognition_status"], "no_match")

    def test_marks_success_status_with_no_recognized_words_as_no_match(self):
        from app.scoring import normalize_azure_result

        raw_result = {
            "RecognitionStatus": "Success",
            "DisplayText": "",
            "NBest": [{"PronunciationAssessment": {}, "Words": []}],
        }

        result = normalize_azure_result(raw_result)

        self.assertEqual(result["recognition_status"], "no_match")

    def test_parses_per_word_prosody_issues_from_feedback(self):
        from app.scoring import normalize_azure_result

        raw_result = {
            "NBest": [
                {
                    "PronunciationAssessment": {},
                    "Words": [
                        {
                            "Word": "quickly",
                            "PronunciationAssessment": {
                                "AccuracyScore": 80.0,
                                "ErrorType": "None",
                                "Feedback": {
                                    "Prosody": {
                                        "Break": {"ErrorTypes": ["UnexpectedBreak"]},
                                        "Intonation": {"ErrorTypes": ["Monotone"]},
                                    },
                                },
                            },
                            "Phonemes": [],
                        },
                        {
                            "Word": "fine",
                            "PronunciationAssessment": {
                                "AccuracyScore": 95.0,
                                "ErrorType": "None",
                            },
                            "Phonemes": [],
                        },
                    ],
                }
            ],
        }

        result = normalize_azure_result(raw_result)

        self.assertEqual(
            sorted(result["words"][0]["prosody_issues"]),
            ["monotone", "unexpected_break"],
        )
        self.assertNotIn("prosody_issues", result["words"][1])

    def test_parses_missing_break_prosody_issue(self):
        from app.scoring import normalize_azure_result

        raw_result = {
            "NBest": [
                {
                    "PronunciationAssessment": {},
                    "Words": [
                        {
                            "Word": "pause",
                            "PronunciationAssessment": {
                                "AccuracyScore": 80.0,
                                "ErrorType": "None",
                                "Feedback": {
                                    "Prosody": {
                                        "Break": {"ErrorTypes": ["MissingBreak"]},
                                    },
                                },
                            },
                            "Phonemes": [],
                        },
                    ],
                }
            ],
        }

        result = normalize_azure_result(raw_result)

        self.assertEqual(result["words"][0]["prosody_issues"], ["missing_break"])

    def test_prosody_issue_parsing_is_fail_soft_against_malformed_feedback(self):
        from app.scoring import normalize_azure_result

        malformed_feedback_shapes = [
            None,
            {},
            {"Prosody": None},
            {"Prosody": {}},
            {"Prosody": {"Break": None}},
            {"Prosody": {"Break": {"ErrorTypes": None}}},
            {"Prosody": {"Break": "not-a-dict"}},
            {"Prosody": {"Intonation": {"ErrorTypes": "not-a-list"}}},
        ]
        for feedback in malformed_feedback_shapes:
            with self.subTest(feedback=feedback):
                raw_result = {
                    "NBest": [
                        {
                            "PronunciationAssessment": {},
                            "Words": [
                                {
                                    "Word": "test",
                                    "PronunciationAssessment": {
                                        "AccuracyScore": 80.0,
                                        "ErrorType": "None",
                                        "Feedback": feedback,
                                    },
                                    "Phonemes": [],
                                }
                            ],
                        }
                    ],
                }

                result = normalize_azure_result(raw_result)

                self.assertNotIn("prosody_issues", result["words"][0])

    def test_normalizes_continuous_results_into_segments_and_overall_scores(self):
        from app.scoring import normalize_continuous_azure_results

        raw_results = [
            {
                "RecognitionStatus": "Success",
                "DisplayText": "Quiet streets.",
                "NBest": [
                    {
                        "PronunciationAssessment": {
                            "AccuracyScore": 80,
                            "FluencyScore": 70,
                            "CompletenessScore": 100,
                            "ProsodyScore": 75,
                            "PronScore": 78,
                        },
                        "Words": [
                            {
                                "Word": "quiet",
                                "Offset": 1_000_000,
                                "Duration": 3_000_000,
                                "PronunciationAssessment": {
                                    "AccuracyScore": 72,
                                    "ErrorType": "None",
                                },
                                "Phonemes": [],
                            }
                        ],
                    }
                ],
            },
            {
                "RecognitionStatus": "Success",
                "DisplayText": "We kept walking.",
                "NBest": [
                    {
                        "PronunciationAssessment": {
                            "AccuracyScore": 90,
                            "FluencyScore": 84,
                            "CompletenessScore": 100,
                            "ProsodyScore": 80,
                            "PronScore": 88,
                        },
                        "Words": [
                            {
                                "Word": "walking",
                                "Offset": 5_000_000,
                                "Duration": 4_000_000,
                                "PronunciationAssessment": {
                                    "AccuracyScore": 92,
                                    "ErrorType": "None",
                                },
                                "Phonemes": [],
                            }
                        ],
                    }
                ],
            },
        ]

        result = normalize_continuous_azure_results(raw_results)

        self.assertEqual(result["transcript"], "Quiet streets. We kept walking.")
        self.assertEqual(result["recognition_status"], "success")
        self.assertEqual(result["scores"]["accuracy"], 85.0)
        self.assertEqual(result["scores"]["fluency"], 77.0)
        self.assertEqual(result["scores"]["pronunciation"], 83.0)
        self.assertEqual([word["word"] for word in result["words"]], ["quiet", "walking"])
        self.assertEqual(len(result["segments"]), 2)
        self.assertEqual(result["segments"][0]["index"], 1)
        self.assertEqual(result["segments"][0]["scores"]["pronunciation"], 78.0)

    def test_marks_continuous_result_as_no_match_when_every_segment_has_no_words(self):
        from app.scoring import normalize_continuous_azure_results

        raw_results = [
            {"RecognitionStatus": "NoMatch", "DisplayText": ""},
            {"RecognitionStatus": "InitialSilenceTimeout", "DisplayText": ""},
        ]

        result = normalize_continuous_azure_results(raw_results)

        self.assertEqual(result["recognition_status"], "no_match")
        self.assertEqual(result["words"], [])

    def test_marks_continuous_result_as_no_match_when_no_segments_at_all(self):
        from app.scoring import normalize_continuous_azure_results

        result = normalize_continuous_azure_results([])

        self.assertEqual(result["recognition_status"], "no_match")
        self.assertEqual(result["words"], [])

    def test_continuous_result_is_success_when_only_some_segments_recognize_words(self):
        from app.scoring import normalize_continuous_azure_results

        raw_results = [
            {"RecognitionStatus": "NoMatch", "DisplayText": ""},
            {
                "RecognitionStatus": "Success",
                "DisplayText": "Walking.",
                "NBest": [
                    {
                        "PronunciationAssessment": {},
                        "Words": [
                            {
                                "Word": "walking",
                                "PronunciationAssessment": {
                                    "AccuracyScore": 92,
                                    "ErrorType": "None",
                                },
                                "Phonemes": [],
                            }
                        ],
                    }
                ],
            },
        ]

        result = normalize_continuous_azure_results(raw_results)

        self.assertEqual(result["recognition_status"], "success")

    def test_weights_continuous_scores_by_segment_word_count(self):
        from app.scoring import normalize_continuous_azure_results

        raw_results = [
            {
                "DisplayText": "Short.",
                "NBest": [
                    {
                        "PronunciationAssessment": {
                            "AccuracyScore": 50,
                            "FluencyScore": 50,
                            "CompletenessScore": 50,
                            "ProsodyScore": 50,
                            "PronScore": 50,
                        },
                        "Words": [
                            {
                                "Word": "short",
                                "PronunciationAssessment": {"AccuracyScore": 50},
                                "Phonemes": [],
                            }
                        ],
                    }
                ],
            },
            {
                "DisplayText": "Much longer segment.",
                "NBest": [
                    {
                        "PronunciationAssessment": {
                            "AccuracyScore": 100,
                            "FluencyScore": 100,
                            "CompletenessScore": 100,
                            "ProsodyScore": 100,
                            "PronScore": 100,
                        },
                        "Words": [
                            {
                                "Word": "much",
                                "PronunciationAssessment": {"AccuracyScore": 100},
                                "Phonemes": [],
                            },
                            {
                                "Word": "longer",
                                "PronunciationAssessment": {"AccuracyScore": 100},
                                "Phonemes": [],
                            },
                            {
                                "Word": "segment",
                                "PronunciationAssessment": {"AccuracyScore": 100},
                                "Phonemes": [],
                            },
                        ],
                    }
                ],
            },
        ]

        result = normalize_continuous_azure_results(raw_results)

        self.assertEqual(result["scores"]["pronunciation"], 87.5)


if __name__ == "__main__":
    unittest.main()
