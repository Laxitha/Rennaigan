#!/usr/bin/env python3
"""Print what each face detector sees in an image:  python scripts/diagnose_faces.py photo.jpg"""

import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import face  # noqa: E402

image = cv2.imread(sys.argv[1])
print("image:", None if image is None else image.shape)

try:
    import insightface
    import onnxruntime
    print("insightface", insightface.__version__, "| onnxruntime", onnxruntime.__version__, onnxruntime.get_available_providers())
    app = face.get_face_app()
    raw = app.get(image)
    print("insightface raw faces:", [(f.bbox.astype(int).tolist(), round(float(f.det_score), 3)) for f in raw])
    print("insightface after size/score filter:", len(face._detect_faces_insightface(image, face.DET_THRESH)))
except Exception as exc:
    print("insightface failed:", type(exc).__name__, exc)

try:
    print("yunet faces:", [(f["box"], round(f["score"], 3)) for f in face.detect_faces_yunet(image)])
except Exception as exc:
    print("yunet failed:", type(exc).__name__, exc)
