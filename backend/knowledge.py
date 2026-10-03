"""Reference notes on each detector: what it measures, what its score means, and when it misleads.

Retrieved per case (only the detectors that reported) and given to the reasoning model, so its
explanation is grounded in how the detectors actually behave rather than in general knowledge.
"""

from __future__ import annotations

DETECTORS = {
    "sbi": (
        "SBI (Self-Blended Images), EfficientNet-B4. Scores each detected face for blending boundaries left by "
        "face swaps and face reenactment. Score is P(fake) for that face. Trained on FaceForensics++ c23, so it "
        "tolerates moderate compression. It does not detect fully synthetic images (no blending boundary exists), "
        "and heavy recompression, strong beauty filters, or very small faces raise false positives. A high score "
        "on one face in a group photo points at that face only."
    ),
    "sbi_video": (
        "SBI applied to frames sampled at 3 fps, smoothed over time. Interval findings mark stretches where the "
        "face-swap score stayed high; the clip-level finding is the 90th percentile of frame scores. Sustained "
        "intervals are much stronger evidence than a single high frame. 'no_face_detected' means it had nothing "
        "to examine, which is not evidence of authenticity."
    ),
    "univfd": (
        "UnivFD (UniversalFakeDetect): a linear classifier on CLIP ViT-L/14 features of a 224 px centre crop. "
        "Score is P(the image was produced by a generative model: GAN or diffusion). It looks at the whole image, "
        "not faces. It does not detect face swaps or local edits in a real photo. Screenshots, illustrations, "
        "heavy filters and very low resolution images are outside its training distribution and can score high "
        "or low unpredictably."
    ),
    "trufor": (
        "TruFor: fuses RGB with a learned camera-noise fingerprint (Noiseprint++). Score is the image-level "
        "probability of local manipulation (splicing, copy-move, inpainting); its heatmap localizes the region. "
        "It is not designed for fully synthetic images. Low-quality JPEGs, screenshots and images resized after "
        "editing weaken it; a mid score with a diffuse heatmap is weak evidence, a compact hot region is strong."
    ),
    "lipforensics": (
        "LipForensics: a lip-reading network scoring 1-second clips of the aligned mouth region for unnatural "
        "mouth motion. Score is P(fake) per clip. Strong on face swaps and reenactment while the person speaks. "
        "It needs a visible, mostly frontal talking face; silent faces, occluded mouths and extreme poses are "
        "uninformative. 'no_mouth_track' means no usable face."
    ),
    "syncnet": (
        "SyncNet: measures whether the audio matches the lip movement of each tracked face. It reports an offset "
        "in frames and a confidence. Confidence below 3 or an offset above 3 frames (120 ms) is flagged. Low "
        "confidence also happens when the visible person is not the speaker (voice-over, interviewer off "
        "screen, music), so on its own it is weak evidence and is kept below the strong-signal level. High "
        "confidence with near-zero offset supports genuine, undubbed speech."
    ),
    "ssl_aasist": (
        "SSL-AASIST: wav2vec 2.0 XLS-R features with an AASIST graph-attention back end, trained on ASVspoof. "
        "Scores 4-second windows; score is P(synthetic or converted speech). Windows without speech are skipped. "
        "Telephone-band audio, heavy noise suppression, music beds and strong codecs can raise scores on genuine "
        "speech; modern voice clones unseen in training can score low. Consistently high windows are strong "
        "evidence; one high window among many low ones is weak."
    ),
    "ecapa": (
        "ECAPA-TDNN speaker verification. Only used in identity mode with a reference recording: compares the "
        "voice with the claimed speaker. It says nothing about whether speech is synthetic."
    ),
    "optical_flow": (
        "Optical-flow consistency (RAFT): compares motion inside the face box with the surrounding background. "
        "Rule-based. Flags face regions that jitter independently of the head. Fast head turns, hand occlusions "
        "and compression blocking cause false positives."
    ),
    "head_pose": (
        "Head-pose agreement: estimates pose separately from inner-face and face-outline landmarks. Rule-based. "
        "A sustained disagreement suggests an inner face pasted onto a different head. Extreme angles and "
        "partial occlusion cause false positives."
    ),
    "smoothness": (
        "Landmark motion smoothness: flags jerk spikes in landmark trajectories. Rule-based and sensitive to "
        "cuts, camera shake and low frame rates; weak evidence unless it coincides with a learned detector."
    ),
    "identity_drift": (
        "Identity drift: tracks the ArcFace identity embedding across frames. Rule-based. Drift within one "
        "continuous shot suggests an unstable face swap; a scene cut to a different person looks the same."
    ),
    "blink": (
        "Blink dynamics from the eye aspect ratio. Rule-based and the weakest check: some people blink rarely, "
        "and modern generators blink normally."
    ),
    "exiftool": (
        "Metadata rules from exiftool: editing software tags, timestamps out of order, stripped metadata. "
        "Messaging apps and social platforms strip metadata from genuine files, and editing software is used "
        "for harmless crops. Context, never proof."
    ),
    "ffprobe": (
        "Container rules from ffprobe: encoder tags, duration mismatches, missing audio. Shows the file was "
        "re-encoded, which is true of almost everything shared online. Context, never proof."
    ),
    "c2patool": (
        "C2PA provenance. A valid manifest is positive evidence of origin and edit history. Absence means "
        "nothing: most genuine media carries no manifest."
    ),
}

GENERAL = (
    "How the fused result is built. Each module's score is its strongest detector; modules are averaged by "
    "configured weight, scaled by how much of the module actually ran. Trust score = 100 x (1 - weighted score). "
    "A learned module at or above the strong-signal level caps the trust score. Rule-based modules (motion, "
    "metadata) are capped and cannot trigger that rule. Evidence weight is the share of applicable detector "
    "weight that produced evidence; below the configured threshold the result is inconclusive. Detector "
    "thresholds are the published defaults and have not been calibrated on this deployment's own data, so "
    "scores near 0.5 deserve less weight than scores near 0 or 1. Different detectors target different "
    "manipulations: a clean result from one says nothing about manipulations it was not built to find."
)


def for_models(models: list[str]) -> list[dict]:
    """Notes for the detectors that reported in a case, plus the fusion rules."""
    docs = [{"id": "kb:fusion", "kind": "knowledge", "text": GENERAL}]
    docs += [{"id": f"kb:{m}", "kind": "knowledge", "text": DETECTORS[m]} for m in dict.fromkeys(models) if m in DETECTORS]
    return docs
