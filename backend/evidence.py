
import hashlib
import io

import imagehash
from PIL import Image, UnidentifiedImageError


MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


def process_image(file_bytes: bytes) -> dict:
    """
    Validate an uploaded image and calculate its evidence hashes.

    SHA-256 identifies the exact file bytes.
    Perceptual hash helps find visually similar images.
    Neither hash proves that an image is genuine.
    """
    if not file_bytes:
        raise ValueError("The uploaded file is empty.")

    if len(file_bytes) > MAX_FILE_SIZE:
        raise ValueError("The image exceeds the 10 MB upload limit.")

    sha256_hash = hashlib.sha256(file_bytes).hexdigest()

    try:
        with Image.open(io.BytesIO(file_bytes)) as image:
            if image.format not in ALLOWED_FORMATS:
                raise ValueError(
                    "Unsupported image format. Use JPEG, PNG, or WEBP."
                )

            image.verify()

        # Reopen the image after verify() before calculating its hash.
        with Image.open(io.BytesIO(file_bytes)) as image:
            image.load()
            perceptual_hash = str(imagehash.phash(image.convert("RGB")))
            image_format = image.format

    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValueError("The uploaded file is not a valid image.") from exc

    return {
        "sha256": sha256_hash,
        "perceptual_hash": perceptual_hash,
        "image_format": image_format,
        "file_size": len(file_bytes),
    }
