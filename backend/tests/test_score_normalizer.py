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


if __name__ == "__main__":
    unittest.main()
