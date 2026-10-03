#!/usr/bin/env python3
"""Automated Model Weights Downloader for Rennaigan ML Detectors."""

import os
import sys
import urllib.request
from pathlib import Path

WEIGHTS_DIR = Path("weights")
WEIGHTS_DIR.mkdir(exist_ok=True)
(WEIGHTS_DIR / "sbi").mkdir(exist_ok=True)
(WEIGHTS_DIR / "univfd").mkdir(exist_ok=True)
(WEIGHTS_DIR / "trufor").mkdir(exist_ok=True)

WEIGHT_URLS = {
    # Fairseq Wav2Vec 2.0 300M model for SSL-AASIST audio detector
    "xlsr2_300m.pt": "https://dl.fbaipublicfiles.com/fairseq/wav2vec/xlsr2_300m.pt",
}

def download_file(url: str, dest_path: Path):
    if dest_path.exists() and dest_path.stat().st_size > 0:
        print(f"✅ {dest_path.name} already exists. Skipping download.")
        return

    print(f"⏳ Downloading {dest_path.name} from {url}...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(dest_path, "wb") as f:
            total_size = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            block_size = 8192 * 16
            while True:
                buffer = resp.read(block_size)
                if not buffer:
                    break
                downloaded += len(buffer)
                f.write(buffer)
                if total_size > 0:
                    percent = (downloaded / total_size) * 100
                    sys.stdout.write(f"\r progress: {percent:.1f}% ({downloaded // (1024*1024)}MB / {total_size // (1024*1024)}MB)")
                    sys.stdout.flush()
            print(f"\n✅ Finished downloading {dest_path.name}")
    except Exception as e:
        print(f"\n❌ Error downloading {dest_path.name}: {e}")

def main():
    print("🚀 Starting Rennaigan weights setup...")
    for filename, url in WEIGHT_URLS.items():
        download_file(url, WEIGHTS_DIR / filename)
    print("✨ Weight download step finished!")

if __name__ == "__main__":
    main()
