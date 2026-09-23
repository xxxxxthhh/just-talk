import json
import subprocess
import wave
from pathlib import Path

TARGET_SAMPLE_RATE = 16_000
TARGET_BYTES_PER_SECOND = TARGET_SAMPLE_RATE * 2  # mono, 16-bit
DECODE_TIMEOUT_SECONDS = 30
# Containers browsers record (webm/opus, mp4/aac) plus plain audio files. Anything
# else (playlists, concat lists, images) is rejected before decoding, which also
# keeps ffmpeg from following references to other files or URLs.
ALLOWED_INPUT_FORMATS = "matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,wav,ogg,mp3,aac"


class AudioTooLongError(ValueError):
    """Raised when an uploaded recording exceeds the configured MVP limit."""


class AudioTooShortError(ValueError):
    """Raised when a decoded recording is too short to be worth scoring."""


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


def decode_to_wav_16k_mono(
    input_path: Path,
    output_path: Path,
    *,
    max_seconds: float,
    timeout_seconds: float = DECODE_TIMEOUT_SECONDS,
) -> float:
    """Decode an upload to 16 kHz mono WAV and return its real duration.

    The duration comes from the decoded frames rather than container metadata,
    which the uploader controls. Decoding stops one second past the limit
    (``-t``), the output file is size-capped (``-fs``), and the process is
    killed after ``timeout_seconds``, so a hostile upload can't make the
    decoder run or write without bound.
    """
    decode_seconds = max_seconds + 1
    max_output_bytes = int(TARGET_BYTES_PER_SECOND * decode_seconds) + 4096
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            ALLOWED_INPUT_FORMATS,
            "-i",
            str(input_path),
            "-vn",
            "-t",
            f"{decode_seconds:g}",
            "-ac",
            "1",
            "-ar",
            str(TARGET_SAMPLE_RATE),
            "-sample_fmt",
            "s16",
            "-f",
            "wav",
            "-fs",
            str(max_output_bytes),
            str(output_path),
        ],
        check=True,
        capture_output=True,
        timeout=timeout_seconds,
    )
    return wav_duration_seconds(output_path)


def wav_duration_seconds(wav_path: Path) -> float:
    try:
        with wave.open(str(wav_path), "rb") as wav_file:
            frame_rate = wav_file.getframerate()
            frame_bytes = wav_file.getsampwidth() * wav_file.getnchannels()
            frames = wav_file.getnframes()
    except (wave.Error, EOFError, OSError) as exc:
        raise ValueError("Decoded audio is not a readable WAV file.") from exc
    if frame_rate <= 0 or frame_bytes <= 0:
        raise ValueError("Decoded audio has an invalid format.")
    # Never trust a header that claims more frames than the file holds.
    frames = min(frames, wav_path.stat().st_size // frame_bytes)
    return frames / frame_rate
