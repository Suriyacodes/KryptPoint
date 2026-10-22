
import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response

from backend.database import (
    get_analysis,
    get_recent_analyses,
    initialize_database,
    save_analysis,
)
from backend.evidence import process_image
from backend.reports import generate_pdf_report
from backend.services.ai_client import analyze_image as run_ai_analysis


app = FastAPI(
    title="KryptPoint API",
    description="Image evidence analysis and verification support.",
    version="1.0.0",
)

MAX_FILE_SIZE = 10 * 1024 * 1024


@app.on_event("startup")
def startup():
    initialize_database()


@app.get("/")
def home():
    return {
        "message": "Welcome to KryptPoint API",
        "docs": "/docs",
        "status": "running",
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Please select an image.")

    if Path(file.filename).suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG, and WEBP images are supported.",
        )

    image_bytes = await file.read(MAX_FILE_SIZE + 1)
    await file.close()

    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="The image exceeds the 10 MB upload limit.",
        )

    try:
        evidence = process_image(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # The current adapter is a placeholder until Smaug is connected.
    ai_result = run_ai_analysis(image_bytes)

    created_at = datetime.now(timezone.utc).isoformat()
    verdict = ai_result.get("verdict", "inconclusive")
    model_output = ai_result.get("model_output")

    quality_warnings = ai_result.get("quality_warnings", [])
    findings = ai_result.get("findings", [])
    limitations = ai_result.get("limitations", [])

    analysis_id = save_analysis(
        created_at=created_at,
        file_sha256=evidence["sha256"],
        perceptual_hash=evidence["perceptual_hash"],
        verdict=verdict,
        model_output=json.dumps(model_output),
        quality_warnings=json.dumps(quality_warnings),
        findings=json.dumps(findings),
        limitations=json.dumps(limitations),
    )

    return {
        "analysis_id": analysis_id,
        "created_at": created_at,
        "sha256": evidence["sha256"],
        "perceptual_hash": evidence["perceptual_hash"],
        "image_format": evidence["image_format"],
        "file_size": evidence["file_size"],
        "verdict": verdict,
        "model_name": (model_output or {}).get("model_name"),
        "ai_generated_score": (model_output or {}).get("ai_generated_score"),
        "status": ai_result.get("status", "unavailable"),
        "quality_warnings": quality_warnings,
        "findings": findings,
        "limitations": limitations,
        "explanation": (
            "Smaug assessed this image for AI-generated imagery. "
            "The score is not proof of authenticity."
            if ai_result.get("status") == "available"
            else "Image evidence was recorded, but the AI prediction is unavailable."
        ),
        "possible_matches": [],
    }


@app.get("/api/history")
def history(limit: int = 20):
    if not 1 <= limit <= 100:
        raise HTTPException(
            status_code=400,
            detail="Limit must be between 1 and 100.",
        )

    records = get_recent_analyses(limit)
    return {"items": records, "count": len(records)}


@app.get("/api/report/{analysis_id}")
def download_report(analysis_id: int):
    record = get_analysis(analysis_id)

    if record is None:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    # Convert stored JSON strings back into readable report values.
    for field in ("model_output", "quality_warnings", "findings", "limitations"):
        value = record.get(field)
        if value:
            try:
                record[field] = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                pass

    pdf_bytes = generate_pdf_report(record)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="kryptpoint-report-{analysis_id}.pdf"'
            )
        },
    )
