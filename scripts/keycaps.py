"""Build the embedded keycap bank from the pinned CC0 keyboard recordings."""

import array
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import urllib.request
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://opengameart.org/sites/default/files/unicae_games_keyboard_soundpack_1_0.zip"
PAGE = "https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes"
SHA256 = "935eae2fa5c3742eacdd38c4ea0e9047f3887faa0701996498492c256db1b351"
RATE = 22050
KEYS = [2, 5, 8, 10, 11, 14, 24, 26]


def rms(samples):
    return math.sqrt(sum(x * x for x in samples) / len(samples))


def segment(samples, start, seconds, level):
    data = samples[start : start + round(seconds * 44100)]
    # Two gentle poles before downsampling retain the key body, not room hiss.
    alpha = 1 - math.exp(-2 * math.pi * 7500 / 44100)
    low = smooth = 0
    filtered = []
    for x in data:
        low += alpha * (x - low)
        smooth += alpha * (low - smooth)
        filtered.append(smooth)
    data = [(filtered[i] + filtered[i + 1]) / 2 for i in range(0, len(filtered) - 1, 2)]
    dc = sum(data) / len(data)
    data = [x - dc for x in data]
    gain = min(level / rms(data), 0.72 / max(abs(x) for x in data))
    fade_in, fade_out = round(RATE * 0.0007), round(RATE * 0.009)
    pcm = array.array("h", [
        round(x * gain * min(1, i / fade_in, (len(data) - 1 - i) / fade_out) * 32767)
        for i, x in enumerate(data)
    ])
    if sys.byteorder != "little":
        pcm.byteswap()
    return base64.b64encode(pcm.tobytes()).decode("ascii")


raw = Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else urllib.request.urlopen(SOURCE).read()
if hashlib.sha256(raw).hexdigest() != SHA256:
    raise ValueError("The source archive changed; inspect its provenance before rebuilding.")
bank = []
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    for key in KEYS:
        name = f"Single Keys/keypress-{key:03}.wav"
        with wave.open(io.BytesIO(archive.read(name))) as clip:
            assert (clip.getnchannels(), clip.getsampwidth(), clip.getframerate()) == (1, 2, 44100)
            pcm = array.array("h", clip.readframes(clip.getnframes()))
            if sys.byteorder != "little":
                pcm.byteswap()
        samples = [x / 32768 for x in pcm]
        # Remove lead-in and separate the natural downstroke and return contact.
        step = 44
        windows = [rms(samples[i : i + step]) for i in range(0, len(samples) - step, step)]
        onset = next(i for i, x in enumerate(windows) if x > max(windows) * 0.16)
        down = max(0, (onset - 2) * step)
        after = onset + 55
        up = max(range(after, min(len(windows), onset + 165)), key=lambda i: windows[i])
        bank.append({
            "source": name,
            "press": segment(samples, down, 0.055, 0.075),
            "release": segment(samples, max(0, (up - 2) * step), 0.045, 0.055),
        })
out = ROOT / "src/audio/keycaps.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({
    "sampleRate": RATE,
    "author": "unicae_games",
    "license": "CC0-1.0",
    "source": PAGE,
    "sourceSha256": SHA256,
    "keys": bank,
}, indent=2) + "\n", encoding="utf-8")
print(f"Built {len(bank)} recorded key pairs: {out.stat().st_size} bytes")
