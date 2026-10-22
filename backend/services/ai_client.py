
from typing import Any


def analyze_image(image_bytes: bytes) -> dict[str, Any]:
    """
    Adapter for the team's image-analysis AI engine.

    Replace the placeholder with the actual teammate-owned model
    integration once its import path and function signature are known.
    """
    if not image_bytes:
        raise ValueError("No image data was provided.")

    # Do not pretend to have detected a deepfake without a real model.
    return {
        "status": "unavailable",
        "verdict": "inconclusive",
        "model_output": None,
        "quality_warnings": [],
        "findings": [],
        "limitations": [
            "The AI engine has not been connected yet.",
            "No authenticity or deepfake prediction has been made.",
        ],
    }
