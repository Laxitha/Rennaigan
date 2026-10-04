#!/usr/bin/env bash
# One-time setup of the Rennaigan backend on a Colab runtime (or any Debian-like machine).
# Safe to re-run: every step is skipped when its result already exists.
#   bash scripts/colab_setup.sh
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
step() { echo; echo "=== $*"; }

step "System tools"
command -v exiftool >/dev/null || apt-get -qq install -y libimage-exiftool-perl >/dev/null 2>&1
command -v exiftool >/dev/null && echo "exiftool ok" || echo "exiftool MISSING"
# c2patool reads Content Credentials (C2PA provenance). Official build from the Content Authenticity Initiative.
if ! command -v c2patool >/dev/null; then
    C2PA=c2patool-v0.27.22
    wget -q "https://github.com/contentauth/c2pa-rs/releases/download/$C2PA/$C2PA-x86_64-unknown-linux-gnu.tar.gz" -O /tmp/c2patool.tar.gz \
        && tar -xzf /tmp/c2patool.tar.gz -C /tmp && install -m 755 "$(find /tmp -maxdepth 3 -name c2patool -type f | head -1)" /usr/local/bin/c2patool
    rm -f /tmp/c2patool.tar.gz
fi
command -v c2patool >/dev/null && echo "c2patool ok" || echo "c2patool MISSING (optional)"

step "Model repositories"
mkdir -p repos weights/sbi weights/trufor
clone() { [ -d "repos/$1" ] || git clone -q --depth 1 "$2" "repos/$1"; }
clone sbi https://github.com/mapooon/SelfBlendedImages.git
clone trufor https://github.com/grip-unina/TruFor.git
clone lipforensics https://github.com/ahaliassos/LipForensics.git
clone syncnet https://github.com/joonson/syncnet_python.git
ls repos

step "Python packages (image, video, motion, metadata services)"
# pip prints dependency-resolver notes about packages Colab preinstalls and this project does not
# use; they are not failures, so only the import check below is shown.
pip install -q fastapi uvicorn python-multipart httpx pyyaml gdown yacs timm anthropic google-genai transformers \
    efficientnet_pytorch face_alignment scikit-image python_speech_features "scenedetect[opencv]" >/dev/null 2>&1
python -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)" 2>/dev/null \
    && pip install -q onnxruntime-gpu >/dev/null 2>&1 || pip install -q onnxruntime >/dev/null 2>&1
pip install -q insightface >/dev/null 2>&1
pip install -q mediapipe >/dev/null 2>&1
TF_CPP_MIN_LOG_LEVEL=3 python -W ignore - 2>/dev/null <<'PY'
import importlib
for mod in ["efficientnet_pytorch", "transformers", "insightface", "face_alignment", "mediapipe", "scenedetect", "yacs", "anthropic"]:
    try:
        importlib.import_module(mod); print("ok     ", mod)
    except Exception as e:
        print("MISSING", mod, "->", type(e).__name__, str(e)[:120])
PY

step "Model weights"
have() { [ -f "$1" ] && [ "$(stat -c%s "$1")" -gt "$2" ]; }
have weights/sbi/FFc23.tar 50000000 || gdown -q 1X0-NYT8KPursLZZdxduRQju6E52hauV0 -O weights/sbi/FFc23.tar
if ! have weights/trufor/trufor.pth.tar 50000000; then
    wget -q https://www.grip.unina.it/download/prog/TruFor/TruFor_weights.zip -O /tmp/trufor.zip && unzip -q -o /tmp/trufor.zip -d /tmp/trufor_unzipped
    found=$(find /tmp/trufor_unzipped -name trufor.pth.tar | head -1); [ -n "$found" ] && mv "$found" weights/trufor/trufor.pth.tar
fi
have weights/lipforensics_ff.pth 20000000 || gdown -q 1wfZnxZpyNd5ouJs0LjVls7zU0N_W73L7 -O weights/lipforensics_ff.pth
have repos/syncnet/data/syncnet_v2.model 10000000 || (cd repos/syncnet && sh download_model.sh >/dev/null 2>&1)
# Leftovers from earlier versions and from this setup: nothing below is used at run time.
rm -rf /content/audio-env weights/xlsr2_300m.pt weights/best_SSL_model_DF.pth weights/univfd repos/ssl_aasist repos/univfd xlsr2_300m.pt \
       /tmp/aasist_dl /tmp/trufor.zip /tmp/trufor_unzipped repos/syncnet/data/example.avi.bak ~/.cache/pip 2>/dev/null
find repos -maxdepth 2 -name .git -type d -exec rm -rf {} + 2>/dev/null
echo "AI-image and voice models download from Hugging Face when the services start."
echo
for entry in "SBI:weights/sbi/FFc23.tar" "TruFor:weights/trufor/trufor.pth.tar" "LipForensics:weights/lipforensics_ff.pth" \
    "SyncNet:repos/syncnet/data/syncnet_v2.model" "SyncNet-face:repos/syncnet/detectors/s3fd/weights/sfd_face.pth"; do
    name=${entry%%:*}; path=${entry#*:}
    [ -f "$path" ] && echo "ok      $name $(du -h "$path" | cut -f1)" || echo "MISSING $name ($path)"
done
