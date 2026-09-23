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
    duration = payload["format"].get("duration")
    if duration is not None:
        return float(duration)

    packet_result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_packets",
            "-of",
            "csv=p=0",
            "-show_entries",
            "packet=pts_time,duration_time",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    packet_end_times = []
    for line in packet_result.stdout.splitlines():
        fields = line.split(",", 2)
        if len(fields) < 2 or not fields[0] or not fields[1]:
            continue
        try:
            packet_end_times.append(float(fields[0]) + float(fields[1]))
        except ValueError:
            continue

    if not packet_end_times:
        raise ValueError("Could not determine audio duration from packets.")
    return max(packet_end_times)


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
