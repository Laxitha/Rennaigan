# Rennaigan ML Detectors — Setup Guide

## Architecture

Each module is an independent FastAPI microservice:

| Module | Port | Endpoint | Models |
|--------|------|----------|--------|
| Image | 8001 | POST /analyze | SBI (face swap), AI-generated detection (two Hugging Face classifiers), TruFor (splicing) |
| Video | 8002 | POST /analyze | SBI frame scoring, LipForensics, SyncNet |
| Audio | 8003 | POST /analyze | synthetic-voice classifier (Hugging Face), ECAPA-TDNN (speaker verify) |
| Metadata | 8004 | POST /analyze | Rule-based (exiftool, ffprobe, c2patool) |
| Motion | 8005 | POST /analyze | RAFT optical flow, head pose, smoothness, identity drift, blink |

All services expose:
- `POST /analyze` — accepts multipart file upload, returns `ModuleResult` JSON
- `GET /health` — returns `{"status": "ok"}`

## Backend gateway (what the UI talks to)

```bash
pip install fastapi uvicorn python-multipart httpx pyyaml numpy Pillow opencv-python-headless
python start.py                      # detectors on 8001-8005, gateway on http://127.0.0.1:8010
cd frontend/rennaigan && npm install && npm run dev     # UI on http://localhost:5173
```

`start.py` starts every detector service it can and then the gateway. A detector whose
dependencies or weights are missing is reported as unavailable and is left out of the trust
score; it never counts as "clean". If a detector port is taken by another program, the
service moves to a free port automatically. Needs `ffmpeg`, `ffprobe` and `exiftool` on PATH.

| Endpoint | Purpose |
|----------|---------|
| `POST /analyze` (multipart `file`, `mode`) | Analyse one file, returns the sealed case |
| `POST /bulk` (multipart `files`) | Analyse up to 20 files as one batch |
| `GET /cases`, `GET /cases/{id}`, `DELETE /cases/{id}` | Case list, full case, delete |
| `POST /cases/{id}/review` | Record an analyst decision |
| `POST /cases/{id}/dissect`, `GET /cases/{id}/frames/zip` | Frame-by-frame extraction of a video |
| `GET /cases/{id}/audit/verify`, `GET /audit/verify` | Recompute the audit hash chain (one case, whole ledger) |
| `GET /media/{id}`, `GET /artifacts/{id}/{file}` | Original upload, heatmaps, spectrograms, frames |
| `GET /health`, `GET /info` | Detector status, configuration |
| `GET /rag/status`, `POST /rag/query` | Keyword retrieval over stored findings |

Interactive API docs: http://127.0.0.1:8010/docs. Settings live in the `gateway:` and
`services:` sections of `config.yaml`. Cases, uploads and the audit ledger are stored in
`data/`; `data/ledger.key` signs the ledger and should be backed up and kept private.

The gateway has no login. It listens on 127.0.0.1 only; put authentication in front of it
before exposing it with `--host 0.0.0.0` or a tunnel. To allow a hosted UI, add its origin to
`gateway.cors_origins`.

Tests: `python -m pytest tests -q`

## Running the detectors on Google Colab

The models need a GPU and several GB of weights. `rennaigan_colab.ipynb` sets all of it up on a
free Colab T4: open the notebook in Colab, choose **Runtime → Change runtime type → T4 GPU**,
then **Run all**. It installs the detectors, downloads the weights, starts the backend, runs a
self-test that reports each detector separately, and prints a public `trycloudflare.com`
address. Paste that address into the UI under **Settings → ML Gateway**; the UI itself keeps
running on your own machine with `npm run dev`.

## Quick Start (Metadata only — no GPU needed)

```bash
pip install fastapi uvicorn pydantic
# Install system tools: brew install exiftool ffmpeg
python -m metadata.app  # → http://localhost:8004
```

## Full Setup

### 1. Clone Repos

```bash
mkdir -p repos
git clone https://github.com/mapooon/selfblendedimages.git repos/sbi
git clone https://github.com/grip-unina/TruFor.git repos/trufor
git clone https://github.com/ahaliassos/LipForensics.git repos/lipforensics
git clone https://github.com/joonson/syncnet_python.git repos/syncnet
git clone https://github.com/TakHemlata/SSL_Anti-spoofing.git repos/ssl_aasist
```

### 2. Download Weights

```bash
mkdir -p weights/sbi weights/trufor

# SBI — EfficientNet-B4 face swap detector
# Download FFc23.tar from SBI repo releases → weights/sbi/FFc23.tar

# AI-generated image detectors download from Hugging Face on first use (pip install transformers)

# TruFor — splicing detector
# Download trufor.pth.tar from TruFor repo → weights/trufor/trufor.pth.tar

# LipForensics — lip-based deepfake detector
# Download lipforensics_ff.pth from LipForensics → weights/lipforensics_ff.pth

# SyncNet — lip sync checker
cd repos/syncnet && sh download_model.sh && cd ../..

# SSL-AASIST — voice deepfake detector
wget -P weights/ https://dl.fbaipublicfiles.com/fairseq/wav2vec/xlsr2_300m.pt
# Download best_SSL_model_DF.pth from Google Drive → weights/best_SSL_model_DF.pth

# ECAPA — auto-downloads from SpeechBrain on first run
```

### 3. Install Dependencies

Each module can run in its own conda env (recommended for audio which needs PyTorch 1.8):

**Image module:**
```bash
pip install torch torchvision efficientnet_pytorch transformers \
  opencv-python-headless Pillow insightface onnxruntime-gpu \
  pytorch-grad-cam fastapi uvicorn pydantic numpy
```

**Video module:**
```bash
pip install torch torchvision opencv-python-headless face_alignment \
  fastapi uvicorn pydantic numpy
```

**Audio module (needs Python 3.7 + PyTorch 1.8 for SSL-AASIST):**
```bash
conda create -n tf-audio python=3.7 -y
conda activate tf-audio
pip install torch==1.8.1+cu111 -f https://download.pytorch.org/whl/torch_stable.html
cd repos/ssl_aasist/fairseq-a54021305d6b3c4c5959ac9395135f63202db8f1
pip install --editable ./
cd ../../..
pip install soundfile librosa speechbrain fastapi uvicorn pydantic numpy
```

**Metadata module (no ML deps):**
```bash
pip install fastapi uvicorn pydantic
# System: exiftool, ffprobe (from ffmpeg), c2patool (optional)
```

**Motion module:**
```bash
pip install torch torchvision opencv-python-headless mediapipe \
  insightface onnxruntime-gpu scipy fastapi uvicorn pydantic numpy
```

### 4. Run Services

Individual:
```bash
python -m image.app    # :8001
python -m video.app    # :8002
python -m audio.app    # :8003
python -m metadata.app # :8004
python -m motion.app   # :8005
```

Docker:
```bash
docker-compose up --build
```

CLI (for testing):
```bash
python run.py image photo.jpg
python run.py video clip.mp4
python run.py audio voice.wav
python run.py metadata file.mp4
python run.py motion clip.mp4
```

## API Contract

All modules return the same `ModuleResult` JSON:

```json
{
  "module": "image",
  "file_sha256": "abc123...",
  "findings": [
    {
      "model": "sbi",
      "score": 0.87,
      "start": null,
      "end": null,
      "region": [100, 50, 200, 200],
      "note": "face_swap_detection"
    }
  ],
  "artifacts": {"heatmap": "/path/to/heatmap.png"},
  "weights_sha256": {"sbi": "..."},
  "runtime_s": 2.34
}
```

## Integration

The backend calls each service via HTTP:

```python
import httpx

async with httpx.AsyncClient() as client:
    with open("suspect.mp4", "rb") as f:
        resp = await client.post(
            "http://localhost:8001/analyze",
            files={"file": ("suspect.mp4", f)},
            timeout=300,
        )
    result = resp.json()
```

Or use `orchestrator.py` which calls all running services and fuses results:

```python
from orchestrator import analyze_media
result = await analyze_media("suspect.mp4", mode="public")
```
