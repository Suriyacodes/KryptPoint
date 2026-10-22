
from pathlib import Path
import sys

from huggingface_hub import snapshot_download
from PIL import Image

MODEL_ID = "abacusai/Smaug-AI-Image-Detector"
_detector = None


def load_detector():
    """Load Smaug once and reuse it."""
    global _detector

    if _detector is None:
        print("Loading Smaug model. First run may take a while...")

        model_path = snapshot_download(MODEL_ID)
        if str(model_path) not in sys.path:
            sys.path.insert(0, str(model_path))

        from smaug_image_detect import SmaugImageDetect

        _detector = SmaugImageDetect.from_pretrained(str(model_path))
        print("Model loaded successfully!")

    return _detector


def analyze_image(image_path: str) -> dict:
    """Return a preliminary AI-generated-image assessment."""
    path = Path(image_path).expanduser().resolve()

    if not path.is_file():
        raise FileNotFoundError(f"Image not found: {path}")

    try:
        with Image.open(path) as image:
            image.verify()
    except Exception as exc:
        raise ValueError("The file is not a valid supported image.") from exc

    detector = load_detector()
    score = float(detector(str(path)))

    if score >= 0.5:
        verdict = "potentially_manipulated"
    else:
        verdict = "no_manipulation_detected"

    return {
        "model_name": MODEL_ID,
        "ai_generated_score": round(score, 4),
        "verdict": verdict,
        "limitations": [
            "This model assesses AI-generated imagery, not every kind of deepfake.",
            "The score is not proof that an image is authentic or manipulated.",
            "The 0.5 threshold is provisional and is not a calibrated certainty."
        ]
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python ai_engine/detector.py <image_path>")
        raise SystemExit(2)

    try:
        result = analyze_image(sys.argv[1])
        print("\n--- KryptPoint AI Test ---")
        print(f"Model: {result['model_name']}")
        print(f"AI-generated score: {result['ai_generated_score']}")
        print(f"Demo verdict: {result['verdict']}")

        for note in result["limitations"]:
            print(f"Note: {note}")

    except Exception as exc:
        print(f"Analysis failed: {type(exc).__name__}: {exc}")
        raise SystemExit(1)


