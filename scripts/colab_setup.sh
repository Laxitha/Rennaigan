#!/usr/bin/env bash
# One-time setup of the Rennaigan backend on a Colab runtime (or any Debian-like machine).
# Safe to re-run: every step is skipped when its result already exists.
#   bash scripts/colab_setup.sh
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
AUDIO_ENV=${AUDIO_ENV:-/content/audio-env}
step() { echo; echo "=== $*"; }

step "System tools"
command -v exiftool >/dev/null || apt-get -qq install -y libimage-exiftool-perl >/dev/null 2>&1
command -v exiftool >/dev/null && echo "exiftool ok" || echo "exiftool MISSING"

step "Model repositories"
mkdir -p repos weights/sbi weights/trufor
clone() { [ -d "repos/$1" ] || git clone -q --depth 1 "$2" "repos/$1"; }
clone sbi https://github.com/mapooon/SelfBlendedImages.git
clone trufor https://github.com/grip-unina/TruFor.git
clone lipforensics https://github.com/ahaliassos/LipForensics.git
clone syncnet https://github.com/joonson/syncnet_python.git
clone ssl_aasist https://github.com/TakHemlata/SSL_Anti-spoofing.git
ls repos

step "Python packages (image, video, motion, metadata services)"
pip install -q fastapi uvicorn python-multipart httpx pyyaml gdown yacs timm anthropic transformers \
    efficientnet_pytorch face_alignment scikit-image python_speech_features "scenedetect[opencv]" 2>&1 | tail -2
python -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)" \
    && pip install -q onnxruntime-gpu 2>&1 | tail -1 || pip install -q onnxruntime 2>&1 | tail -1
pip install -q insightface 2>&1 | tail -2
pip install -q mediapipe 2>&1 | tail -2
python - <<'PY'
import importlib
for mod in ["efficientnet_pytorch", "transformers", "insightface", "face_alignment", "mediapipe", "scenedetect", "yacs", "anthropic"]:
    try:
        importlib.import_module(mod); print("ok     ", mod)
    except Exception as e:
        print("MISSING", mod, "->", type(e).__name__, str(e)[:120])
PY

step "Separate Python 3.10 environment for the voice detector (its fairseq version needs it)"
FAIRSEQ="$ROOT/repos/ssl_aasist/fairseq-a54021305d6b3c4c5959ac9395135f63202db8f1"
if [ ! -x "$AUDIO_ENV/bin/python" ]; then
    command -v uv >/dev/null || pip install -q uv
    uv venv -q "$AUDIO_ENV" --python 3.10 --seed
    # pip 24.0: later versions reject the old omegaconf/hydra metadata this fairseq commit needs
    "$AUDIO_ENV/bin/python" -m pip install -q "pip==24.0" "setuptools<70" wheel cython "numpy==1.23.5" 2>&1 | tail -1
    if python -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)"; then INDEX=cu121; else INDEX=cpu; fi
    "$AUDIO_ENV/bin/pip" install -q torch==2.1.2 torchaudio==2.1.2 --index-url "https://download.pytorch.org/whl/$INDEX" 2>&1 | tail -1
    (cd "$FAIRSEQ" && "$AUDIO_ENV/bin/pip" install -q --editable ./ 2>&1 | tail -3)
    "$AUDIO_ENV/bin/pip" install -q "numpy==1.23.5" soundfile librosa matplotlib fastapi uvicorn python-multipart pydantic pyyaml 2>&1 | tail -1
fi
"$AUDIO_ENV/bin/python" -c "import fairseq, torch, soundfile, librosa, fastapi; print('voice env ok: torch', torch.__version__, 'cuda', torch.cuda.is_available())" 2>&1 | tail -2

step "Model weights"
have() { [ -f "$1" ] && [ "$(stat -c%s "$1")" -gt "$2" ]; }
have weights/sbi/FFc23.tar 50000000 || gdown -q 1X0-NYT8KPursLZZdxduRQju6E52hauV0 -O weights/sbi/FFc23.tar
if ! have weights/trufor/trufor.pth.tar 50000000; then
    wget -q https://www.grip.unina.it/download/prog/TruFor/TruFor_weights.zip -O /tmp/trufor.zip && unzip -q -o /tmp/trufor.zip -d /tmp/trufor_unzipped
    found=$(find /tmp/trufor_unzipped -name trufor.pth.tar | head -1); [ -n "$found" ] && mv "$found" weights/trufor/trufor.pth.tar
fi
have weights/lipforensics_ff.pth 20000000 || gdown -q 1wfZnxZpyNd5ouJs0LjVls7zU0N_W73L7 -O weights/lipforensics_ff.pth
have repos/syncnet/data/syncnet_v2.model 10000000 || (cd repos/syncnet && sh download_model.sh >/dev/null 2>&1)
have weights/xlsr2_300m.pt 1000000000 || wget -q https://dl.fbaipublicfiles.com/fairseq/wav2vec/xlsr2_300m.pt -O weights/xlsr2_300m.pt
if ! have weights/best_SSL_model_DF.pth 100000000; then
    gdown -q --folder https://drive.google.com/drive/folders/1c4ywztEVlYVijfwbGLl9OEa1SNtFKppB -O /tmp/aasist_dl
    echo "voice checkpoints in the shared folder:"; find /tmp/aasist_dl -name "*.pth" -exec basename {} \;
    pick=$(find /tmp/aasist_dl -name "*DF*.pth" | head -1); [ -z "$pick" ] && pick=$(find /tmp/aasist_dl -name "*.pth" | head -1)
    [ -n "$pick" ] && cp "$pick" weights/best_SSL_model_DF.pth && echo "using $(basename "$pick")"
fi
echo
for entry in "SBI:weights/sbi/FFc23.tar" "TruFor:weights/trufor/trufor.pth.tar" "LipForensics:weights/lipforensics_ff.pth" \
    "SyncNet:repos/syncnet/data/syncnet_v2.model" "SyncNet-face:repos/syncnet/detectors/s3fd/weights/sfd_face.pth" \
    "XLS-R:weights/xlsr2_300m.pt" "Voice:weights/best_SSL_model_DF.pth"; do
    name=${entry%%:*}; path=${entry#*:}
    [ -f "$path" ] && echo "ok      $name $(du -h "$path" | cut -f1)" || echo "MISSING $name ($path)"
done
