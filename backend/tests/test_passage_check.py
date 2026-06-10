import json
import unittest
from unittest import mock

from app.config import Settings
from app.passage import check_passage

SETTINGS = Settings(llm_base_url="http://example.test", llm_api_key="test-key")


def fake_urlopen_response(payload: dict) -> mock.MagicMock:
    response = mock.MagicMock()
    response.read.return_value = json.dumps(payload).encode("utf-8")
    response.__enter__.return_value = response
    return response


class PassageCheckTests(unittest.TestCase):
    def test_returns_parsed_issues_payload(self):
        payload = {
            "choices": [
                {"message": {"content": json.dumps({"issues": []})}}
            ]
        }
        with mock.patch(
            "app.passage.urllib.request.urlopen",
            return_value=fake_urlopen_response(payload),
        ):
            result = check_passage(SETTINGS, "A clear morning.")

        self.assertEqual(result, {"issues": []})

    def test_non_json_response_body_raises_runtime_error(self):
        response = mock.MagicMock()
        response.read.return_value = b"<html>Bad gateway</html>"
        response.__enter__.return_value = response
        with mock.patch("app.passage.urllib.request.urlopen", return_value=response):
            with self.assertRaises(RuntimeError):
                check_passage(SETTINGS, "A clear morning.")

    def test_non_json_content_raises_runtime_error(self):
        payload = {"choices": [{"message": {"content": "Sorry, I cannot help."}}]}
        with mock.patch(
            "app.passage.urllib.request.urlopen",
            return_value=fake_urlopen_response(payload),
        ):
            with self.assertRaises(RuntimeError):
                check_passage(SETTINGS, "A clear morning.")

    def test_missing_choices_raises_runtime_error(self):
        with mock.patch(
            "app.passage.urllib.request.urlopen",
            return_value=fake_urlopen_response({"error": "rate limited"}),
        ):
            with self.assertRaises(RuntimeError):
                check_passage(SETTINGS, "A clear morning.")

    def test_non_object_json_content_raises_runtime_error(self):
        payload = {"choices": [{"message": {"content": json.dumps(["not", "a", "dict"])}}]}
        with mock.patch(
            "app.passage.urllib.request.urlopen",
            return_value=fake_urlopen_response(payload),
        ):
            with self.assertRaises(RuntimeError):
                check_passage(SETTINGS, "A clear morning.")
