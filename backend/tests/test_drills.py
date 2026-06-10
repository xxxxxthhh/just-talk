import json
import unittest
from unittest import mock

from app.config import Settings
from app.drills import generate_drill

SETTINGS = Settings(llm_base_url="http://example.test", llm_api_key="test-key")

VALID_DRILL = {
    "title": "Thirty Thankful Thinkers",
    "passage": "Think about three things. Both brothers thought through the theory together.",
    "focus_words": ["think", "three", "things", "both", "thought", "theory"],
}


def fake_urlopen_response(payload: dict) -> mock.MagicMock:
    response = mock.MagicMock()
    response.read.return_value = json.dumps(payload).encode("utf-8")
    response.__enter__.return_value = response
    return response


def chat_payload(content: object) -> dict:
    if not isinstance(content, str):
        content = json.dumps(content)
    return {"choices": [{"message": {"content": content}}]}


class GenerateDrillTests(unittest.TestCase):
    def test_returns_validated_drill(self):
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(VALID_DRILL)),
        ):
            result = generate_drill(SETTINGS, "θ")

        self.assertEqual(result, VALID_DRILL)

    def test_request_targets_configured_endpoint_and_phoneme(self):
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(VALID_DRILL)),
        ) as urlopen:
            generate_drill(SETTINGS, "θ")

        request = urlopen.call_args[0][0]
        self.assertEqual(request.full_url, "http://example.test/chat/completions")
        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertIn("θ", body["messages"][1]["content"])

    def test_seed_words_are_included_in_prompt(self):
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(VALID_DRILL)),
        ) as urlopen:
            generate_drill(SETTINGS, "ɪ", seed_words=["sit", "big", "little"])

        request = urlopen.call_args[0][0]
        user_content = json.loads(request.data.decode("utf-8"))["messages"][1]["content"]
        for word in ["sit", "big", "little"]:
            self.assertIn(word, user_content)

    def test_no_seed_words_omits_seed_instruction(self):
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(VALID_DRILL)),
        ) as urlopen:
            generate_drill(SETTINGS, "θ")

        user_content = json.loads(urlopen.call_args[0][0].data.decode("utf-8"))["messages"][1][
            "content"
        ]
        self.assertNotIn("struggled", user_content)

    def test_not_configured_raises_runtime_error(self):
        with self.assertRaises(RuntimeError):
            generate_drill(Settings(), "θ")

    def test_non_json_content_raises_runtime_error(self):
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload("Sorry, I cannot help.")),
        ):
            with self.assertRaises(RuntimeError):
                generate_drill(SETTINGS, "θ")

    def test_missing_passage_raises_runtime_error(self):
        drill = {"title": "No passage", "focus_words": ["think"]}
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(drill)),
        ):
            with self.assertRaises(RuntimeError):
                generate_drill(SETTINGS, "θ")

    def test_oversized_passage_raises_runtime_error(self):
        drill = dict(VALID_DRILL, passage="think " * 150)
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(drill)),
        ):
            with self.assertRaises(RuntimeError):
                generate_drill(SETTINGS, "θ")

    def test_focus_words_not_list_of_strings_raises_runtime_error(self):
        drill = dict(VALID_DRILL, focus_words="think, three")
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(drill)),
        ):
            with self.assertRaises(RuntimeError):
                generate_drill(SETTINGS, "θ")

    def test_missing_title_defaults_to_phoneme_title(self):
        drill = {"passage": VALID_DRILL["passage"], "focus_words": VALID_DRILL["focus_words"]}
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(drill)),
        ):
            result = generate_drill(SETTINGS, "θ")

        self.assertEqual(result["title"], "/θ/ drill")

    def test_missing_focus_words_defaults_to_empty_list(self):
        drill = {"title": "Theta time", "passage": VALID_DRILL["passage"]}
        with mock.patch(
            "app.drills.urllib.request.urlopen",
            return_value=fake_urlopen_response(chat_payload(drill)),
        ):
            result = generate_drill(SETTINGS, "θ")

        self.assertEqual(result["focus_words"], [])
