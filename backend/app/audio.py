import json
import subprocess
from pathlib import Path


class AudioTooLongError(ValueError):
    """Raised when an uploaded recording exceeds the configured MVP limit."""


def ensure_audio_duration_allowed(duration_seconds: float, max_seconds: int) -> None:
    if duration_seconds > max_seconds:
        raise AudioTooLongError(
            f"Audio is {duration_seconds:.2f}s, but the current limit is {max_seconds}s."
        )


def probe_audio_duration_seconds(audio_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    return float(payload["format"]["duration"])


def convert_to_wav_16k_mono(input_path: Path, output_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-sample_fmt",
            "s16",
            str(output_path),
        ],
        check=True,
        capture_output=True,
    )
