import unittest


class AudioPolicyTests(unittest.TestCase):
    def test_rejects_audio_over_configured_limit(self):
        from app.audio import AudioTooLongError, ensure_audio_duration_allowed

        with self.assertRaises(AudioTooLongError) as context:
            ensure_audio_duration_allowed(duration_seconds=30.25, max_seconds=30)

        self.assertIn("30", str(context.exception))

    def test_accepts_audio_at_configured_limit(self):
        from app.audio import ensure_audio_duration_allowed

        ensure_audio_duration_allowed(duration_seconds=30.0, max_seconds=30)


if __name__ == "__main__":
    unittest.main()


def _make_webm(audio_path, *, live):
    import subprocess

    command = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:a",
        "libopus",
        "-f",
        "webm",
    ]
    if live:
        command.extend(["-live", "1"])
    command.append(str(audio_path))
    subprocess.run(command, check=True, capture_output=True)


def _probe_format(audio_path):
    import json
    import subprocess

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
    return json.loads(result.stdout)["format"]


def test_probe_audio_duration_falls_back_to_packets_for_live_webm(tmp_path):
    import pytest

    from app.audio import probe_audio_duration_seconds

    audio_path = tmp_path / "live.webm"
    _make_webm(audio_path, live=True)

    assert "duration" not in _probe_format(audio_path)
    assert probe_audio_duration_seconds(audio_path) == pytest.approx(2.0, abs=0.1)


def test_probe_audio_duration_uses_container_duration_when_present(tmp_path):
    import subprocess
    from unittest import mock

    import pytest

    from app.audio import probe_audio_duration_seconds

    audio_path = tmp_path / "regular.webm"
    _make_webm(audio_path, live=False)

    assert "duration" in _probe_format(audio_path)
    with mock.patch("app.audio.subprocess.run", wraps=subprocess.run) as run_mock:
        duration = probe_audio_duration_seconds(audio_path)

    assert duration == pytest.approx(2.0, abs=0.1)
    assert run_mock.call_count == 1
