"""Render demo narration with Kokoro-82M (https://huggingface.co/hexgrad/Kokoro-82M).

Usage: python kokoro_tts.py narration.json out_dir [voice] [speed]
narration.json is a list of {"id": str, "text": str}. Writes out_dir/<id>.wav at 24 kHz.
Install: pip install "kokoro>=0.9.4" soundfile
"""

import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline
import misaki.espeak  # noqa: F401  (sets the bundled espeak-ng, overridden below when a system one exists)
from phonemizer.backend.espeak.wrapper import EspeakWrapper

SAMPLE_RATE = 24000

# The pip-bundled espeak-ng on macOS points at its CI build directory for data. Prefer a system install.
for prefix in (os.environ.get("ESPEAK_PREFIX"), "/opt/homebrew", "/usr/local", "/usr"):
    if prefix and Path(prefix, "share/espeak-ng-data").is_dir():
        library = next((p for p in Path(prefix, "lib").glob("libespeak-ng.*") if p.suffix in (".dylib", ".so") or ".so." in p.name), None)
        if library:
            EspeakWrapper.set_library(str(library))
            EspeakWrapper.set_data_path(str(Path(prefix, "share/espeak-ng-data")))
            break


def main() -> None:
    narration = json.loads(Path(sys.argv[1]).read_text())
    out_dir = Path(sys.argv[2])
    voice = sys.argv[3] if len(sys.argv) > 3 else "af_heart"
    speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    out_dir.mkdir(parents=True, exist_ok=True)
    pipeline = KPipeline(lang_code=voice[0], repo_id="hexgrad/Kokoro-82M")
    for step in narration:
        chunks = [audio for _, _, audio in pipeline(step["text"], voice=voice, speed=speed)]
        pause = np.zeros(int(SAMPLE_RATE * 0.25), dtype=np.float32)
        joined = np.concatenate([part for chunk in chunks for part in (np.asarray(chunk, dtype=np.float32), pause)][:-1])
        sf.write(out_dir / f"{step['id']}.wav", joined, SAMPLE_RATE)
        print(f"{step['id']}: {len(joined) / SAMPLE_RATE:.1f}s", flush=True)


if __name__ == "__main__":
    main()
