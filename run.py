#!/usr/bin/env python3
"""CLI entrypoint: python run.py <module> <file>

Examples:
  python run.py image photo.jpg
  python run.py video clip.mp4
  python run.py audio voice.wav
  python run.py metadata file.mp4
"""

import json
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    module_name = sys.argv[1]
    file_path = Path(sys.argv[2])

    if not file_path.exists():
        print(f"File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    if module_name == "image":
        from image.app import analyze
    elif module_name == "video":
        from video.app import analyze
    elif module_name == "audio":
        from audio.app import analyze
    elif module_name == "metadata":
        from metadata.app import analyze
    else:
        print(f"Unknown module: {module_name}", file=sys.stderr)
        print("Choose from: image, video, audio, metadata")
        sys.exit(1)

    result = analyze(file_path)
    print(json.dumps(result.model_dump(), indent=2))


if __name__ == "__main__":
    main()
