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
        self.assertEqual(result["scores"]["accuracy"], 85.0)
        self.assertEqual(result["scores"]["fluency"], 77.0)
        self.assertEqual(result["scores"]["pronunciation"], 83.0)
        self.assertEqual([word["word"] for word in result["words"]], ["quiet", "walking"])
        self.assertEqual(len(result["segments"]), 2)
        self.assertEqual(result["segments"][0]["index"], 1)
        self.assertEqual(result["segments"][0]["scores"]["pronunciation"], 78.0)


if __name__ == "__main__":
    unittest.main()
