from typing import Any
from pathlib import Path
import tempfile

from PIL import Image
from io import BytesIO

def analyze_image(image_bytes: bytes) -> dict[str, Any]:
    if not image_bytes:
        raise ValueError("No image data was provided.")

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image_format = (image.format or "JPEG").upper()
            image.verify()
    except Exception as exc:
        raise ValueError("The file is not a valid supported image.") from exc

    suffixes = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "BMP": ".bmp"}
    suffix = suffixes.get(image_format, ".img")

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(image_bytes)
            temp_path = Path(tmp.name)

        from ai_engine.detector import analyze_image as run_detector
        result = run_detector(str(temp_path))
        score = float(result["ai_generated_score"])

        return {
            "status": "available",
            "verdict": result["verdict"],
            "model_output": {
                "model_name": result["model_name"],
                "ai_generated_score": score,
                "score_type": "AI-generated image score; not calibrated certainty",
            },
            "quality_warnings": [],
            "findings": [
                f"AI-generated image score: {score:.4f}",
                "This result is a model assessment, not proof of authenticity or manipulation.",
            ],
            "limitations": result.get("limitations", []),
        }
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
