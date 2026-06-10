import json
import urllib.error
import urllib.request

from .config import Settings

MAX_PASSAGE_CHARS = 600

_SYSTEM_PROMPT = (
    "You create short pronunciation drill passages for English learners. "
    "Return only JSON with title, passage, and focus_words. "
    "The passage must be 3 to 5 sentences of everyday English, 40 to 70 words, "
    "packed with words whose sound (not spelling) contains the target phoneme. "
    "The passage must read as natural speech: never mention phonetics, sounds, "
    "IPA symbols, or the drill itself. "
    "focus_words lists those words in order of appearance. "
    "title is a short playful name for the drill."
)


def generate_drill(
    settings: Settings, phoneme: str, seed_words: list[str] | None = None
) -> dict:
    if not settings.passage_check_configured:
        raise RuntimeError("Drill generation is not configured.")

    user_content = f"Target phoneme: /{phoneme}/ (IPA). Generate the drill."
    if seed_words:
        joined = ", ".join(seed_words)
        user_content += (
            f" The learner struggled with these words: {joined}."
            " Build the passage around these exact words plus other common words"
            " that contain the same sound."
        )
    payload = {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
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
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Drill generation request failed: {exc}") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RuntimeError("Drill generation returned an invalid response.") from exc

    try:
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Drill generation returned an invalid response.") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Drill generation returned an invalid response.")
    return _validate_drill(parsed, phoneme)


def _validate_drill(parsed: dict, phoneme: str) -> dict:
    passage = parsed.get("passage")
    if not isinstance(passage, str) or not passage.strip():
        raise RuntimeError("Drill generation returned no passage.")
    passage = passage.strip()
    if len(passage) > MAX_PASSAGE_CHARS:
        raise RuntimeError("Drill generation returned an oversized passage.")

    title = parsed.get("title")
    if not isinstance(title, str) or not title.strip():
        title = f"/{phoneme}/ drill"

    focus_words = parsed.get("focus_words", [])
    if not isinstance(focus_words, list) or not all(
        isinstance(word, str) for word in focus_words
    ):
        raise RuntimeError("Drill generation returned invalid focus words.")

    return {"title": title.strip(), "passage": passage, "focus_words": focus_words}
