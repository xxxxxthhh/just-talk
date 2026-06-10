import json
import urllib.error
import urllib.request

from .config import Settings


def check_passage(settings: Settings, text: str) -> dict:
    if not settings.passage_check_configured:
        raise RuntimeError("Passage check is not configured.")

    payload = {
        "model": settings.llm_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Review the user's English passage for grammar errors and "
                    "unnatural word choices. Return only JSON with an issues array. "
                    "Each issue must have span, problem, suggestion, and explanation."
                ),
            },
            {"role": "user", "content": text},
        ],
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        settings.llm_base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.llm_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Passage check request failed: {exc}") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RuntimeError("Passage check returned an invalid response.") from exc

    try:
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Passage check returned an invalid response.") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Passage check returned an invalid response.")
    return parsed
